/**
 * Session-scoped approvals.
 *
 * "Allow all" here means: stop asking — for the rest of *this session*, where a
 * session is the conversation, not the process. Follow-up questions keep the
 * bypass; exiting, `/new` / `/clear` (which start a fresh conversation) and
 * `/allow-all off` all end it. Nothing is written to settings.json, so a
 * decision made in a hurry is never silently inherited by the next session.
 *
 * It does *not* remove the hard floor in `command-safety.ts`. A short list of
 * genuinely catastrophic commands (`rm -rf /`, `mkfs`, writing to a raw disk,
 * `halt`/`reboot`) stays blocked even here. That is deliberate: "don't interrupt
 * me" is not the same instruction as "format my disk", and a bypass that can be
 * reached by a mis-typed prompt is how people lose machines.
 *
 * Scope is per-category so the common case — "stop asking me about file edits,
 * keep asking before you run things" — is expressible.
 */

export type ApprovalScope = 'writes' | 'commands';

export interface ApprovalDecision {
  allowed: boolean;
  /** Which scope granted it, for logging and the status line. */
  via?: ApprovalScope | 'all';
}

export interface SessionApprovalsStatus {
  /** True when every scope is bypassed. */
  all: boolean;
  writes: boolean;
  commands: boolean;
  /** Milliseconds since the bypass was armed, if it is on. */
  activeForMs: number | null;
}

export class SessionApprovals {
  private writes = false;
  private commands = false;
  private armedAt: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Bypass everything. */
  allowAll(at: number = this.now()): void {
    this.writes = true;
    this.commands = true;
    if (this.armedAt === null) this.armedAt = at;
  }

  /** Bypass one category. */
  allow(scope: ApprovalScope, at: number = this.now()): void {
    if (scope === 'writes') this.writes = true;
    else this.commands = true;
    if (this.armedAt === null) this.armedAt = at;
  }

  /** Turn everything back on. */
  revoke(): void {
    this.writes = false;
    this.commands = false;
    this.armedAt = null;
  }

  /**
   * Is an action of this kind pre-approved?
   *
   * `writes` covers file mutation, `commands` covers shell execution — the same
   * split as `preferences.confirmWrites` / `confirmCommands`.
   */
  isAllowed(scope: ApprovalScope): boolean {
    return scope === 'writes' ? this.writes : this.commands;
  }

  /** True when nothing is bypassed, i.e. the user is still being asked. */
  get isOff(): boolean {
    return !this.writes && !this.commands;
  }

  /** True when the bypass covers every category. */
  get isEverything(): boolean {
    return this.writes && this.commands;
  }

  status(at: number = this.now()): SessionApprovalsStatus {
    return {
      all: this.isEverything,
      writes: this.writes,
      commands: this.commands,
      activeForMs: this.armedAt === null ? null : Math.max(0, at - this.armedAt),
    };
  }

  /** Short label for the status line, or null when nothing is bypassed. */
  badge(): string | null {
    if (this.isEverything) return 'ALLOW-ALL';
    const parts: string[] = [];
    if (this.writes) parts.push('writes');
    if (this.commands) parts.push('commands');
    return parts.length ? `ALLOW-ALL:${parts.join('+')}` : null;
  }

  /** The text shown when the bypass is armed: what it covers, and what it does not. */
  describe(): string[] {
    if (this.isOff) return ['Approvals are on: writes and commands are confirmed as configured.'];
    const scope = this.isEverything
      ? 'file writes and shell commands'
      : this.writes
        ? 'file writes'
        : 'shell commands';
    return [
      `Approval prompts are off for ${scope}, for this session only.`,
      'Nothing is written to settings — exiting restores your normal approval mode.',
      'Catastrophic commands stay blocked (disk formatting, writing to raw devices, power control).',
    ];
  }
}

/** Parse `/allow-all` arguments into an action. Unknown input is reported, not guessed. */
export function parseAllowAllArgs(
  args: string,
):
  | { action: 'status' }
  | { action: 'on'; scope?: ApprovalScope }
  | { action: 'off' }
  | { action: 'invalid'; input: string } {
  const a = args.trim().toLowerCase();
  if (!a || a === 'all' || a === 'on' || a === 'everything') return { action: 'on' };
  if (a === 'off' || a === 'revoke' || a === 'reset' || a === 'none') return { action: 'off' };
  if (a === 'status' || a === 'show') return { action: 'status' };
  if (a === 'writes' || a === 'write' || a === 'edits' || a === 'edit' || a === 'files')
    return { action: 'on', scope: 'writes' };
  if (a === 'commands' || a === 'command' || a === 'shell' || a === 'exec')
    return { action: 'on', scope: 'commands' };
  return { action: 'invalid', input: args.trim() };
}

/**
 * The single decision point: do we need to interrupt the user for this action?
 *
 * Both approval gates in the chat loop (agent tool calls and `!cmd` shell runs)
 * ask this, so the answer cannot drift between them.
 *
 * Precedence, highest first:
 *   1. `--yolo` / `/approvals off` — an explicit startup decision
 *   2. a session bypass from `/allow-all`
 *   3. the configured preference for that category
 */
export function shouldPrompt(
  approvals: SessionApprovals,
  opts: {
    /** Set by --yolo, /yolo or /approvals off. */
    yolo: boolean;
    /** True for shell execution, false for a file mutation. */
    isCommand: boolean;
    confirmCommands: boolean;
    confirmWrites: boolean;
  },
): boolean {
  if (opts.yolo) return false;
  if (approvals.isAllowed(opts.isCommand ? 'commands' : 'writes')) return false;
  return opts.isCommand ? opts.confirmCommands : opts.confirmWrites;
}
