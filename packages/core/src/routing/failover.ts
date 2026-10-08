/**
 * Failover coordination — making a mid-task provider switch survivable.
 *
 * Priority-based failover is MyCode's differentiator, but a switch is not a
 * cosmetic event: the replacement provider has a different tokenizer, a
 * different context window, and often a different tool-calling dialect. The
 * failure modes this module addresses are:
 *
 *   1. THE USER SEES NOTHING. The answer quietly comes from a different model,
 *      and any behavioural change looks like the agent getting worse.
 *   2. STATE IS LOST. If the process dies after the switch, the work done so far
 *      is gone. A checkpoint is written *before* continuing.
 *   3. THE MODEL RESTARTS. Without re-orientation the new model re-reads files
 *      it already read and re-does finished work.
 *   4. THE WINDOW SHRINKS. Compaction measured against the strongest provider
 *      overflows the moment the weakest one takes over.
 *   5. THE TOOL SURFACE SHIFTS MID-TURN. The model is told it has a tool, then
 *      the provider changes and it does not.
 */

import type { ProviderConfig } from './types.js';

export interface FailoverEvent {
  /** Provider that failed or was superseded. */
  from: string;
  /** Provider now serving the session. */
  to: string;
  /** Human-readable cause, from `describeFailoverReason`. */
  reason: string;
  at: number;
  /** Agent iteration at which the switch was observed. */
  turn: number;
}

export interface CheckpointPayload {
  sessionId: string;
  reason: string;
  event: FailoverEvent;
  messages?: unknown;
  todos?: unknown;
  usage?: unknown;
}

export type CheckpointFn = (payload: CheckpointPayload) => void | Promise<void>;

export interface FailoverCoordinatorOptions {
  providers?: readonly ProviderConfig[];
  /** Persist session state. Called before the session continues. */
  onCheckpoint?: CheckpointFn;
  /** Tell the user. Called after the checkpoint succeeds. */
  onAnnounce?: (event: FailoverEvent) => void;
}

/**
 * Model-name → context window. Only used when the provider config does not state
 * one explicitly; an explicit value always wins, because guessing wrong in either
 * direction is expensive (overflow, or needless compaction).
 */
const WINDOW_HINTS: Record<string, number> = {
  gemini: 1_000_000,
  claude: 200_000,
  'gpt-4.1': 200_000,
  'gpt-5': 200_000,
  o3: 200_000,
  o4: 200_000,
  deepseek: 200_000,
  qwen3: 200_000,
  kimi: 200_000,
  grok: 200_000,
  'gpt-4o': 128_000,
  'llama-3': 128_000,
  llama3: 128_000,
  mistral: 128_000,
  gemma: 128_000,
};

export function effectiveWindowFor(
  cfg: ProviderConfig,
  table: Record<string, number> = {},
  fallback = 128_000,
): number {
  if (typeof cfg.contextWindow === 'number' && cfg.contextWindow > 0) return cfg.contextWindow;
  const model = (cfg.model ?? '').toLowerCase();
  for (const [key, value] of Object.entries(table)) {
    if (model.includes(key.toLowerCase())) return value;
  }
  for (const [key, value] of Object.entries(WINDOW_HINTS)) {
    if (model.includes(key)) return value;
  }
  return fallback;
}

/**
 * The smallest context window across the chain. Compacting against this number
 * means the conversation stays representable no matter which provider answers —
 * the alternative is a hard overflow the moment failover happens.
 */
export function safeContextWindow(
  providers: readonly ProviderConfig[],
  table: Record<string, number> = {},
): number {
  if (!providers.length) return 128_000;
  return Math.min(...providers.map((p) => effectiveWindowFor(p, table)));
}

/**
 * Turn an arbitrary provider error into a short phrase a human would say.
 *
 * Recognises MyCode's typed provider errors by `name` rather than `instanceof`:
 * the same class can be loaded twice (ESM/CJS interop, duplicated bundles), and
 * a failed instanceof check would silently degrade every reason to a raw message.
 */
export function describeFailoverReason(err: unknown): string {
  const e = err as { name?: string; message?: string; statusCode?: number };
  const msg = (e?.message ?? '').toLowerCase();
  const status = e?.statusCode;
  const name = e?.name ?? '';

  if (name === 'RateLimitError') return 'rate limited';
  if (name === 'AuthError') return 'authentication failed';
  if (name === 'ContextLengthError') return 'context window exceeded';
  if (name === 'ProviderServerError') {
    return status ? `provider server error (${status})` : 'provider server error';
  }

  if (status === 429 || /rate.?limit/.test(msg)) return 'rate limited';
  if (status === 401 || status === 403 || /auth|api key|unauthor/.test(msg))
    return 'authentication failed';
  if (/context length|too long|maximum context|token limit/.test(msg))
    return 'context window exceeded';
  if (typeof status === 'number' && status >= 500) return `provider server error (${status})`;
  if (/econnrefused|enotfound|etimedout|network|fetch failed|socket/.test(msg))
    return 'connection failed';
  if (/model not found|no such model|invalid model/.test(msg)) return 'model unavailable';
  if (/overloaded|capacity/.test(msg)) return 'provider overloaded';
  return e?.message ? e.message.slice(0, 80) : 'unknown error';
}

