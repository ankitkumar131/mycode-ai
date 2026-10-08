import { ConversationContext, type Message } from './context.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ProviderRouter } from '../routing/provider-router.js';
import { SystemPromptBuilder } from '../prompts/system-prompt.js';
import type { AgentOptions, AgentEvent } from './types.js';
import type { ToolExecuteOptions, SafetyResult, AskUserQuestion } from '../tools/types.js';
import { FailoverCoordinator, describeFailoverReason } from '../routing/failover.js';
import {
  DEFAULT_COMPACTION,
  type CompactionSettings,
  planCompaction,
  buildSummaryPrompt,
  applySummary,
  serializeForSummary,
  findPreviousSummary,
  COMPACTION_SYSTEM_PROMPT,
} from '../session/compaction.js';
import { runDiagnostics, runFormatter, renderVerification } from '../verify/verify.js';
import { todoStore } from '../tools/todo-store.js';
import { snapshotStore } from '../git/snapshots.js';

const MAX_ITERATIONS = 40;
const MAX_CONSECUTIVE_FAILURES_PER_TOOL = 3;
/** Concurrency cap for a parallel group of read-only tool calls. */
const MAX_PARALLEL_TOOLS = 5;

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  compressions: number;
}

export interface VerifyOptions {
  /** Master switch for post-write verification. Default true. */
  enabled?: boolean;
  /** Run the project formatter after a successful write. Default true. */
  formatter?: boolean;
  /** Run type/lint diagnostics after a successful write. Default true. */
  diagnostics?: boolean;
}

export interface SessionConfig extends AgentOptions {
  providerRouter: ProviderRouter;
  cwd?: string;
  toolRegistry?: ToolRegistry;
  /** Approx context window of the active model (tokens) */
  contextWindow?: number;
  /**
   * @deprecated Superseded by `compaction.buffer` (see session/compaction.ts),
   * which measures headroom in tokens rather than as a fraction of the window.
   * A fraction of the window is wrong at both extremes: 20% of a 1M-token window
   * is 200k tokens of unused room, while 20% of an 8k window is 1.6k and compacts
   * far too late. Ignored — kept only so existing configs still typecheck.
   */
  compressThreshold?: number;
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (
    name: string,
    result: string,
    meta: { durationMs: number; error: boolean },
  ) => void;
  onError?: (message: string) => void;
  onFinish?: (usage: { promptTokens: number; completionTokens: number }) => void;
  onCompress?: (info: { before: number; after: number; pruned?: number }) => void;
  confirmFn?: (target: string, context?: string | null, safety?: SafetyResult) => Promise<boolean>;
  /** Extra system-prompt sections (personality, preloaded skills…) */
  extraSystemSections?: string[];
  /** Provider-failover coordinator. When omitted, failover is not tracked. */
  failover?: FailoverCoordinator;
  /** Compaction tuning. See session/compaction.ts for the defaults. */
  compaction?: CompactionSettings;
  /** Post-write verification. */
  verify?: VerifyOptions;

  /** Called when a sub-agent (delegate) starts or finishes. */
  onSubAgent?: (event: { phase: 'start' | 'finish'; agent: string; detail?: string }) => void;
  /**
   * Sub-agent runner, injected by the host. Returns the child's report text.
   * Left unset in restricted contexts, which makes the `delegate` tool explain
   * that it is unavailable rather than silently no-op.
   */
  delegateFn?: (req: { kind: 'explore' | 'general'; task: string }) => Promise<string>;
  /** Ask-the-user handler, injected by the host UI. */
  askUserFn?: (questions: AskUserQuestion[]) => Promise<Record<string, string>>;
}

type RawToolCall = { id: string; type: string; function: { name: string; arguments: string } };

