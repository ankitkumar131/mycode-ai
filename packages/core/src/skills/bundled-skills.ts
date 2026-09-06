/**
 * Bundled skills — seeded into ~/.mycode/skills on first run (like Hermes
 * copies its bundled catalog into ~/.hermes/skills). Users can edit or delete
 * them freely; `mycode skills reset <name>` restores the original.
 */

export interface BundledSkill {
  name: string;
  files: Record<string, string>; // relative path -> content (always includes SKILL.md)
}

const skill = (name: string, skillMd: string, extra: Record<string, string> = {}): BundledSkill => ({
  name,
  files: { 'SKILL.md': skillMd.trim() + '\n', ...extra },
});

import { GRAPHIFY_SKILL_FILES } from './bundled/graphify.js';

/** graphify — upstream skill bundled verbatim (Apache-2.0), plus a MyCode preamble. */
const graphifySkill: BundledSkill = {
  name: 'graphify',
  files: {
    ...GRAPHIFY_SKILL_FILES,
    'SKILL.md': GRAPHIFY_SKILL_FILES['SKILL.md'].replace(
      /\n# \/graphify\n/,
      `\n# /graphify\n\n> **MyCode notes:** run every shell snippet below with the \`terminal\` tool (bash on Linux/macOS, cmd/PowerShell on Windows). Read \`references/*.md\` with \`skill_view(name="graphify", path="references/<file>")\`. Requires Python 3.10+; if \`graphify\` is missing the skill installs the PyPI package \`graphifyy\` via uv or pipx — tell the user before doing so.\n`
    ),
  },
};

