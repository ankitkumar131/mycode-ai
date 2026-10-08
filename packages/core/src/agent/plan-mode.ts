/**
 * Plan mode — read-only by construction, not by request.
 *
 * `/plan` used to be a prompt: the model was *told* not to write, and every
 * write tool stayed in its list. That is a suggestion, not a guarantee — one
 * ignored instruction, or an armed `/allow-all`, and the "planning" turn edits
 * the repository.
 *
 * opencode solves this in the permission layer: its `plan` agent carries
 * `permission: { edit: { '*': 'deny' }, task: { general: 'deny' } }` and its
 * description is literally "Plan mode. Disallows all edit tools." MyCode has no
 * permission engine (that is a wider gap), but it does own the tool list each
 * request is built from, so plan mode removes the mutating tools there and
 * refuses them at execution as a second line of defence.
 *
 * `terminal` is deliberately *not* removed. opencode's plan agent keeps bash —
 * its README says plan "asks permission before running bash commands" — and
 * inspection (`git log`, `npm ls`, running the test suite) is most of what
 * planning needs. The CLI force-prompts for it instead; see `shouldPrompt()` in
 * `packages/cli/src/permissions/session-approvals.ts`.
 */

/**
 * Tools that change the workspace.
 *
 * `terminal` and `delegate` are excluded on purpose: the first is gated by an
 * ask, the second by the host (the CLI refuses `general` sub-agents in plan
 * mode, mirroring opencode's `task: { general: 'deny' }`).
 */
export const MUTATING_TOOLS: readonly string[] = [
  'write_file',
  'patch',
  'execute_code',
  'skill_manage',
];

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.includes(name);
}

/**
 * What a model sees if it calls a mutating tool anyway. It cannot — the tool is
 * absent from the request — but models call tools from habit or a stale
 * transcript, and "unknown tool" teaches nothing while this points at the way
 * forward.
 */
export function planModeRefusal(name: string): string {
  return (
    `Error: ${name} is unavailable in plan mode — this session is read-only. ` +
    'Keep planning with the tools you have (read_file, glob_search, search_files, ' +
    'git_status, terminal), present the plan, and the user switches to build mode ' +
    'to execute it.'
  );
}
