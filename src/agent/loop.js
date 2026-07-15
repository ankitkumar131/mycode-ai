/**
 * Agentic Loop — The Core Brain
 *
 * Implements the Observe → Reason → Act → Feedback cycle.
 * The agent iterates: sends messages to the AI, executes tool calls,
 * feeds results back, and repeats until the task is complete.
 */

import { getToolDefinitions, executeTool, isWriteTool } from '../tools/registry.js';
import { ConversationContext } from './context.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createSpinner, createToolSpinner } from '../ui/spinner.js';
import { renderMarkdown } from '../ui/renderer.js';
import { confirmFileWrite, confirmCommand } from '../ui/prompt.js';
import logger from '../utils/logger.js';
import chalk from 'chalk';

const MAX_ITERATIONS = 25; // Safety limit to prevent infinite loops

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function estimatePromptTokens(messages) {
  return messages.reduce((total, message) => {
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content || '');

    return total + 4 + estimateTokens(message.role) + estimateTokens(content);
  }, 0);
}

export class AgentLoop {
  /**
   * @param {ProviderRouter} router - The provider router for AI requests
   * @param {string} cwd - Current working directory
   * @param {object} options - { mode, confirmWrites, confirmCommands }
   */
  constructor(router, cwd, options = {}) {
    this.router = router;
    this.cwd = cwd;
    this.mode = options.mode || 'agent';
    this.enableTools = options.enableTools !== false;
    this.confirmWrites = options.confirmWrites !== false;
    this.confirmCommands = options.confirmCommands !== false;

    this.context = new ConversationContext();
    this.context.setSystemPrompt(buildSystemPrompt(cwd, { mode: this.mode }));

    this._iterationCount = 0;
    this._aborted = false;
  }

  /**
   * Run a single user request through the agentic loop.
   * @param {string} userMessage - The user's input
   * @returns {Promise<string>} The final text response
   */
  async run(userMessage) {
    this.context.addMessage({ role: 'user', content: userMessage });
    this._iterationCount = 0;
    this._aborted = false;

    return this._loop();
  }

  /**
   * The core loop: send to AI → handle tool calls → repeat.
   */
  async _loop() {
    while (this._iterationCount < MAX_ITERATIONS && !this._aborted) {
      this._iterationCount++;

      const messages = this.context.getMessages();
      const tools = this.enableTools ? getToolDefinitions({ includeWrite: true }) : [];

      // Show thinking spinner
      const spinner = createSpinner(this.router.getCurrentProvider().getLabel());
      spinner.start();

      let response;
      try {
        // Check if we should stream or not
        if (this.mode === 'chat') {
          // Streaming for interactive chat
          response = await this._streamResponse(messages, tools, spinner);
        } else {
          // Non-streaming for agent mode (cleaner tool call handling)
          response = await this.router.chat(messages, tools);
          spinner.stop();
        }
      } catch (err) {
        spinner.fail(err.message);
        logger.error(err.message);
        return `Error: ${err.message}`;
      }

      // Add assistant response to context
      const assistantMessage = {
        role: 'assistant',
        content: response.content || '',
      };

      if (response.tool_calls && response.tool_calls.length > 0) {
        assistantMessage.tool_calls = response.tool_calls;
      }

      this.context.addMessage(assistantMessage);

      // If there are tool calls, execute them and loop back
      if (response.tool_calls && response.tool_calls.length > 0) {
        await this._handleToolCalls(response.tool_calls);
        continue; // Loop back to get next response
      }

      // No tool calls — we have a final text response
      if (response.content && this.mode !== 'chat') {
        // In non-chat modes, render the final response
        console.log();
        renderMarkdown(response.content);
        console.log();
      }

      // Show usage info
      const promptTokens = response.usage?.prompt_tokens;
      const completionTokens = response.usage?.completion_tokens;
      const hasUsage = Number.isFinite(promptTokens) || Number.isFinite(completionTokens);

      if (hasUsage) {
        logger.info(
          `Tokens: ${Number.isFinite(promptTokens) ? promptTokens : '?'} in / ${Number.isFinite(completionTokens) ? completionTokens : '?'} out`
        );
      }

      return response.content || '';
    }

    if (this._iterationCount >= MAX_ITERATIONS) {
      logger.warn(`Reached maximum iteration limit (${MAX_ITERATIONS}). Stopping.`);
      return 'Reached maximum number of iterations. Please review the changes and continue if needed.';
    }

    return '';
  }

  /**
   * Stream a response to the terminal (for chat mode).
   */
  async _streamResponse(messages, tools, spinner) {
    let fullContent = '';
    const toolCalls = [];
    let streamStarted = false;
    let usage = null;

    try {
      const stream = this.router.stream(messages, tools);

      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          if (!streamStarted) {
            spinner.stop();
            streamStarted = true;
            process.stdout.write(chalk.hex('#CBD5E1')(''));
          }
          process.stdout.write(chalk.hex('#CBD5E1')(chunk.content));
          fullContent += chunk.content;
        } else if (chunk.type === 'tool_call') {
          if (!streamStarted) {
            spinner.stop();
            streamStarted = true;
          }
          toolCalls.push(chunk.tool_call);
        } else if (chunk.type === 'finish') {
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      }

      if (streamStarted && fullContent) {
        console.log(); // New line after streamed content
      } else if (!streamStarted) {
        spinner.stop();
      }

      return {
        content: fullContent,
        tool_calls: toolCalls,
        usage: usage || {
          prompt_tokens: estimatePromptTokens(messages),
          completion_tokens: estimateTokens(fullContent),
          estimated: true,
        },
      };
    } catch (err) {
      spinner.stop();
      throw err;
    }
  }

  /**
   * Execute tool calls requested by the AI.
   */
  async _handleToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      const name = toolCall.function.name;
      let args;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
        logger.warn(`Failed to parse tool arguments for ${name}`);
      }

      // Build tool options
      const toolOptions = {};
      if (isWriteTool(name)) {
        if (this.confirmWrites && (name === 'writeFile' || name === 'editFile')) {
          toolOptions.confirmFn = confirmFileWrite;
        }
        if (this.confirmCommands && name === 'executeCommand') {
          toolOptions.confirmFn = confirmCommand;
        }
      }

      // Execute the tool
      const toolSpinner = createToolSpinner(name);
      toolSpinner.start();

      const result = await executeTool(name, args, this.cwd, toolOptions);

      toolSpinner.succeed(
        `${chalk.hex('#38BDF8').bold(name)} ${chalk.dim('completed')}`
      );

      // Show tool result
      if (result.length < 500) {
        console.log(chalk.dim(result));
      } else {
        console.log(chalk.dim(result.slice(0, 300) + '... (truncated)'));
      }

      // Add tool result to context
      this.context.addMessage({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  /**
   * Abort the current loop.
   */
  abort() {
    this._aborted = true;
  }

  /**
   * Get the conversation context (for resuming later).
   */
  getContext() {
    return this.context;
  }
}
