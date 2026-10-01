/**
 * SubAgentRunner — real sub-agents with isolated context.
 *
 * The value of a sub-agent is not that it is "another agent"; it is that its
 * context is thrown away. An `explore` run may read 40 files and burn 60k tokens
 * of greps and file dumps to answer one question. If that happens in the parent
 * session, those 60k tokens are permanent — they crowd out the code the parent
 * is trying to edit, and they are the direct cause of "the agent forgot what I
 * asked it to do".
 *
 * So a sub-agent gets:
 *   - its own AgentSession and its own ConversationContext
 *   - its own ToolRegistry (read-only for `explore`, so it is *incapable* of writing)
 *   - its own iteration budget (a runaway child cannot consume the parent's)
 *
 * and returns only a text summary. The transcript never enters the parent.
 */

import { AgentSession } from '../agent/agent-session.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import type { ProviderRouter } from '../routing/provider-router.js';
import type { Message } from '../agent/context.js';

export type SubAgentKind = 'explore' | 'general';

export interface SubAgentDefinition {
  kind: SubAgentKind;
  description: string;
  /** Toolsets the child may use. */
  toolsets: string[];
  /** Hard cap on the child's tool iterations. */
  maxIterations: number;
  /** Prepended to the child's task. */
  preamble: string;
  canWrite: boolean;
}

export const SUBAGENTS: Record<SubAgentKind, SubAgentDefinition> = {
  explore: {
    kind: 'explore',
    description:
      'Read-only search specialist. Use for locating files, finding call sites, or answering questions about how the codebase works.',
    toolsets: ['files', 'web', 'git'],
    maxIterations: 20,
    canWrite: false,
    preamble: [
      'You are a read-only exploration sub-agent. You cannot modify files — do not attempt to.',
      'Your job is to find facts and report them concisely.',
      'Prefer breadth first: locate candidate files, then read only what is needed to answer.',
      'When you finish, reply with a short report: the answer, the file paths that support it',
      '(with line numbers where relevant), and anything you could not determine.',
      'Do not include large code dumps — quote at most the few lines that matter.',
    ].join(' '),
  },
  general: {
    kind: 'general',
    description:
      'General-purpose sub-agent for self-contained multi-step tasks that can be completed independently of the parent conversation.',
    toolsets: ['files', 'terminal', 'git', 'web'],
    maxIterations: 40,
    canWrite: true,
    preamble: [
      'You are a sub-agent handling a self-contained task. You will not receive follow-up questions,',
      'so finish the task completely and report clearly.',
      'State what you changed (exact file paths) and how you verified it.',
      'If you could not complete the task, say precisely what blocked you.',
    ].join(' '),
  },
};

export interface SubAgentRunOptions {
  kind: SubAgentKind;
  task: string;
  cwd: string;
  router: ProviderRouter;
  contextWindow?: number;
  /** Extra context handed to the child (e.g. relevant file contents). */
  context?: string;
  /** Extra toolsets the child may use, beyond its preset. */
  extraToolsets?: string[];
  /** Abort signal propagated from the parent. */
  abortSignal?: AbortSignal;
  /** Soft cap on the report returned to the parent. */
  maxReportChars?: number;
  onEvent?: (event: { type: 'start' | 'text' | 'tool' | 'finish'; detail?: string }) => void;
}

export interface SubAgentResult {
  ok: boolean;
  kind: SubAgentKind;
  report: string;
  /** Number of parent-context characters actually consumed by this call. */
  reportChars: number;
  /** Tokens the child burned in its own context (never charged to the parent). */
  childTokens: number;
  toolCalls: number;
  iterations: number;
  error?: string;
}

const DEFAULT_MAX_REPORT = 12_000;

/** Collapse a child transcript to just the final assistant text. */
export function extractReport(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.content && m.content.trim()) return m.content.trim();
  }
  return '';
}

export class SubAgentRunner {
  constructor(private readonly opts: SubAgentRunOptions) {}

  async run(): Promise<SubAgentResult> {
    const def = SUBAGENTS[this.opts.kind];
    if (!def) {
      return emptyResult(this.opts.kind, `Unknown sub-agent kind: ${this.opts.kind}`);
    }

    const toolsets = [...def.toolsets, ...(this.opts.extraToolsets ?? [])];
    const registry = new ToolRegistry({ toolsets });

    // The child never inherits the parent's confirmation prompts, and never
    // inherits write tools unless its own definition allows them.
    const session = new AgentSession({
      providerRouter: this.opts.router,
      cwd: this.opts.cwd,
      contextWindow: this.opts.contextWindow,
      maxIterations: def.maxIterations,
      toolRegistry: def.canWrite ? registry : new ToolRegistry({ toolsets, disabled: ['write_file', 'patch'] }),
      confirmFn: async () => false,
    });

    const prompt = this.opts.context
      ? `${def.preamble}\n\n<context>\n${this.opts.context}\n</context>\n\n<task>\n${this.opts.task}\n</task>`
      : `${def.preamble}\n\n<task>\n${this.opts.task}\n</task>`;

    this.opts.onEvent?.({ type: 'start', detail: this.opts.kind });

    // Propagate parent abort into the child.
    const onAbort = () => session.abort();
    this.opts.abortSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      await session.run(prompt);
      const report = extractReport(session.getContext().getMessages());
      const capped = cap(report, this.opts.maxReportChars ?? DEFAULT_MAX_REPORT);
      const usage = session.getUsage();

      this.opts.onEvent?.({ type: 'finish', detail: `${usage.toolCalls} tool calls` });

      return {
        ok: true,
        kind: this.opts.kind,
        report: capped,
        reportChars: capped.length,
        childTokens: usage.totalTokens,
        toolCalls: usage.toolCalls,
        iterations: usage.turns,
      };
    } catch (err) {
      return emptyResult(this.opts.kind, err instanceof Error ? err.message : String(err));
    } finally {
      this.opts.abortSignal?.removeEventListener('abort', onAbort);
    }
  }
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.25));
  return `${head}\n\n... [${text.length - head.length - tail.length} characters of the sub-agent report omitted] ...\n\n${tail}`;
}

function emptyResult(kind: SubAgentKind, error: string): SubAgentResult {
  return { ok: false, kind, report: '', reportChars: 0, childTokens: 0, toolCalls: 0, iterations: 0, error };
}

/** Format the result for the parent model to read. */
export function renderSubAgentResult(r: SubAgentResult): string {
  if (!r.ok) {
    return `Sub-agent (${r.kind}) failed: ${r.error ?? 'unknown error'}`;
  }
  return [
    `Sub-agent (${r.kind}) report — ${r.toolCalls} tool calls, ${r.iterations} turns,`,
    `~${r.childTokens} tokens spent in an isolated context (not added to yours):`,
    '',
    r.report || '(the sub-agent produced no text report)',
  ].join('\n');
}

/** Toolset names a sub-agent of this kind may use — useful for docs and /agents. */
export function subAgentToolsets(kind: SubAgentKind): string[] {
  return SUBAGENTS[kind]?.toolsets ?? [];
}