export class AgentSession {
  private config: SessionConfig;
  private context: ConversationContext;
  private toolRegistry: ToolRegistry;
  private _running = false;
  private _iterations = 0;
  private _aborted = false;
  private _abortController: AbortController;
  private _toolFailures: Map<string, number> = new Map();
  private _listeners: Array<(event: AgentEvent) => void> = [];
  private _executedToolCalls: Set<string> = new Set();
  private _initialized = false;
  private _steerQueue: string[] = [];
  private _queuedPrompts: string[] = [];
  private _lastUserInput: string | null = null;
  private _startedAt = Date.now();
  private _usage: SessionUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    turns: 0,
    toolCalls: 0,
    compressions: 0,
  };
  private _filesTouched: Set<string> = new Set();
  private _toolCounts: Map<string, number> = new Map();
  private _pendingSystemSections: string[] = [];
  public id: string;
  public title: string | null = null;

  constructor(config: SessionConfig) {
    this.config = config;
    // Compact against the smallest window in the provider chain when a failover
    // coordinator is present: the conversation must stay representable no matter
    // which provider ends up answering.
    const window = config.contextWindow ?? config.failover?.safeWindow ?? 128_000;
    this.context = new ConversationContext(window);
    this.toolRegistry = config.toolRegistry ?? new ToolRegistry();
    this._abortController = new AbortController();
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async run(input: string): Promise<string> {
    this._running = true;
    this._iterations = 0;
    this._aborted = false;
    this._toolFailures.clear();
    this._executedToolCalls.clear();
    if (this._abortController.signal.aborted) this._abortController = new AbortController();

    const maxIter = this.config.maxIterations ?? MAX_ITERATIONS;
    const cwd = this.config.cwd ?? process.cwd();
    const router = this.config.providerRouter;
    const failover = this.config.failover;

    try {
      await this.ensureSystemPrompt(cwd);
      this.flushPendingSystemSections();

      this.context.addUser(input);
      this._lastUserInput = input;
      this._usage.turns++;
      let finalText = '';

      while (this._iterations < maxIter && !this._aborted) {
        this._iterations++;
        failover?.setTurn(this._iterations);
        await this.maybeCompress();

        // ── Provider handoff: tell the model when it is not the first to work on this
        if (failover) {
          const brief = failover.buildHandoffBrief();
          if (brief) {
            this.context.addSystem(brief);
            failover.reset();
          }
          const active = router.getCurrentProvider();
          if (active) failover.pinForTurn(active.name);
        }

        const messages = this.context.getHistory();
        // The tool surface is derived from the pinned provider so it cannot
        // change underneath a turn that already planned its edits.
        const toolDefs = this.toolRegistry.getDefinitions();

        let response = '';
        let toolCalls: RawToolCall[] | undefined;
        let reasoning = '';
        let thinkingSignature: string | undefined;
        let usage = { promptTokens: 0, completionTokens: 0 };
        const providerBefore = router.getCurrentProvider()?.name ?? null;

        try {
          const result = await router.chat(messages, toolDefs.length > 0 ? toolDefs : undefined, {
            abortSignal: this._abortController.signal,
            onStream: (chunk: string) => this.config.onText?.(chunk),
            onReasoning: (chunk: string) => this.config.onReasoning?.(chunk),
          });
          response = result.content ?? '';
          toolCalls = result.toolCalls;
          // Preserve the reasoning block so the next request can return it to the
          // provider verbatim (required by the native Anthropic API).
          reasoning = result.reasoning ?? '';
          thinkingSignature = result.thinkingSignature;
          if (result.usage) {
            usage = {
              promptTokens: result.usage.prompt_tokens ?? 0,
              completionTokens: result.usage.completion_tokens ?? 0,
            };
            this._usage.promptTokens += usage.promptTokens;
            this._usage.completionTokens += usage.completionTokens;
            this._usage.totalTokens = this._usage.promptTokens + this._usage.completionTokens;
          }
        } catch (err) {
          if (this._aborted) return 'Interrupted.';
          const errMsg = err instanceof Error ? err.message : String(err);
          this.config.onError?.(errMsg);
          this.emit({ type: 'error', message: errMsg });
          return errMsg;
        }

        if (this._aborted) {
          if (response) this.context.addAssistant(response + '\n[interrupted]');
          return 'Interrupted.';
        }

        // ── Record which provider actually answered, and checkpoint on a switch
        if (failover) {
          const providerAfter = router.getCurrentProvider()?.name ?? null;
          // Prefer the router's own account of the failure; fall back to the
          // before/after comparison when the router did not report one.
          const reported = (router as { lastFailover?: { reason?: string } | null }).lastFailover;
          const reason =
            reported?.reason ??
            (providerAfter && providerBefore && providerAfter !== providerBefore
              ? describeFailoverReason(null)
              : undefined);
          await failover.observe(providerAfter ?? 'unknown', {
            reason,
            sessionId: this.id,
            messages: this.context.getMessages(),
            todos: todoStore.snapshot(this.id),
            usage: this._usage,
          });
        }

        if (response) this.emit({ type: 'text', content: response });

        if (!toolCalls || toolCalls.length === 0) {
          this.context.addAssistant(response);
          finalText = response;
          this.emit({ type: 'finish', usage });
          this.config.onFinish?.(usage);
          return finalText;
        }

        this.context.addAssistantWithTools(response, toolCalls, {
          text: reasoning || undefined,
          signature: thinkingSignature,
        });

        await this.executeToolCalls(toolCalls, cwd);
      }

      if (this._iterations >= maxIter) {
        return await this.finishAtStepLimit(maxIter, cwd);
      }
      this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
      return finalText;
    } finally {
      this._running = false;
    }
  }

  /** Retune the iteration cap for subsequent runs (the cap is per session). */
  setMaxIterations(iterations: number): void {
    if (Number.isFinite(iterations) && iterations > 0) this.config.maxIterations = iterations;
  }

  abort(): void {
    this._aborted = true;
    this._abortController.abort();
  }

  get running(): boolean {
    return this._running;
  }

  // ─── Tool execution ───────────────────────────────────────────────────────

  /**
   * Execute a turn's tool calls.
   *
   * Consecutive read-only calls are batched and run concurrently (bounded),
   * while write-capable calls stay strictly ordered and serial. This keeps the
   * ordering guarantees that matter — two writes to the same file must not race —
   * while collapsing the exploration bursts that dominate agent latency.
   */
  private async executeToolCalls(toolCalls: RawToolCall[], cwd: string): Promise<void> {
    const groups = this.groupToolCalls(toolCalls);

    for (const group of groups) {
      if (this._aborted) {
        for (const call of group) {
          this.context.addToolResult(
            call.id,
            'Interrupted by user before execution.',
            call.function.name,
          );
        }
        continue;
      }

      if (group.length === 1 || !group.parallel) {
        for (const call of group) await this.executeOne(call, cwd);
        continue;
      }

      // Parallel read burst, chunked to respect the concurrency cap.
      for (let i = 0; i < group.length; i += MAX_PARALLEL_TOOLS) {
        const batch = group.slice(i, i + MAX_PARALLEL_TOOLS);
        await Promise.all(batch.map((call) => this.executeOne(call, cwd)));
      }
    }
  }

  private groupToolCalls(
    toolCalls: RawToolCall[],
  ): Array<Array<RawToolCall> & { parallel?: boolean }> {
    const groups: Array<RawToolCall[] & { parallel?: boolean }> = [];
    let current: (RawToolCall[] & { parallel?: boolean }) | null = null;

    for (const call of toolCalls) {
      const isWrite = this.toolRegistry.isWriteTool(call.function.name);
      if (isWrite) {
        const g = [call] as RawToolCall[] & { parallel?: boolean };
        g.parallel = false;
        groups.push(g);
        current = null;
      } else if (current && current.parallel) {
        current.push(call);
      } else {
        const g = [call] as RawToolCall[] & { parallel?: boolean };
        g.parallel = true;
        groups.push(g);
        current = g;
      }
    }
    return groups;
  }

  private async executeOne(call: RawToolCall, cwd: string): Promise<void> {
    const toolName = call.function.name;

    if (this._aborted) {
      this.context.addToolResult(call.id, 'Interrupted by user before execution.', toolName);
      return;
    }

    let args: Record<string, unknown>;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      this.context.addToolResult(
        call.id,
        `Error: arguments were not valid JSON: ${call.function.arguments.slice(0, 200)}`,
        toolName,
      );
      return;
    }

    const callKey = `${toolName}:${call.function.arguments}`;
    if (this._executedToolCalls.has(callKey) && !this.toolRegistry.isWriteTool(toolName)) {
      this.context.addToolResult(
        call.id,
        'Skipped: identical call already executed this turn — use the earlier result.',
        toolName,
      );
      return;
    }
    const failures = this._toolFailures.get(toolName) ?? 0;
    if (failures >= MAX_CONSECUTIVE_FAILURES_PER_TOOL) {
      this.context.addToolResult(
        call.id,
        `Error: ${toolName} failed ${failures} times in a row. Stop retrying it and try a different approach or ask the user.`,
        toolName,
      );
      return;
    }

    this._executedToolCalls.add(callKey);
    this._usage.toolCalls++;
    this._toolCounts.set(toolName, (this._toolCounts.get(toolName) ?? 0) + 1);

    const isWrite = this.toolRegistry.isWriteTool(toolName);
    const writtenPath = isWrite && typeof args.path === 'string' ? (args.path as string) : null;
    if (writtenPath) {
      this._filesTouched.add(writtenPath);
      // Record the pre-edit contents so the change can actually be undone. The
      // store keeps only the FIRST capture per file, so /undo restores the state
      // from before the agent started rather than an intermediate one.
      snapshotStore.capture(
        this.id,
        writtenPath.startsWith('/') ? writtenPath : `${cwd}/${writtenPath}`,
      );
    }

    this.emit({ type: 'tool_call', name: toolName, args });
    this.config.onToolCall?.(toolName, args);

    const t0 = Date.now();
    try {
      const execOptions: ToolExecuteOptions = {
        abortSignal: this._abortController.signal,
        confirmFn: this.config.confirmFn,
        sessionId: this.id,
        delegate: this.config.delegateFn,
        askUser: this.config.askUserFn,
      };
      let result = await this.toolRegistry.executeTool(toolName, args, cwd, execOptions);

      // Verification closes the write → check → fix loop. Appending real compiler
      // output to the tool result means the model sees its own errors next turn.
      if (writtenPath) {
        const verification = await this.verifyAfterWrite(writtenPath, cwd);
        if (verification) result += `\n\n${verification}`;
      }

      // Steering: append any queued notes to this tool result.
      const steer = this.takeSteer();
      if (steer) result += `\n\n[User note while you were working]: ${steer}`;

      this.context.addToolResult(call.id, result, toolName);
      this.emit({ type: 'tool_result', name: toolName, result });
      this.config.onToolResult?.(toolName, result, { durationMs: Date.now() - t0, error: false });
      this._toolFailures.set(toolName, 0);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.context.addToolResult(call.id, `Error: ${errMsg}`, toolName);
      this.emit({ type: 'error', message: `Tool ${toolName} failed: ${errMsg}` });
      this.config.onToolResult?.(toolName, `Error: ${errMsg}`, {
        durationMs: Date.now() - t0,
        error: true,
      });
      this._toolFailures.set(toolName, failures + 1);
    }
  }

  private async verifyAfterWrite(filePath: string, cwd: string): Promise<string | null> {
    const v = this.config.verify ?? {};
    if (v.enabled === false) return null;
    if (v.formatter === false && v.diagnostics === false) return null;

    const abs =
      filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath) ? filePath : `${cwd}/${filePath}`;
    try {
      let formatted = '';
      if (v.formatter !== false) {
        const f = await runFormatter([abs], cwd);
        formatted = f.formatted;
      }
      let diagnostics = '';
      if (v.diagnostics !== false) {
        const d = await runDiagnostics([abs], cwd);
        diagnostics = d.diagnostics;
      }
      const rendered = renderVerification({ diagnostics, formatted, ran: [], skipped: false });
      return rendered.trim() ? rendered : null;
    } catch {
      return null;
    }
  }

  /**
   * Step limit reached. Rather than stopping on an arbitrary text message, make
   * one final tool-free call asking for a structured handoff, so the user gets a
   * resume-able summary instead of a truncated loop.
   */
  private async finishAtStepLimit(maxIter: number, _cwd: string): Promise<string> {
    const notice =
      `CRITICAL - MAXIMUM STEPS REACHED\n\n` +
      `The maximum number of steps allowed for this task has been reached (${maxIter}). ` +
      `Tools are disabled until next user input. Respond with text only.\n\n` +
      `STRICT REQUIREMENTS:\n` +
      `1. Do NOT make any tool calls.\n` +
      `2. MUST provide a text response summarising work done so far.\n\n` +
      `Response must include:\n` +
      `- Statement that the step limit was reached\n` +
      `- Summary of what has been accomplished\n` +
      `- List of remaining tasks not yet completed\n` +
      `- Recommendations for what should be done next`;

    const fallback = `Reached the maximum of ${maxIter} tool iterations for this turn. Say "continue" to keep going.`;

    try {
      this.context.addUser(notice);
      const res = await this.config.providerRouter.chat(this.context.getHistory(), undefined, {
        abortSignal: this._abortController.signal,
      });
      const text = (res?.content ?? '').trim();
      if (text) {
        this.context.addAssistant(text);
        this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
        return text;
      }
    } catch {
      /* fall through to the static message */
    }

    this.context.addAssistant(fallback);
    this.config.onFinish?.({ promptTokens: 0, completionTokens: 0 });
    return fallback;
  }

  // ─── Steering / queueing ──────────────────────────────────────────────────

  /** Inject a note that reaches the model after the next tool call (no interrupt). */
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
    this._queuedPrompts.push(prompt);
  }

  dequeuePrompt(): string | undefined {
    return this._queuedPrompts.shift();
  }

  get queuedCount(): number {
    return this._queuedPrompts.length;
  }

  // ─── History manipulation ─────────────────────────────────────────────────

  /** Remove the last user→assistant exchange. Returns the removed user prompt. */
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

  /** Undo the last exchange and return the prompt to re-run. */
  retry(): string | null {
    const last = this.undo();
    return last;
  }

  get lastUserInput(): string | null {
    return this._lastUserInput;
  }

  reset(): void {
    todoStore.clear(this.id);
    this.context.clear();
    this._initialized = false;
    this._usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolCalls: 0,
      compressions: 0,
    };
    this._filesTouched.clear();
    this._toolCounts.clear();
    this._startedAt = Date.now();
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
    this.title = null;
  }

  /** Add a system-level section that will be injected before the next turn. */
  addSystemSection(text: string): void {
    this._pendingSystemSections.push(text);
    if (this._initialized) this.flushPendingSystemSections();
  }

  private flushPendingSystemSections(): void {
    for (const s of this._pendingSystemSections) this.context.addSystem(s);
    this._pendingSystemSections = [];
  }

  /** Rebuild the system prompt (after skill install, model switch, etc.). */
  async refreshSystemPrompt(): Promise<void> {
    const cwd = this.config.cwd ?? process.cwd();
    const tools = this.toolRegistry.getDefinitions().map((t) => t.function.name);
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
    const tools = this.toolRegistry.getDefinitions().map((t) => t.function.name);
    const systemPrompt = await SystemPromptBuilder.buildSystemPrompt(cwd, {
      tools,
      model: this.config.model ?? this.config.providerRouter.getCurrentProvider()?.model,
      provider: this.config.provider,
      extraSections: this.config.extraSystemSections,
    });
    this.context.addSystem(systemPrompt);
    this._initialized = true;
  }

  // ─── Compression ──────────────────────────────────────────────────────────

  private async maybeCompress(): Promise<void> {
    const settings = { ...DEFAULT_COMPACTION, ...(this.config.compaction ?? {}) };
    if (!settings.auto) return;
    const window = this.config.contextWindow ?? this.context.maxTokens;
    const used = this.context.estimateTokens();
    if (used <= Math.max(1_000, window - settings.buffer)) return;
    await this.compress();
  }

  /**
   * Reduce context without losing the thread.
   *
   * Keeps a token-budgeted tail verbatim, prunes stale tool output, and rolls the
   * previous summary forward so successive compactions accumulate rather than
   * each forgetting the last.
   */
  async compress(
    opts: { keepTokens?: number; focus?: string; force?: boolean } = {},
  ): Promise<{ before: number; after: number }> {
    const settings = { ...DEFAULT_COMPACTION, ...(this.config.compaction ?? {}) };
    const before = this.context.estimateTokens();
    const messages = this.context.getMessages();

    const plan = planCompaction(messages, {
      ...settings,
      keepTokens: opts.keepTokens ?? settings.keepTokens,
      reason: opts.force ? 'forced' : 'threshold',
    });

    if (plan.reason === 'no-op' || plan.older.length < 2) {
      const removed = this.context.trimToLimit();
      void removed;
      return { before, after: this.context.estimateTokens() };
    }

    const previousSummary = findPreviousSummary(messages);
    const todos = todoStore.snapshot(this.id);
    const transcript = serializeForSummary(plan.older);

    let summary = '';
    try {
      const prompt = buildSummaryPrompt({
        transcript,
        previousSummary,
        focus: opts.focus,
        todos,
        totalChars: 120_000,
      });
      const res = await this.config.providerRouter.chat(
        [
          { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        undefined,
        { temperature: 0.1, max_tokens: settings.summaryOutputTokens },
      );
      summary = (res?.content ?? '').trim();
    } catch {
      summary = '';
    }

    if (!summary) {
      // Summarisation failed: fall back to deterministic trimming rather than
      // losing the tail entirely.
      const removed = this.context.trimToLimit();
      void removed;
      return { before, after: this.context.estimateTokens() };
    }

    const next = applySummary(messages, summary, plan.recent);
    this.context.replaceMessages(next);
    this._usage.compressions++;
    const after = this.context.estimateTokens();
    this.config.onCompress?.({ before, after, pruned: plan.pruned });
    return { before, after };
  }

  // ─── Introspection ────────────────────────────────────────────────────────

  getState() {
    const window = this.config.contextWindow ?? this.context.maxTokens;
    const used = this.context.estimateTokens();
    return {
      running: this._running,
      iterations: this._iterations,
      aborted: this._aborted,
      messageCount: this.context.length,
      estimatedTokens: used,
      contextWindow: window,
      contextPercent: window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0,
      usage: { ...this._usage },
      elapsedMs: Date.now() - this._startedAt,
      filesTouched: Array.from(this._filesTouched),
      topTools: Array.from(this._toolCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      queued: this._queuedPrompts.length,
      id: this.id,
      title: this.title,
      failover: this.config.failover
        ? { count: this.config.failover.count, summary: this.config.failover.summary() }
        : null,
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

  /** Serialise for /save & resume. */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      cwd: this.config.cwd ?? process.cwd(),
      createdAt: new Date(this._startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      usage: { ...this._usage } as Record<string, number>,
      todos: todoStore.snapshot(this.id),
      messages: this.context.getMessages(),
    };
  }

  /** Restore from a saved session (messages incl. system prompt). */
  load(data: {
    id?: string;
    title?: string | null;
    messages: Message[];
    usage?: Partial<SessionUsage>;
    todos?: unknown;
  }): void {
    this.context.replaceMessages(data.messages);
    this._initialized = data.messages.some((m) => m.role === 'system');
    if (data.id) this.id = data.id;
    this.title = data.title ?? null;
    if (data.usage) this._usage = { ...this._usage, ...data.usage };
    if (data.todos) todoStore.restore(this.id, data.todos);
  }

  /**
   * Subscribe to session events (text, tool call/result, error, finish).
   * Returns an unsubscribe function. Listener errors are swallowed so a broken
   * listener can never abort a task.
   */
  onEvent(listener: (event: AgentEvent) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const i = this._listeners.indexOf(listener);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        /* best-effort: a listener must not break the session */
      }
    }
  }
}
