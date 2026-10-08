/**
 * Compaction — context reduction that preserves the thread of the work.
 *
 * Three properties distinguish this from simple summarisation, and each fixes a
 * specific failure that shows up on long tasks:
 *
 *   1. TOKEN BUDGET, not turn count. Keeping "the last 2 user turns" is
 *      meaningless when one turn contains a 60k-character file dump and another
 *      is a one-line question.
 *
 *   2. A FIXED TEMPLATE. Free-form "summarise this" prompts drift: each
 *      compaction emphasises different things, and the model loses the objective.
 *      A stable schema means compaction #4 still contains the same fields as #1.
 *
 *   3. ROLL-FORWARD. The previous summary is merged into the new one rather than
 *      discarded. Without this, detail decays geometrically — compaction #3 has
 *      no access to what #1 recorded. The rule is explicit: the newer
 *      conversation wins where the two conflict.
 *
 * Pure functions only — no I/O, no provider calls — so this is unit-testable and
 * cheap to reason about.
 */

import type { Message } from '../agent/context.js';
import { normalizeTodos, type Todo } from '../tools/todo-store.js';

const TOKEN_RATIO = 4;

export const DEFAULT_COMPACTION = {
  auto: true,
  /** Headroom left below the context window before compaction triggers. */
  buffer: 20_000,
  /** Recent tokens kept verbatim. */
  keepTokens: 8_000,
  /** Replace stale tool results with a stub before summarising. */
  prune: true,
  /** Caps the summary request. */
  summaryOutputTokens: 4_096,
  /** Tool results longer than this are stubbed when pruned. */
  toolOutputMaxChars: 2_000,
} as const;

export interface CompactionSettings {
  auto?: boolean;
  buffer?: number;
  keepTokens?: number;
  prune?: boolean;
  summaryOutputTokens?: number;
  toolOutputMaxChars?: number;
}

export interface CompactionPlan {
  /** Messages that will be summarised away. */
  older: Message[];
  /** Messages kept verbatim. */
  recent: Message[];
  /** Estimated tokens before reduction. */
  tokensBefore: number;
  /** Estimated tokens of the kept tail. */
  tokensKept: number;
  /** Tool results replaced with stubs by pruning. */
  pruned: number;
  reason: 'threshold' | 'forced' | 'no-op';
}

export function resolveSettings(s: CompactionSettings = {}) {
  return { ...DEFAULT_COMPACTION, ...s };
}

/** Per-message token estimate. Serialised form, matching what the provider sees. */
export function estimateMessageTokens(m: Message): number {
  return Math.ceil(JSON.stringify(m).length / TOKEN_RATIO);
}

