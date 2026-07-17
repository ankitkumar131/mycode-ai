import { EventTranslator } from './event-translator.js';
import { ConversationContext } from './context.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ProviderRouter } from '../routing/provider-router.js';
import { SystemPromptBuilder } from '../prompts/system-prompt.js';
import type { AgentOptions, AgentEvent } from './types.js';
import type { ToolExecuteOptions, SafetyResult, ToolFunctionDefinition } from '../tools/types.js';

const MAX_ITERATIONS = 25;
const MAX_RETRIES_PER_TOOL = 3;
const RETRY_COOLDOWN_MS = 500;

export interface SessionConfig extends AgentOptions {
  providerRouter: ProviderRouter;
  cwd?: string;
  toolRegistry?: ToolRegistry;
  onText?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string) => void;
  onError?: (message: string) => void;
  onFinish?: (usage: { promptTokens: number; completionTokens: number }) => void;
  confirmFn?: (target: string, context?: string | null, safety?: SafetyResult) => Promise<boolean>;
}

export class AgentSession {
  private config: SessionConfig;
  public translator: EventTranslator;
  private context: ConversationContext;
  private toolRegistry: ToolRegistry;
  private _running = false;
  private _iterations = 0;
  private _aborted = false;
  private _abortController: AbortController;
  private _toolCallCounts: Map<string, number> = new Map();
  private _executedToolCalls: Set<string> = new Set();
  private _initialized = false;

  constructor(config: SessionConfig) {
    this.config = config;
    this.translator = new EventTranslator();
    this.context = new ConversationContext();
    this.toolRegistry = config.toolRegistry ?? new ToolRegistry();
    this._abortController = new AbortController();
  }

  async run(input: string): Promise<string> {
    this._running = true;
    this._iterations = 0;
    this._aborted = false;
    this._toolCallCounts.clear();
    this._executedToolCalls.clear();

    const maxIter = this.config.maxIterations ?? MAX_ITERATIONS;
    const cwd = this.config.cwd ?? process.cwd();
    const router = this.config.providerRouter;
    const model = this.config.model;

    try {
      // Build system prompt (only on first call)
      if (!this._initialized) {
        const tools = this.toolRegistry.getDefinitions({ filterWriteTools: false });
        const toolNames = tools.map(t => t.function.name);
        const systemPrompt = await SystemPromptBuilder.buildSystemPrompt(cwd, {
          tools: toolNames,
          model: model ?? this.config.provider,
          provider: this.config.provider,
        });
        this.context.addSystem(systemPrompt);
        this._initialized = true;
      }

      // Add user input
      this.context.addUser(input);

      // Agent loop
      while (this._iterations < maxIter && !this._aborted) {
        this._iterations++;

        const messages = this.context.getHistory(50);
        const toolDefs = this.toolRegistry.getDefinitions({
          filterWriteTools: this._iterations < 2,
        });

        // Call provider
        let response: string;
        let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined;

        let usage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };

        try {
          const result = await router.chat(messages, toolDefs.length > 0 ? toolDefs : undefined, {
            abortSignal: this._abortController.signal,
            onStream: (chunk: string) => {
              this.config.onText?.(chunk);
            },
          });

          response = result.content ?? '';
          toolCalls = result.toolCalls;
          if (result.usage) {
            usage = {
              promptTokens: result.usage.prompt_tokens ?? 0,
              completionTokens: result.usage.completion_tokens ?? 0,
            };
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.config.onError?.(errMsg);
          this.emit({ type: 'error', message: errMsg });
          return errMsg;
        }

        if (this._aborted) {
          return 'Session aborted.';
        }

        // Handle response
        if (response) {
          this.emit({ type: 'text', content: response });
        }

        if (!toolCalls || toolCalls.length === 0) {
          this.context.addAssistant(response);
          this.emit({ type: 'finish', usage });
          this.config.onFinish?.(usage);
          return response;
        }

        this.context.addAssistantWithTools(response, toolCalls);

        for (const call of toolCalls) {
          if (this._aborted) break;

          const toolName = call.function.name;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            args = {};
          }

          // Dedup check
          const callKey = `${toolName}:${call.function.arguments}`;
          if (this._executedToolCalls.has(callKey)) {
            this.context.addToolResult(call.id, 'Tool call skipped (duplicate)', toolName);
            continue;
          }

          // Retry limit check
          const count = this._toolCallCounts.get(toolName) ?? 0;
          if (count >= MAX_RETRIES_PER_TOOL) {
            this.context.addToolResult(
              call.id,
              `Error: Tool ${toolName} has failed ${count} times. Maximum retries exceeded.`,
              toolName
            );
            continue;
          }

          this._toolCallCounts.set(toolName, count + 1);
          this._executedToolCalls.add(callKey);

          this.emit({ type: 'tool_call', name: toolName, args });
          this.config.onToolCall?.(toolName, args);

          try {
            const execOptions: ToolExecuteOptions = {
              abortSignal: this._abortController.signal,
              confirmFn: this.config.confirmFn,
            };

            const result = await this.toolRegistry.executeTool(toolName, args, cwd, execOptions);

            this.context.addToolResult(call.id, result, toolName);
            this.emit({ type: 'tool_result', name: toolName, result });
            this.config.onToolResult?.(toolName, result);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.context.addToolResult(call.id, `Error: ${errMsg}`, toolName);
            this.emit({ type: 'error', message: `Tool ${toolName} failed: ${errMsg}` });
          }

          // Trim context after adding tool results
          this.context.trimToLimit();

          // Cooldown between tool calls
          if (toolCalls.length > 1) {
            await new Promise(r => setTimeout(r, RETRY_COOLDOWN_MS));
          }
        }
      }

      if (this._iterations >= maxIter) {
        this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
        return 'Reached maximum iteration limit.';
      }

      this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
      return '';
    } finally {
      this._running = false;
    }
  }

  abort(): void {
    this._aborted = true;
    this._abortController.abort();
  }

  getState() {
    return {
      running: this._running,
      iterations: this._iterations,
      aborted: this._aborted,
      messageCount: this.context.length,
    };
  }

  getContext(): ConversationContext {
    return this.context;
  }

  getRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  private emit(event: AgentEvent): void {
    try {
      this.translator.translate(event);
    } catch {
      // event translation is best-effort
    }
  }
}
