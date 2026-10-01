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

/**
 * graphify — knowledge-graph skill. The reference docs are bundled verbatim from
 * Graphify-Labs/graphify (Apache-2.0); SKILL.md is MyCode's own headless procedure
 * that drives the `graphify` CLI in a handful of commands instead of the 30-step
 * Claude-Code subagent workflow upstream ships.
 */
const GRAPHIFY_SKILL_MD = `---
name: graphify
description: Build and query a knowledge graph of the codebase (graphify). Use for architecture questions, "what calls X", "how does Y connect to Z".
version: 2.0.0
category: code-intelligence
tags: [knowledge-graph, architecture, codebase, query]
argument-hint: "[path|url] | query \\"question\\" | path A B | explain X | --update"
default-args: "."
source: https://github.com/Graphify-Labs/graphify
license: Apache-2.0
---

# /graphify

Turns a folder (code, docs, PDFs) into a queryable knowledge graph: \`graphify-out/graph.html\` (interactive),
\`graphify-out/GRAPH_REPORT.md\` (highlights) and \`graphify-out/graph.json\` (the graph). Code is parsed locally
with tree-sitter — no API key, nothing leaves the machine.

## Rules (read first)
- **Do not ask questions. Do not explain the skill. Act.** No arguments means "build the graph for \`.\`".
- Use the \`terminal\` tool. **Use as few commands as possible** — the whole build is TWO commands.
- Never paste Python into \`python -c\`; the \`graphify\` CLI already does everything.
- Never write into \`graphify-out/\` yourself and never fake outputs (no placeholder index.html).
- graphify needs no API key. If docs/PDFs exist they are skipped gracefully without one — that is fine.

## Procedure

### A. Decide the mode from the request
| Request looks like | Mode |
|---|---|
| empty, \`.\`, a path, or a GitHub URL | **build** |
| \`--update\` | **update** |
| \`query "..."\`, or a natural-language question and \`graphify-out/graph.json\` exists | **query** |
| \`path "A" "B"\` | **path** |
| \`explain "X"\` | **explain** |

### B. Ensure graphify is installed (one command)
\`\`\`bash
command -v graphify >/dev/null 2>&1 && graphify --version || { command -v uv >/dev/null 2>&1 && uv tool install -q graphifyy || pipx install graphifyy || python3 -m pip install --user -q graphifyy; } && graphify --version
\`\`\`
If that fails, tell the user: \`pipx install graphifyy\` (or \`uv tool install graphifyy\`) needs Python 3.10+, then stop.
(Windows: \`where graphify\`; install with \`pipx install graphifyy\`.)

### C. Run the mode (one command each)
- **build** (run from the project root so outputs land in \`./graphify-out\`):
  1. \`graphify extract <path> --code-only\` → writes graph.json (nodes/edges/communities are printed)
  2. \`graphify cluster-only .\` → writes GRAPH_REPORT.md and graph.html (it prints "no LLM backend configured; keeping Community N placeholders" — that is expected and fine)
  For a GitHub URL: \`git clone --depth 1 <url> /tmp/graphify-src\` first, then use that path in step 1.
  Only drop \`--code-only\` if the user explicitly wants docs/PDFs included AND \`GEMINI_API_KEY\`/\`GOOGLE_API_KEY\` or \`OPENAI_API_KEY\` is set (add \`--backend openai\`).
  Add \`--mode deep\` to step 1 only if the user asked for deep/thorough.
- **update**: \`graphify update <path or .>\`
- **query**: \`graphify query "<question>"\` (add \`--budget 1500\` for short answers)
- **path**: \`graphify path "A" "B"\`
- **explain**: \`graphify explain "X"\`

query/path/explain read \`./graphify-out/graph.json\`; if it doesn't exist, do a **build** first (no need to ask). Do not loop on errors — report them.

### D. Report (build/update only)
Run \`head -60 graphify-out/GRAPH_REPORT.md\` and give the user:
- node/edge/community counts from the extract output,
- the god nodes / key concepts section of the report,
- the three output paths and \`xdg-open graphify-out/graph.html\` (macOS: \`open\`, Windows: \`start\`).
For query/path/explain: return the command output, lightly formatted, and answer the question from it.

## After the graph exists
For any later question about this codebase, prefer \`graphify query\` / \`path\` / \`explain\` over grepping files.
Rebuild incrementally after code changes with \`graphify update .\`.

## References (load with skill_view name="graphify" path="references/<file>")
- query.md — query/path/explain flags and output format
- update.md — incremental updates and hooks
- exports.md — --svg, --graphml, --neo4j, --obsidian, --wiki
- github-and-merge.md — multi-repo / monorepo merges
- add-watch.md, hooks.md, transcribe.md, extraction-spec.md
`;

const graphifySkill: BundledSkill = {
  name: 'graphify',
  files: {
    ...Object.fromEntries(Object.entries(GRAPHIFY_SKILL_FILES).filter(([k]) => k !== 'SKILL.md')),
    'SKILL.md': GRAPHIFY_SKILL_MD.trimStart(),
    'UPSTREAM-SKILL.md': GRAPHIFY_SKILL_FILES['SKILL.md'],
  },
};

