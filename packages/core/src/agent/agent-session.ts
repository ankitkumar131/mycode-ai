import { EventTranslator } from './event-translator.js';
import { ConversationContext, type Message } from './context.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ProviderRouter } from '../routing/provider-router.js';
import { SystemPromptBuilder } from '../prompts/system-prompt.js';
import type { AgentOptions, AgentEvent } from './types.js';
import type { ToolExecuteOptions, SafetyResult } from '../tools/types.js';

const MAX_ITERATIONS = 40;
const MAX_CONSECUTIVE_FAILURES_PER_TOOL = 3;

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  compressions: number;
}

export interface SessionConfig extends AgentOptions {
  providerRouter: ProviderRouter;
  cwd?: string;
  toolRegistry?: ToolRegistry;
  contextWindow?: number;
  compressThreshold?: number;
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, meta: { durationMs: number; error: boolean }) => void;
  onError?: (message: string) => void;
  onFinish?: (usage: { promptTokens: number; completionTokens: number }) => void;
  onCompress?: (info: { before: number; after: number }) => void;
  confirmFn?: (target: string, context?: string | null, safety?: SafetyResult) => Promise<boolean>;
  extraSystemSections?: string[];
}

function normalizePathForDedup(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().trim();
}

function fixInvalidJsonArgs(jsonStr: string): string {
  try {
    JSON.parse(jsonStr);
    return jsonStr;
  } catch {
    let fixed = jsonStr.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    try {
      JSON.parse(fixed);
      return fixed;
    } catch {
      return jsonStr;
    }
  }
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
  private _toolFailures: Map<string, number> = new Map();
  private _executedToolCallsMap = new Map<string, number>();
  private _initialized = false;
  private _steerQueue: string[] = [];
  private _queuedPrompts: string[] = [];
  private _lastUserInput: string | null = null;
  private _startedAt = Date.now();
  private _usage: SessionUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, turns: 0, toolCalls: 0, compressions: 0 };
  private _filesTouched: Set<string> = new Set();
  private _toolCounts: Map<string, number> = new Map();
  private _pendingSystemSections: string[] = [];
  public id: string;
  public title: string | null = null;
  private _lastInputHash = '';
  private _lastInputTime = 0;
  private _lastFailedPrompt: string | null = null;
  private _lastFailTime = 0;

  constructor(config: SessionConfig) {
    this.config = config;
    this.translator = new EventTranslator();
    this.context = new ConversationContext(config.contextWindow);
    this.toolRegistry = config.toolRegistry ?? new ToolRegistry();
    this._abortController = new AbortController();
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async run(input: string): Promise<string> {
    if (this._running) {
      const isDuplicate = input === this._lastUserInput && Date.now() - this._lastInputTime < 3000;
      if (isDuplicate) {
        return `[Skipped duplicate — already processing]`;
      }
      if (this._lastFailedPrompt && input === this._lastFailedPrompt && Date.now() - this._lastFailTime < 5000) {
        return `[Skipped — same prompt just failed, not re-queuing to avoid loop]`;
      }
      this.queuePrompt(input);
      return `[Already processing — queued (${this.queuedCount} pending)]`;
    }

    const inputHash = `${input.length}:${input.slice(0, 100)}`;
    const now = Date.now();
    if (inputHash === this._lastInputHash && now - this._lastInputTime < 2000) {
      return `[Skipped duplicate within 2s]`;
    }
    if (this._lastFailedPrompt && input === this._lastFailedPrompt && now - this._lastFailTime < 10000) {
      return `[Skipped — same prompt failed 10s ago with all providers. Try different prompt or check providers.]`;
    }

    this._lastInputHash = inputHash;
    this._lastInputTime = now;

    this._running = true;
    this._iterations = 0;
    this._aborted = false;
    this._toolFailures.clear();
    this._executedToolCallsMap.clear();
    if (this._abortController.signal.aborted) this._abortController = new AbortController();

    const maxIter = this.config.maxIterations ?? MAX_ITERATIONS;
    const cwd = this.config.cwd ?? process.cwd();
    const router = this.config.providerRouter;

    try {
      await this.ensureSystemPrompt(cwd);
      this.flushPendingSystemSections();

      if (this._usage.turns === 0) {
        try {
          const { memoryManager } = await import('../memory/memory-manager.js');
          const profile = memoryManager.getProjectProfile(cwd);
          const relevantMems = memoryManager.search(input, cwd, 3, 1000);
          if (relevantMems.length > 0 || profile.files.length > 0) {
            const memContext = [
              profile.files.length ? `Project context — top files: ${profile.files.slice(0, 5).join(', ')}` : '',
              profile.concepts.length ? `Concepts: ${profile.concepts.slice(0, 5).join(', ')}` : '',
              relevantMems.length ? `Relevant memories:\n${relevantMems.map(m => `- [${m.type}] ${m.content}`).join('\n')}` : '',
            ].filter(Boolean).join('\n');
            if (memContext) {
              this.context.addSystem(`Memory context:\n${memContext}`);
            }
          }
          if (input.length > 20) {
            this.context.addSystem('Hint: Use codebase_map FIRST for architecture questions. Use forward slashes for paths even on Windows (e.g. C:/Users/... not C:\\Users\\...).');
          }
        } catch {}
      }

      const added = this.context.addUser(input);
      if (!added) {
        this._running = false;
        return `[Skipped duplicate in history]`;
      }
      this._lastUserInput = input;
      this._usage.turns++;
      let finalText = '';

      while (this._iterations < maxIter && !this._aborted) {
        this._iterations++;
        await this.maybeCompress();

        const messages = this.context.getHistory();
        const toolDefs = this.toolRegistry.getDefinitions();

        let response = '';
        let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined;
        let usage = { promptTokens: 0, completionTokens: 0 };

        try {
          const result = await router.chat(messages, toolDefs.length > 0 ? toolDefs : undefined, {
            abortSignal: this._abortController.signal,
            onStream: (chunk: string) => this.config.onText?.(chunk),
            onReasoning: (chunk: string) => this.config.onReasoning?.(chunk),
          });
          response = result.content ?? '';
          toolCalls = result.toolCalls;
          if (result.usage) {
            usage = { promptTokens: result.usage.prompt_tokens ?? 0, completionTokens: result.usage.completion_tokens ?? 0 };
            this._usage.promptTokens += usage.promptTokens;
            this._usage.completionTokens += usage.completionTokens;
            this._usage.totalTokens = this._usage.promptTokens + this._usage.completionTokens;
          }
        } catch (err) {
          if (this._aborted) return 'Interrupted.';
          const errMsg = err instanceof Error ? err.message : String(err);
          this.config.onError?.(errMsg);
          this.emit({ type: 'error', message: errMsg });
          this._lastFailedPrompt = input;
          this._lastFailTime = Date.now();
          return errMsg;
        }

        if (this._aborted) {
          if (response) this.context.addAssistant(response + '\n[interrupted]');
          return 'Interrupted.';
        }

        if (response) this.emit({ type: 'text', content: response });

        if (!toolCalls || toolCalls.length === 0) {
          this.context.addAssistant(response);
          finalText = response;
          this.emit({ type: 'finish', usage });
          this.config.onFinish?.(usage);
          this._lastFailedPrompt = null;
          return finalText;
        }

        this.context.addAssistantWithTools(response, toolCalls);

        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          if (this._aborted) {
            this.context.addToolResult(call.id, 'Interrupted.', call.function.name);
            continue;
          }
          const toolName = call.function.name;
          let args: Record<string, unknown>;
          let argsStr = call.function.arguments;
          
          argsStr = fixInvalidJsonArgs(argsStr);
          
          try {
            args = argsStr ? JSON.parse(argsStr) : {};
          } catch (e) {
            try {
              const aggressiveFix = argsStr.replace(/\\/g, '/');
              args = JSON.parse(aggressiveFix);
            } catch {
              this.context.addToolResult(call.id, `Error: Invalid JSON args (likely Windows backslashes). Use forward slashes: ${argsStr.slice(0, 200)}. Error: ${e instanceof Error ? e.message : String(e)}`, toolName);
              continue;
            }
          }

          let dedupKey = toolName;
          if (typeof args.path === 'string') {
            dedupKey = `${toolName}:${normalizePathForDedup(args.path)}`;
          } else {
            dedupKey = `${toolName}:${JSON.stringify(args).slice(0, 200)}`;
          }
          
          const lastExec = this._executedToolCallsMap.get(dedupKey);
          if (lastExec && Date.now() - lastExec < 30000 && !this.toolRegistry.isWriteTool(toolName)) {
            this.context.addToolResult(call.id, `Skipped: ${toolName} already executed for same target recently. Use previous result.`, toolName);
            continue;
          }

          const failures = this._toolFailures.get(toolName) ?? 0;
          if (failures >= MAX_CONSECUTIVE_FAILURES_PER_TOOL) {
            this.context.addToolResult(call.id, `Error: ${toolName} failed ${failures}x. Try different approach.`, toolName);
            continue;
          }
          
          this._executedToolCallsMap.set(dedupKey, Date.now());
          if (this._executedToolCallsMap.size > 100) {
            const oldest = Array.from(this._executedToolCallsMap.entries()).sort((a, b) => a[1] - b[1])[0];
            if (oldest) this._executedToolCallsMap.delete(oldest[0]);
          }

          this._usage.toolCalls++;
          this._toolCounts.set(toolName, (this._toolCounts.get(toolName) ?? 0) + 1);
          if (typeof args.path === 'string' && this.toolRegistry.isWriteTool(toolName)) this._filesTouched.add(args.path);

          this.emit({ type: 'tool_call', name: toolName, args });
          this.config.onToolCall?.(toolName, args);

          const t0 = Date.now();
          try {
            const execOptions: ToolExecuteOptions = { abortSignal: this._abortController.signal, confirmFn: this.config.confirmFn };
            let result = await this.toolRegistry.executeTool(toolName, args, cwd, execOptions);
            const steer = this.takeSteer();
            if (steer) result += `\n\n[User note]: ${steer}`;
            this.context.addToolResult(call.id, result, toolName);
            this.emit({ type: 'tool_result', name: toolName, result });
            this.config.onToolResult?.(toolName, result, { durationMs: Date.now() - t0, error: false });
            this._toolFailures.set(toolName, 0);

            try {
              const { memoryManager } = await import('../memory/memory-manager.js');
              memoryManager.captureObservation({
                sessionId: this.id,
                cwd,
                tool: toolName,
                input: args,
                output: typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000),
                success: true,
                durationMs: Date.now() - t0,
                tags: [toolName, typeof args.path === 'string' ? args.path : ''].filter(Boolean) as string[],
              });
            } catch {}
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.context.addToolResult(call.id, `Error: ${errMsg}`, toolName);
            this.emit({ type: 'error', message: `Tool ${toolName} failed: ${errMsg}` });
            this.config.onToolResult?.(toolName, `Error: ${errMsg}`, { durationMs: Date.now() - t0, error: true });
            this._toolFailures.set(toolName, failures + 1);

            try {
              const { memoryManager } = await import('../memory/memory-manager.js');
              memoryManager.captureObservation({
                sessionId: this.id,
                cwd,
                tool: toolName,
                input: args,
                output: `Error: ${errMsg}`.slice(0, 2000),
                success: false,
                durationMs: Date.now() - t0,
                tags: [toolName, 'error'],
              });
            } catch {}
          }
        }
      }

      if (this._iterations >= maxIter) {
        const msg = `Reached max ${maxIter} iterations. Say "continue" to keep going.`;
        this.context.addAssistant(msg);
        this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
        return msg;
      }
      this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
      return finalText;
    } finally {
      this._running = false;
    }
  }

  abort(): void {
    this._aborted = true;
    this._abortController.abort();
  }

  get running(): boolean {
    return this._running;
  }

  steer(note: string): void {
    this._steerQueue.push(note);
  }

  private takeSteer(): string | null {
    if (!this._steerQueue.length) return null;
    const s = this._steerQueue.join('\n');
    this._steerQueue = [];
    return s;
  }

  queuePrompt(prompt: string): void {
    if (this._queuedPrompts.includes(prompt)) return;
    if (this._lastFailedPrompt && prompt === this._lastFailedPrompt && Date.now() - this._lastFailTime < 10000) return;
    if (prompt === this._lastUserInput && Date.now() - this._lastInputTime < 5000) return;
    this._queuedPrompts.push(prompt);
  }

  dequeuePrompt(): string | undefined {
    return this._queuedPrompts.shift();
  }

  get queuedCount(): number {
    return this._queuedPrompts.length;
  }

  undo(): string | null {
    const msgs = this.context.getMessages();
    let idx = msgs.length - 1;
    while (idx >= 0 && msgs[idx].role !== 'user') idx--;
    if (idx < 0) return null;
    const removed = msgs[idx].content;
    this.context.replaceMessages(msgs.slice(0, idx));
    this._lastUserInput = null;
    return removed;
  }

  retry(): string | null {
    const last = this.undo();
    return last;
  }

  get lastUserInput(): string | null {
    return this._lastUserInput;
  }

  reset(): void {
    this.context.clear();
    this._initialized = false;
    this._usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, turns: 0, toolCalls: 0, compressions: 0 };
    this._filesTouched.clear();
    this._toolCounts.clear();
    this._startedAt = Date.now();
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
    this.title = null;
    this._lastFailedPrompt = null;
  }

  addSystemSection(text: string): void {
    this._pendingSystemSections.push(text);
    if (this._initialized) this.flushPendingSystemSections();
  }

  private flushPendingSystemSections(): void {
    for (const s of this._pendingSystemSections) this.context.addSystem(s);
    this._pendingSystemSections = [];
  }

  async refreshSystemPrompt(): Promise<void> {
    const cwd = this.config.cwd ?? process.cwd();
    const tools = this.toolRegistry.getDefinitions().map(t => t.function.name);
    const prompt = await SystemPromptBuilder.buildSystemPrompt(cwd, {
      tools,
      model: this.config.model ?? this.config.providerRouter.getCurrentProvider()?.model,
      provider: this.config.provider,
      extraSections: this.config.extraSystemSections,
    });
    this.context.setSystem(prompt);
    this._initialized = true;
  }

  private async ensureSystemPrompt(cwd: string): Promise<void> {
    if (this._initialized) return;
    const tools = this.toolRegistry.getDefinitions().map(t => t.function.name);
    const systemPrompt = await SystemPromptBuilder.buildSystemPrompt(cwd, {
      tools,
      model: this.config.model ?? this.config.providerRouter.getCurrentProvider()?.model,
      provider: this.config.provider,
      extraSections: this.config.extraSystemSections,
    });
    this.context.addSystem(systemPrompt);
    this._initialized = true;
  }

  private async maybeCompress(): Promise<void> {
    const window = this.config.contextWindow ?? this.context.maxTokens;
    const threshold = (this.config.compressThreshold ?? 0.8) * window;
    if (this.context.estimateTokens() <= threshold) return;
    await this.compress();
  }

  async compress(opts: { keepLast?: number; focus?: string } = {}): Promise<{ before: number; after: number }> {
    const before = this.context.estimateTokens();
    const keepLast = opts.keepLast ?? 2;
    const msgs = this.context.getMessages();
    const system = msgs.filter(m => m.role === 'system');
    const rest = msgs.filter(m => m.role !== 'system');

    let userSeen = 0;
    let split = rest.length;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i].role === 'user') {
        userSeen++;
        if (userSeen === keepLast) {
          split = i;
          break;
        }
      }
    }
    if (userSeen < keepLast) split = 0;
    const older = rest.slice(0, split);
    const recent = rest.slice(split);
    if (older.length < 2) {
      this.context.trimToLimit();
      return { before, after: this.context.estimateTokens() };
    }

    let summary = '';
    try {
      const transcript = older
        .map(m => {
          if (m.role === 'tool') return `[tool:${m.name}] ${m.content.slice(0, 600)}`;
          if (m.role === 'assistant' && m.tool_calls?.length) return `[assistant → ${m.tool_calls.map(t => t.function.name).join(', ')}] ${m.content}`;
          return `[${m.role}] ${m.content.slice(0, 2000)}`;
        })
        .join('\n');
      const focus = opts.focus ? ` Pay particular attention to: ${opts.focus}.` : '';
      const res = await this.config.providerRouter.chat(
        [
          { role: 'system', content: 'You compress agent conversation history. Produce a dense, factual summary preserving: goals, decisions, files created/modified, commands run and outcomes, errors and fixes, current state, remaining TODOs. Use short bullet points. No preamble.' },
          { role: 'user', content: `Summarise this conversation so work can continue seamlessly.${focus}\n\n${transcript.slice(0, 60_000)}` },
        ],
        undefined,
        { temperature: 0.1, max_tokens: 1500 }
      );
      summary = (res?.content ?? '').trim();
    } catch {
      summary = '';
    }

    if (!summary) {
      this.context.trimToLimit();
      return { before, after: this.context.estimateTokens() };
    }

    const newMsgs: Message[] = [
      ...system,
      { role: 'user', content: `[Conversation summary — earlier context was compressed]\n${summary}` },
      { role: 'assistant', content: 'Understood. I have the summary of our earlier work and will continue from the current state.' },
      ...recent,
    ];
    while (newMsgs.length && newMsgs[system.length + 2]?.role === 'tool') newMsgs.splice(system.length + 2, 1);
    this.context.replaceMessages(newMsgs);
    this._usage.compressions++;
    const after = this.context.estimateTokens();
    this.config.onCompress?.({ before, after });
    return { before, after };
  }

  getState() {
    return {
      running: this._running,
      iterations: this._iterations,
      aborted: this._aborted,
      messageCount: this.context.length,
      estimatedTokens: this.context.estimateTokens(),
      contextWindow: this.config.contextWindow ?? this.context.maxTokens,
      usage: { ...this._usage },
      elapsedMs: Date.now() - this._startedAt,
      filesTouched: Array.from(this._filesTouched),
      topTools: Array.from(this._toolCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      queued: this._queuedPrompts.length,
      id: this.id,
      title: this.title,
    };
  }

  getUsage(): SessionUsage {
    return { ...this._usage };
  }

  getContext(): ConversationContext {
    return this.context;
  }

  getRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      cwd: this.config.cwd ?? process.cwd(),
      createdAt: new Date(this._startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      usage: { ...this._usage } as Record<string, number>,
      messages: this.context.getMessages(),
    };
  }

  load(data: { id?: string; title?: string | null; messages: Message[]; usage?: Partial<SessionUsage> }): void {
    this.context.replaceMessages(data.messages);
    this._initialized = data.messages.some(m => m.role === 'system');
    if (data.id) this.id = data.id;
    this.title = data.title ?? null;
    if (data.usage) this._usage = { ...this._usage, ...data.usage };
  }

  private emit(event: AgentEvent): void {
    try {
      this.translator.translate(event);
    } catch {}
  }
}