export function estimateTokens(messages: readonly Message[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

/** Should compaction run? */
export function shouldCompact(
  currentTokens: number,
  contextWindow: number,
  s: CompactionSettings = {},
): boolean {
  const { auto, buffer } = resolveSettings(s);
  if (!auto) return false;
  return currentTokens > Math.max(1_000, contextWindow - buffer);
}

/**
 * Replace long tool results that are no longer recent with a short stub.
 * Anything the model still needs can be re-read from disk; keeping 60k of
 * file contents in context "just in case" is what causes premature compaction.
 */
export function pruneStaleToolOutput(
  messages: readonly Message[],
  keepFromIndex: number,
  maxChars: number,
): {
  messages: Message[];
  pruned: number;
} {
  let pruned = 0;
  const out = messages.map((m, i) => {
    if (i >= keepFromIndex || m.role !== 'tool' || m.content.length <= maxChars) return m;
    pruned++;
    const head = m.content.slice(0, 400);
    return {
      ...m,
      content:
        `${head}\n\n[tool output pruned during compaction — ${m.content.length} characters. ` +
        `Re-run the tool or read the file if you need this again.]`,
    };
  });
  return { messages: out, pruned };
}

/**
 * Split history into "older" (to be summarised) and "recent" (kept verbatim),
 * counting backward from the end by token budget.
 */
export function planCompaction(
  messages: readonly Message[],
  opts: { keepTokens?: number; reason?: 'threshold' | 'forced' } & CompactionSettings = {},
): CompactionPlan {
  const s = resolveSettings(opts);
  const keepTokens = opts.keepTokens ?? s.keepTokens;

  const systemMessages = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const tokensBefore = estimateTokens(messages);

  // Walk backwards accumulating until the budget is spent.
  let kept = 0;
  let split = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimateMessageTokens(rest[i]);
    if (kept + t > keepTokens && split !== rest.length) break;
    kept += t;
    split = i;
    if (kept >= keepTokens) break;
  }

  let older = rest.slice(0, split);
  let recent = rest.slice(split);

  let pruned = 0;
  if (s.prune) {
    // Prune inside the region being summarised only — recent output is still live.
    const result = pruneStaleToolOutput(older, older.length, s.toolOutputMaxChars);
    older = result.messages;
    pruned = result.pruned;
  }

  // Never split an assistant tool-call away from its result: if `recent` starts
  // with an orphaned tool result the provider rejects the payload outright.
  while (recent.length && recent[0].role === 'tool') {
    older = [...older, recent[0]];
    recent = recent.slice(1);
  }

  void systemMessages;

  return {
    older,
    recent,
    tokensBefore,
    tokensKept: estimateTokens(recent),
    pruned,
    reason: older.length < 2 ? 'no-op' : (opts.reason ?? 'threshold'),
  };
}

export const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`;

export const ROLL_FORWARD_INSTRUCTIONS = `The <prior-summary> summarises everything that happened before the <conversation>. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the <conversation> does not mention them. Drop only what is finished and no longer needed.
- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.`;

export const COMPACTION_SYSTEM_PROMPT =
  'You compress agent conversation history. You must follow the requested template exactly. ' +
  'Be dense and factual. Never invent work that did not happen.';

/** Serialise messages into a compact transcript for the summariser. */
export function serializeForSummary(messages: readonly Message[], perMessageChars = 2_000): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') {
        return `[tool:${m.name ?? 'unknown'}] ${m.content.slice(0, 600)}`;
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const names = m.tool_calls.map((t) => t.function.name).join(', ');
        return `[assistant -> ${names}] ${m.content.slice(0, perMessageChars)}`;
      }
      return `[${m.role}] ${m.content.slice(0, perMessageChars)}`;
    })
    .join('\n');
}

export function buildSummaryPrompt(input: {
  transcript: string;
  previousSummary?: string;
  focus?: string;
  todos?: readonly Todo[];
  totalChars?: number;
}): string {
  const { transcript, previousSummary, focus, todos, totalChars = 200_000 } = input;

  const parts: string[] = [];

  if (previousSummary && previousSummary.trim()) {
    parts.push(`<prior-summary>\n${previousSummary.trim()}\n</prior-summary>`);
    parts.push(ROLL_FORWARD_INSTRUCTIONS);
  } else {
    parts.push(SUMMARY_TEMPLATE);
    parts.push('Summarise the conversation so work can continue seamlessly.');
  }

  // The todo list is durable state. Carrying it through compaction explicitly is
  // cheaper and more reliable than hoping the summariser mentions the plan.
  if (todos && todos.length) {
    const rendered = normalizeTodos(todos)
      .map((t) => `- [${t.status}] ${t.content}`)
      .join('\n');
    parts.push(
      `<active-todo-list>\n${rendered}\n</active-todo-list>\n` +
        'Preserve every unfinished todo item verbatim in the "Next Move" or "Active" sections.',
    );
  }

  if (focus) parts.push(`Pay particular attention to: ${focus}.`);

  parts.push(`<conversation>\n${transcript.slice(0, totalChars)}\n</conversation>`);

  return parts.join('\n\n');
}

/** Prefix for the synthetic message that replaces summarised history. */
export const SUMMARY_MARKER = '[Conversation summary — earlier context was compacted]';

export function applySummary(
  messages: readonly Message[],
  summary: string,
  recent: readonly Message[],
  summaryMarker: string = SUMMARY_MARKER,
): Message[] {
  const system = messages.filter((m) => m.role === 'system');
  const synthetic: Message[] = [
    { role: 'user', content: `${summaryMarker}\n${summary}` },
    {
      role: 'assistant',
      content:
        'Understood. I have the summary of our earlier work and will continue from the current state.',
    },
  ];
  return [...system, ...synthetic, ...recent];
}

/** Extract a previous summary from history so it can be rolled forward. */
export function findPreviousSummary(
  messages: readonly Message[],
  marker: string = SUMMARY_MARKER,
): string | undefined {
  for (const m of messages) {
    if (m.role === 'user' && m.content.startsWith(marker)) {
      return m.content.slice(marker.length).trim();
    }
  }
  return undefined;
}