const NEXTJS_SAAS_SKILL = skill(
  'nextjs-saas',
  `---
name: nextjs-saas
description: Build polished Next.js SaaS products with accessible motion and typed APIs
version: 1.0.0
category: frontend
tags: [nextjs, react, frontend, saas, reactbits, motion, accessibility, api]
argument-hint: "[product brief]"
---

# Next.js SaaS Product

## When to Use
Use for a new Next.js App Router SaaS product, especially when the request includes a marketing site, dashboard, typed backend routes, polished motion, or ReactBits-style components.

## Procedure
1. Create the requested application in the requested new folder. Do not modify unrelated source trees.
2. Inspect current ReactBits, Motion, smooth-scroll, styling, database, and testing documentation before selecting packages. Never invent imports or package names.
3. Establish a small design system first: color tokens, typography, spacing, radii, shadows, focus styles, responsive breakpoints, and reduced-motion behavior.
4. Build shared accessible components before duplicating page markup. Prefer server components by default and isolate client components around interaction and animation.
5. Use Motion and smooth scrolling carefully. Animations must enhance hierarchy, remain performant, and respect prefers-reduced-motion.
6. Add typed Route Handlers or Server Actions with validation, explicit errors, loading states, and a local/mock data path that works without secrets.
7. Add tests for important UI behavior and API validation. Run lint, typecheck, tests, and a production build.
8. Start the app and verify the important routes in a browser. Record failures instead of hiding them.

## Pitfalls
- Do not copy a visually impressive component that breaks keyboard navigation, mobile layouts, or reduced-motion behavior.
- Do not use fake package names or silently replace a requested dependency with an unrelated one.
- Do not put secrets in source control or claim that a real provider was contacted when using mock data.
- Do not replace the existing application when the user requested a new folder.
`
);

const PONYTAIL_SKILLS: BundledSkill[] = [
  skill(
    'ponytail',
    `---
name: ponytail
description: Prefer the smallest correct solution and avoid unnecessary code
version: 1.0.0
category: engineering
tags: [minimalism, yagni, simplicity, ponytail]
argument-hint: "[request]"
---

# Ponytail Minimal-Code Policy

## Motto
The best code is the code never written.

## Procedure
1. Decide whether the requested work is necessary.
2. Reuse existing project code and behavior before adding anything.
3. Prefer the standard library, native platform features, and installed dependencies in that order.
4. Choose the smallest local change that remains correct and maintainable.
5. Trace root causes instead of wrapping symptoms with abstractions.
6. Verify non-trivial behavior with a runnable check.

## Safety Boundaries
Minimal does not mean careless. Keep explicit requirements, security, validation, error handling, accessibility, data integrity, and required tests. Never bypass MyCode approvals or project instructions.

## Verification
Report what was deliberately not added as well as what changed when that explains the minimal solution.
`
  ),
  skill(
    'ponytail-review',
    `---
name: ponytail-review
description: Review changes for correctness and unnecessary complexity
version: 1.0.0
category: engineering
tags: [review, minimalism, ponytail]
argument-hint: "[scope]"
---

# Ponytail Review

Review the requested scope without changing files unless explicitly asked. Check correctness, security, error handling, tests, duplication, unnecessary abstractions, dependencies, and files. Report findings by priority with file paths and the smallest safe fix. If no change is justified, say so.
`
  ),
  skill(
    'ponytail-audit',
    `---
name: ponytail-audit
description: Audit a project for needless code and risky complexity
version: 1.0.0
category: engineering
tags: [audit, complexity, ponytail]
argument-hint: "[scope]"
---

# Ponytail Audit

Inspect the relevant implementation and tests. Identify duplicate code, dead code, speculative configuration, avoidable dependencies, missing validation, weak error handling, and complex workarounds. Preserve behavior that is required for safety, accessibility, or explicit user requirements. Separate evidence from guesses.
`
  ),
  skill(
    'ponytail-debt',
    `---
name: ponytail-debt
description: Find safe opportunities to remove code and dependencies
version: 1.0.0
category: engineering
tags: [debt, deletion, cleanup, ponytail]
argument-hint: "[scope]"
---

# Ponytail Debt

Find code, configuration, dependencies, abstractions, files, and processes that can be removed safely. Prefer deletion and reuse over replacement. For every candidate, state why it is safe, what behavior might change, and the smallest verification needed. Do not remove security or required validation.
`
  ),
  skill(
    'ponytail-gain',
    `---
name: ponytail-gain
description: Suggest small high-value improvements without scope creep
version: 1.0.0
category: engineering
tags: [improvement, simplicity, ponytail]
argument-hint: "[scope]"
---

# Ponytail Gain

Suggest only small improvements with a clear user or maintenance benefit. Prefer existing utilities, standard library features, native platform behavior, and removal of complexity. Do not propose speculative features or a new abstraction without evidence.
`
  ),
  skill(
    'ponytail-help',
    `---
name: ponytail-help
description: Explain the native Ponytail minimal-code policy and boundaries
version: 1.0.0
category: engineering
tags: [help, policy, ponytail]
---

# Ponytail Help

Explain the motto "The best code is the code never written", the minimal-solution ladder, the lite/full/ultra/off modes, and the boundary that minimalism never overrides security, validation, error handling, accessibility, tests, project instructions, approvals, or explicit user requirements.
`
  ),
];

export const BUNDLED_SKILLS: BundledSkill[] = [
  graphifySkill,
  NEXTJS_SAAS_SKILL,
  ...PONYTAIL_SKILLS,
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
