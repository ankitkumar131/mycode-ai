/**
 * Agentic Loop — The Core Brain
 *
 * Implements the Observe → Reason → Act → Feedback cycle.
 * The agent iterates: sends messages to the AI, executes tool calls,
 * feeds results back, and repeats until the task is complete.
 *
 * Enhanced for production-grade command execution:
 * - No spinner during command streaming (output takes over the terminal)
 * - Ctrl+C forwarding to running commands via AbortController
 * - CommandHistory integration for tracking executed commands
 * - Structured result handling from the command executor
 */

import { getToolDefinitions, executeTool, isWriteTool } from '../tools/registry.js';
import { ConversationContext } from './context.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createSpinner, createToolSpinner, createCodegenSpinner } from '../ui/spinner.js';
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
   * @param {object} options - { mode, confirmWrites, confirmCommands, rlConfirmFns, commandHistory }
   */
  constructor(router, cwd, options = {}) {
    this.router = router;
    this.cwd = cwd;
    this.mode = options.mode || 'agent';
    this.enableTools = options.enableTools !== false;
    this.confirmWrites = options.confirmWrites !== false;
    this.confirmCommands = options.confirmCommands !== false;

    // Store readline-based confirm functions if provided (for chat REPL)
    this._rlConfirmFns = options.rlConfirmFns || null;

    // Command history for tracking executed commands
    this._commandHistory = options.commandHistory || null;

    this.context = new ConversationContext();
    this.context.setSystemPrompt(
      buildSystemPrompt(cwd, {
        mode: this.mode,
        commandHistory: this._commandHistory,
      })
    );

    this._iterationCount = 0;
    this._aborted = false;

    // AbortController for forwarding Ctrl+C to running commands
    this._currentAbortController = null;
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

      // Show usage info — always show, using estimates if needed
      const promptTokens = response.usage?.prompt_tokens;
      const completionTokens = response.usage?.completion_tokens;
      const isEstimated = response.usage?.estimated === true;

      const inDisplay = Number.isFinite(promptTokens) ? promptTokens : estimatePromptTokens(messages);
      const outDisplay = Number.isFinite(completionTokens) ? completionTokens : estimateTokens(response.content || '');

      const prefix = (isEstimated || !Number.isFinite(promptTokens)) ? '~' : '';
      logger.info(
        `Tokens: ${prefix}${inDisplay.toLocaleString()} in / ${prefix}${outDisplay.toLocaleString()} out`
      );

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
    let codegenSpinner = null;

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
          // Stop codegen spinner if it was running
          if (codegenSpinner) {
            codegenSpinner.stop();
            codegenSpinner = null;
          }
          toolCalls.push(chunk.tool_call);
        } else if (chunk.type === 'tool_call_delta') {
          // Show progress indicator for tool call argument generation
          if (!streamStarted) {
            spinner.stop();
            streamStarted = true;
          }
          if (!codegenSpinner) {
            codegenSpinner = createCodegenSpinner();
            codegenSpinner.start();
          }
          // Update progress text
          const toolName = chunk.name || 'tool';
          const bytesReceived = chunk.argumentsLength || 0;
          if (bytesReceived > 0) {
            const kb = (bytesReceived / 1024).toFixed(1);
            codegenSpinner.text = `${chalk.hex('#38BDF8')('✍')} Generating ${chalk.hex('#38BDF8').bold(toolName)} args... ${chalk.dim(`${kb} KB received`)}`;
          }
        } else if (chunk.type === 'finish') {
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      }

      // Stop codegen spinner if still running
      if (codegenSpinner) {
        codegenSpinner.stop();
        codegenSpinner = null;
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
      if (codegenSpinner) {
        codegenSpinner.stop();
      }
      spinner.stop();
      throw err;
    }
  }

  /**
   * Execute tool calls requested by the AI.
   * Enhanced: handles executeCommand specially — no spinner during streaming,
   * Ctrl+C forwarding, and CommandHistory integration.
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

      const isCommand = name === 'executeCommand';

      // Determine if this tool needs user confirmation
      const toolOptions = {};
      let needsConfirm = false;

      if (isWriteTool(name)) {
        if (this.confirmWrites && (name === 'writeFile' || name === 'editFile')) {
          needsConfirm = true;
          const baseFn = this._rlConfirmFns
            ? this._rlConfirmFns.confirmFileWrite
            : confirmFileWrite;
          toolOptions.confirmFn = baseFn;
        }
        if (this.confirmCommands && isCommand) {
          needsConfirm = true;
          const baseFn = this._rlConfirmFns
            ? this._rlConfirmFns.confirmCommand
            : confirmCommand;
          toolOptions.confirmFn = baseFn;
        }
      }

      // Pass command history for executeCommand
      if (isCommand && this._commandHistory) {
        toolOptions.commandHistory = this._commandHistory;
      }

      // Create an AbortController for Ctrl+C forwarding during command execution
      if (isCommand) {
        this._currentAbortController = new AbortController();
        toolOptions.abortSignal = this._currentAbortController.signal;
      }

      // Start spinner — but NOT for executeCommand (its own output renderer takes over)
      let toolSpinner = null;
      if (!isCommand) {
        toolSpinner = createToolSpinner(name);
        toolSpinner.start();
      }

      // CRITICAL: Stop the spinner BEFORE any tool that needs user confirmation.
      if (needsConfirm && toolSpinner) {
        toolSpinner.stop();
      }

      const result = await executeTool(name, args, this.cwd, toolOptions);

      // Clean up abort controller
      if (isCommand) {
        this._currentAbortController = null;
      }

      // Show completion
      if (isCommand) {
        // Command output renderer already showed everything — just a subtle log
        // (no spinner to stop/succeed)
      } else if (needsConfirm) {
        // Spinner was already stopped; just log the result
        console.log(
          `${chalk.hex('#34D399')('✔')} ${chalk.hex('#38BDF8').bold(name)} ${chalk.dim('completed')}`
        );
      } else {
        toolSpinner.succeed(
          `${chalk.hex('#38BDF8').bold(name)} ${chalk.dim('completed')}`
        );
      }

      // Show tool result (abbreviated for non-command tools)
      if (!isCommand) {
        if (result.length < 500) {
          console.log(chalk.dim(result));
        } else {
          console.log(chalk.dim(result.slice(0, 300) + '... (truncated)'));
        }
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
   * If a command is running, forward the abort to it first.
   */
  abort() {
    // If a command is currently running, abort it
    if (this._currentAbortController) {
      this._currentAbortController.abort();
      this._currentAbortController = null;
    }
    this._aborted = true;
  }

  /**
   * Get the conversation context (for resuming later).
   */
  getContext() {
    return this.context;
  }

  /**
   * Get the command history instance (if available).
   */
  getCommandHistory() {
    return this._commandHistory;
  }
}