export const BUNDLED_SKILLS: BundledSkill[] = [
  graphifySkill,
  skill(
    'plan',
    `---
name: plan
description: Write a markdown implementation plan instead of executing the task
version: 1.0.0
category: workflow
tags: [planning, architecture]
argument-hint: "[task]"
---

# Plan Mode

## When to Use
The user wants a plan first — no code changes. Triggered via \`/plan [task]\`.

## Procedure
1. Inspect the relevant parts of the codebase with read-only tools
   (read_file, search_files, glob_search, list_dir, git_status).
2. Do NOT write, edit, or execute anything that mutates the workspace.
3. Produce a plan with these sections:
   - **Goal** — one paragraph restating the task
   - **Context** — files/modules involved, current behaviour
   - **Steps** — numbered, each with the files to touch and what changes
   - **Risks / Open questions**
   - **Verification** — how to test the result
4. Save the plan to \`.mycode/plans/<yyyy-mm-dd>-<slug>.md\` using write_file
   (this is the only write allowed), then print the plan.

## Pitfalls
- Don't start implementing "just a little". Plan only.
- Keep steps small enough to be individually verifiable.
`
  ),

  skill(
    'code-review',
    `---
name: code-review
description: Review a diff, PR, or set of files for bugs, security, and style issues
version: 1.0.0
category: engineering
tags: [review, quality]
argument-hint: "[path|diff|PR]"
---

# Code Review

## When to Use
User asks to review code, a PR, or the current git diff.

## Procedure
1. Determine scope: if no argument, run \`git diff\` (and \`git diff --staged\`) via the terminal tool.
2. Read every changed file fully — do not review from the diff alone when context matters.
3. Check, in order: correctness → security → error handling → performance → readability → tests.
4. Report findings grouped by severity (🔴 must fix, 🟡 should fix, 🟢 nit),
   each with file:line, why it matters, and a concrete fix.
5. End with a short verdict: approve / approve with nits / request changes.

## Pitfalls
- Don't nitpick formatting if a formatter is configured.
- Flag missing tests for new behaviour.
`
  ),

  skill(
    'test-driven-development',
    `---
name: test-driven-development
description: Implement changes test-first — red, green, refactor
version: 1.0.0
category: engineering
tags: [testing, tdd]
---

# Test-Driven Development

## Procedure
1. Locate the project's test runner (package.json scripts, pytest, go test, cargo test…).
2. Write a failing test that captures the requested behaviour. Run it — confirm it fails (red).
3. Implement the minimal change to make the test pass. Run it (green).
4. Refactor with tests still green. Run the full relevant test file/suite at the end.
5. Summarise: tests added, files changed, commands run.

## Pitfalls
- Never mark a task done without actually running the tests.
- If the runner isn't installed, say so and show the install command instead of guessing.
`
  ),

  skill(
    'debug',
    `---
name: debug
description: Systematically diagnose and fix a bug or failing command
version: 1.0.0
category: engineering
tags: [debugging]
argument-hint: "<error or description>"
---

# Debugging

## Procedure
1. Reproduce: run the failing command/test and capture the exact error.
2. Localise: read the stack trace top-down, open each referenced file at the referenced line.
3. Hypothesise one root cause; verify it by reading code or adding a targeted log/assert.
4. Fix the root cause (not the symptom). Keep the change minimal.
5. Re-run the original reproduction to confirm the fix; run neighbouring tests.
6. Remove temporary debugging code.

## Pitfalls
- Don't shotgun multiple changes at once.
- If you can't reproduce, say so and ask for more detail.
`
  ),

  skill(
    'commit',
    `---
name: commit
description: Stage and commit the current changes with a well-formed message
version: 1.0.0
category: git
tags: [git]
argument-hint: "[message hint]"
---

# Git Commit

## Procedure
1. Run \`git status --short\` and \`git diff --stat\` to see what changed.
2. Group logically related changes; if there are unrelated changes, propose separate commits.
3. Write a conventional-commit message: \`type(scope): summary\` (≤72 chars) + optional body
   explaining *why*. Types: feat, fix, refactor, docs, test, chore, perf.
4. Stage the intended files explicitly (\`git add <paths>\`), never \`git add -A\` blindly
   when the tree contains secrets, build artifacts, or unrelated work.
5. Commit and show \`git log -1 --stat\`.

## Pitfalls
- Never commit .env files or credentials.
- Never amend or force-push unless the user explicitly asks.
`
  ),

  skill(
    'document-analysis',
    `---
name: document-analysis
description: Read and summarise PDF, Word, Excel, PowerPoint or other office documents
version: 1.0.0
category: documents
tags: [pdf, docx, xlsx, pptx]
argument-hint: "<file> [question]"
---

# Document Analysis

## When to Use
The user points at a .pdf, .docx, .xlsx, .pptx, .odt, .rtf, .csv, .epub or .html file.

## Procedure
1. Use the built-in \`read_document\` tool — NEVER write a script to parse the document.
2. For long documents, read in pages/chunks (\`page\`, \`maxChars\`, \`offset\` args) and keep notes.
3. Answer the user's question with citations (page/slide/sheet numbers).
4. If asked to summarise, give: purpose, key points (bulleted), numbers/dates, action items.

## Pitfalls
- Scanned PDFs may have no text layer — say so instead of hallucinating.
- Spreadsheets: mention sheet names and header rows.
`
  ),

  skill(
    'skill-creator',
    `---
name: skill-creator
description: Author a new reusable SKILL.md following the house standard
version: 1.0.0
category: meta
tags: [skills]
argument-hint: "<what the skill should teach>"
---

# Skill Creator

## Procedure
1. Ask (or infer) the trigger: when should the agent load this skill?
2. Draft SKILL.md with frontmatter: name (kebab-case), description (≤60 chars), version,
   category, tags, optional argument-hint.
3. Body sections in this order: **When to Use**, **Procedure** (numbered), **Pitfalls**,
   **Verification**. Reference tools by their real names (read_file, terminal, …).
4. Large sources go in \`references/<topic>.md\`, linked from SKILL.md — keep SKILL.md lean.
5. Save with the \`skill_manage\` tool (action=create). Confirm the path.

## Pitfalls
- No invented commands. Every command must exist on the user's system or be installable.
- Do not paste large source passages — distil.
`
  ),
];
