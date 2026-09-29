/**
 * Native Ponytail policy.
 *
 * Ponytail is intentionally implemented as a MyCode policy rather than as a
 * host-specific hook/plugin. That makes the rule active for every provider,
 * the first turn, and delegated work without requiring an external MCP client.
 */

export const PONYTAIL_MOTTO = 'The best code is the code never written.';

export const PONYTAIL_MODES = ['lite', 'full', 'ultra', 'off'] as const;
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export const DEFAULT_PONYTAIL_MODE: PonytailMode = 'full';

export interface PonytailSettings {
  /** The policy intensity used for every new request. */
  mode: PonytailMode;
  /** Keep the policy active for questions, research, and other non-coding tasks. */
  applyToAllTasks: boolean;
}

export const DEFAULT_PONYTAIL_SETTINGS: PonytailSettings = {
  mode: DEFAULT_PONYTAIL_MODE,
  applyToAllTasks: true,
};

/** Convert old, invalid, or missing settings to a safe supported mode. */
export function normalizePonytailMode(value: unknown): PonytailMode {
  if (typeof value !== 'string') return DEFAULT_PONYTAIL_MODE;
  const mode = value.trim().toLowerCase();
  return (PONYTAIL_MODES as readonly string[]).includes(mode) ? (mode as PonytailMode) : DEFAULT_PONYTAIL_MODE;
}

/**
 * The policy is deliberately explicit about what minimalism does not mean.
 * It must constrain unnecessary work, not validation, security, accessibility,
 * error handling, tests, or an explicit user requirement.
 */
export function getPonytailPolicy(mode: PonytailMode = DEFAULT_PONYTAIL_MODE, applyToAllTasks = true): string {
  if (mode === 'off') return '';

  const intensity =
    mode === 'lite'
      ? 'Use the principle as a light bias: prefer the smallest sensible answer or change and avoid needless additions.'
      : mode === 'ultra'
        ? 'Use the principle rigorously: justify every new file, dependency, abstraction, and persistent process before introducing it. Remove unnecessary work when safe.'
        : 'Use the complete minimal-solution ladder and leave a concise verification step for non-trivial work.';

  const scope = applyToAllTasks
    ? 'This policy is active from the first turn for every user request, including questions, research, documentation, configuration, and coding. For a simple question, do not invent code; answer directly.'
    : 'This policy is active by default for coding and implementation work. Do not force code into a simple question or non-coding answer.';

  return `[Native Ponytail policy — ${mode} mode]
Motto: ${PONYTAIL_MOTTO}
${scope}
${intensity}

Before acting, ask whether the requested work is necessary and what the smallest correct result is. Prefer this ladder, in order:
1. Do not add anything if the existing behavior already solves the request.
2. Reuse existing project code, configuration, utilities, or platform behavior.
3. Prefer the language standard library.
4. Prefer a native platform feature.
5. Reuse an already-installed dependency.
6. Prefer a simple, local, one-line or small change.
7. Only then write the minimum new implementation that is correct and maintainable.

Minimal-solution rules:
- Trace the root cause instead of adding a workaround around a symptom.
- Do not add speculative abstractions, wrappers, configuration, dependencies, files, or features.
- Keep changes local and compatible with the repository's existing style.
- Preserve explicit user requirements even when they are larger than the default minimal solution.
- Preserve security, validation, error handling, accessibility, data integrity, and required behavior. Minimal does not mean careless.
- For non-trivial logic, leave or run a small runnable verification. Do not claim success without checking it.
- When several solutions are correct, explain the trade-off briefly and choose the least code that remains robust.

Delegated work must follow the same motto and ladder. A delegated agent may not expand scope, add a dependency, or skip verification merely because the task was delegated.

Ponytail is a policy overlay, not permission to ignore MyCode safety rules, command approvals, project instructions, or the user's direct request.`;
}

export type PonytailReviewKind = 'review' | 'audit' | 'debt' | 'gain';

/** Build the prompt used by the native /ponytail-* shortcuts. */
export function buildPonytailCommandPrompt(kind: PonytailReviewKind, request = ''): string {
  const subject = request.trim() || 'the current repository and uncommitted changes';
  const lead = {
    review: 'Review',
    audit: 'Audit',
    debt: 'Identify removable complexity and technical debt in',
    gain: 'Identify small, high-value improvements for',
  }[kind];

  const details = {
    review:
      'Find correctness, security, reliability, maintainability, and unnecessary-complexity issues. Do not modify files unless the user explicitly asks for fixes.',
    audit:
      'Inspect the relevant implementation and its tests. Look for duplicated logic, needless dependencies, dead code, missing validation, weak error handling, and risky complexity. Preserve required behavior.',
    debt:
      'Look specifically for code, configuration, dependencies, abstractions, files, and processes that can be removed safely. Separate safe removals from items that are required for correctness or security.',
    gain:
      'Suggest only improvements with a clear benefit and a minimal implementation. Prefer reuse and removal over adding new machinery. Do not implement speculative features.',
  }[kind];

  return `${getPonytailPolicy('full', true)}

Native Ponytail ${kind} command:
${lead} ${subject}.
${details}
Report findings in priority order with file paths and concrete, minimal next steps. If there is nothing worthwhile to change, say so plainly.`;
}

export function ponytailModeDescription(mode: PonytailMode): string {
  switch (mode) {
    case 'lite':
      return 'minimal changes with a light Ponytail bias';
    case 'full':
      return 'full minimal-solution ladder (default)';
    case 'ultra':
      return 'strict justification before adding code or dependencies';
    case 'off':
      return 'disabled for this session/configuration';
  }
}