export class FailoverCoordinator {
  private readonly providers: ProviderConfig[];
  private readonly onCheckpoint?: CheckpointFn;
  private readonly onAnnounce?: (event: FailoverEvent) => void;

  private currentName: string | null = null;
  private ledger: FailoverEvent[] = [];
  private turn = 0;

  /** Provider name pinned for the current turn (sticky tool surface). */
  private pinnedForTurn: string | null = null;
  private pinnedTurn = -1;

  constructor(opts: FailoverCoordinatorOptions) {
    this.providers = [...(opts.providers ?? [])];
    this.onCheckpoint = opts.onCheckpoint;
    this.onAnnounce = opts.onAnnounce;
  }

  /** Smallest usable window across the chain — use this for compaction thresholds. */
  get safeWindow(): number {
    return safeContextWindow(this.providers);
  }

  setTurn(turn: number): void {
    this.turn = turn;
  }

  /**
   * Pin the provider used for this turn. The tool surface is derived once per
   * turn from this provider, so a failover inside the turn cannot change which
   * tools the model was told it has.
   */
  pinForTurn(providerName: string): void {
    if (this.pinnedTurn !== this.turn) {
      this.pinnedForTurn = providerName;
      this.pinnedTurn = this.turn;
    }
  }

  get pinnedProvider(): string | null {
    return this.pinnedForTurn;
  }

  /**
   * Record the provider that actually served a call. Returns a FailoverEvent
   * when the serving provider changed, otherwise null.
   */
  async observe(
    providerName: string,
    ctx: {
      reason?: string;
      sessionId?: string;
      messages?: unknown;
      todos?: unknown;
      usage?: unknown;
    } = {},
  ): Promise<FailoverEvent | null> {
    const previous = this.currentName;
    this.currentName = providerName;

    if (previous === null || previous === providerName) return null;

    const event: FailoverEvent = {
      from: previous,
      to: providerName,
      reason: ctx.reason ?? 'provider switch',
      at: Date.now(),
      turn: this.turn,
    };
    this.ledger.push(event);

    // Persist before continuing: if the new provider also fails, the work so far
    // is still on disk rather than lost with the process.
    if (this.onCheckpoint && ctx.sessionId) {
      try {
        await this.onCheckpoint({
          sessionId: ctx.sessionId,
          reason: event.reason,
          event,
          messages: ctx.messages,
          todos: ctx.todos,
          usage: ctx.usage,
        });
      } catch {
        // A failed checkpoint must not abort the task.
      }
    }

    try {
      this.onAnnounce?.(event);
    } catch {
      /* UI callbacks are best-effort */
    }

    return event;
  }

  /** Seed the initial provider without recording a failover. */
  prime(providerName: string): void {
    if (this.currentName === null) this.currentName = providerName;
  }

  get current(): string | null {
    return this.currentName;
  }

  get events(): readonly FailoverEvent[] {
    return this.ledger;
  }

  get count(): number {
    return this.ledger.length;
  }

  /**
   * A short re-orientation for the model that just took over. Deliberately terse:
   * it is prepended to one turn, not kept in history.
   */
  buildHandoffBrief(): string | null {
    if (!this.ledger.length) return null;
    const last = this.ledger[this.ledger.length - 1];
    const lines = [
      `[System note — provider failover]`,
      `You are continuing work that started on a different model ("${last.from}"). ` +
        `That provider became unavailable (${last.reason}) and you are now serving as "${last.to}".`,
      `The conversation history above is unchanged and authoritative. Treat it as your own prior work.`,
      `If a tool you expect is missing, it is unavailable on this provider — do not retry it; ` +
        `use an alternative or report the limitation.`,
      `Do not restart completed work. Continue from the current state.`,
    ];
    if (this.ledger.length > 1) {
      lines.push(`This session has failed over ${this.ledger.length} times.`);
    }
    return lines.join('\n');
  }

  /** Compact one-line summary for the status line / /status. */
  summary(): string | null {
    if (!this.ledger.length) return null;
    const names = [this.ledger[0].from, ...this.ledger.map((e) => e.to)];
    return `${names.join(' -> ')} (${this.ledger.length} failover${this.ledger.length === 1 ? '' : 's'})`;
  }

  reset(): void {
    this.currentName = null;
    this.ledger = [];
    this.pinnedForTurn = null;
    this.pinnedTurn = -1;
  }
}
