#!/usr/bin/env node
/**
 * Refresh the bundled partner skills from upstream.
 *
 *   ponytail          DietrichGebert/ponytail            (MIT)
 *   humanizer         blader/humanizer                   (MIT)
 *   strategic-compact affaan-m/ECC                       (MIT)
 *
 * Usage: node scripts/sync-partner-skills.mjs
 * Writes packages/core/src/skills/bundled/partner-skills.ts
 *
 * Why this exists rather than vendoring the files by hand:
 *
 *  1. Frontmatter normalisation. MyCode's parseFrontmatter is a small
 *     hand-rolled parser (packages/core/src/skills/skill-loader.ts) that does
 *     not implement YAML block scalars. ponytail ships `description: >` and
 *     humanizer ships `description: |`; parsed verbatim those yield the
 *     literal strings ">" and "|", which is what the model would see in the
 *     skill index. So we re-emit frontmatter with single-line descriptions and
 *     keep the upstream body intact.
 *
 *  2. Harness adaptation. ECC's strategic-compact documents a Claude Code
 *     PreToolUse hook (`suggest-compact.js`) and Claude-specific env vars.
 *     MyCode has no equivalent hook wiring, but it does have /compress
 *     (alias /compact) backed by AgentSession.compress({ keepLast, focus }).
 *     Those sections are swapped for the MyCode equivalent; the reasoning
 *     sections are kept verbatim.
 *
 * The unmodified upstream file is always kept as UPSTREAM-SKILL.md, and every
 * skill carries a NOTICE with source, commit SHA and licence.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'core',
  'src',
  'skills',
  'bundled',
  'partner-skills.ts',
);
const SYNCED = new Date().toISOString().slice(0, 10);

const headers = { 'User-Agent': 'mycode-cli', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function fetchFile(repo, path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${repo}/${path}`);
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf-8');
}

async function headSha(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${repo} commits`);
  return (await r.json()).sha;
}

// ── Offline cache ──────────────────────────────────────────────────────────
//
// Set MYCODE_SKILL_CACHE=<dir> to build from pre-downloaded upstream files
// instead of hitting the network. Expects <dir>/<name>.md (the upstream
// SKILL.md) and <dir>/<name>.sha (the commit SHA it came from). Useful in CI
// and on networks where api.github.com is not reachable from node.

import { existsSync, readFileSync } from 'fs';

const CACHE = process.env.MYCODE_SKILL_CACHE;

function cachedFile(name) {
  const p = join(CACHE, `${name}.md`);
  if (!existsSync(p)) throw new Error(`cache miss: ${p}`);
  return readFileSync(p, 'utf-8');
}

function cachedSha(name) {
  const p = join(CACHE, `${name}.sha`);
  if (!existsSync(p)) throw new Error(`cache miss: ${p}`);
  return readFileSync(p, 'utf-8').trim();
}

/** Strip the YAML frontmatter block, returning the markdown body only. */
function body(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length).trimStart() : content.trimStart();
}

/** Build a MyCode SKILL.md: our normalised frontmatter + the given body. */
function skillMd(meta, mdBody) {
  const tags = `[${meta.tags.join(', ')}]`;
  return [
    '---',
    `name: ${meta.name}`,
    `description: "${meta.description.replace(/"/g, "'")}"`,
    `version: ${meta.version}`,
    `category: ${meta.category}`,
    `tags: ${tags}`,
    'license: MIT',
    `source: ${meta.url}`,
    '---',
    '',
    mdBody.trimEnd(),
    '',
  ].join('\n');
}

function notice(meta, sha) {
  return [
    `The "${meta.name}" skill is derived from ${meta.url}`,
    `(commit ${sha.slice(0, 12)}), licensed under the MIT License.`,
    '',
    'UPSTREAM-SKILL.md in this directory is the unmodified upstream file.',
    "SKILL.md is MyCode's adapted version: the YAML frontmatter is re-emitted",
    "with a single-line description because MyCode's frontmatter parser does",
    'not implement YAML block scalars ("description: >" / "description: |").',
    ...(meta.extraNotice ? ['', ...meta.extraNotice] : []),
    '',
    `Synced by scripts/sync-partner-skills.mjs on ${SYNCED}.`,
  ].join('\n');
}

// ── ECC strategic-compact: replace the Claude-harness sections ─────────────

const MYCODE_COMPACT_SECTION = `## How It Works In MyCode

MyCode has no compaction-suggestion hook. Compaction is yours to trigger, and
two mechanisms already exist:

1. **Manual** — \`/compress\` (alias \`/compact\`) summarises older context now.
   - \`/compress\` keeps the last 2 exchanges.
   - \`/compress here N\` keeps the last N exchanges.
   - \`/compress <focus>\` compresses and steers the summary toward a topic:
     \`/compact Focus on implementing auth middleware next\`
2. **Automatic** — \`AgentSession\` compresses on its own once estimated tokens
   pass \`compressThreshold\` of the context window (default **0.8**). That is
   the "arbitrary point" this skill exists to get ahead of.

The status line under the composer shows live context usage as
\`<tokens>/<window>\` plus a percentage bar. Watch it. When you are near the
amber band and sitting on a phase boundary, compact deliberately instead of
waiting for the 80% auto-compress to fire mid-task.

Unlike the upstream Claude Code integration, there is no tool-call-count
signal here — context percentage is the only trigger you get, so check it at
phase boundaries rather than expecting to be told.
`;

/**
 * Swap ECC's Claude-specific sections for the MyCode equivalent, and drop the
 * two Best Practices / Related items that assume hooks or ECC-only skills.
 */
function adaptCompact(upstreamBody) {
  let out = upstreamBody;

  // Cut everything from "## How It Works" up to "## Compaction Decision Guide".
  const start = out.indexOf('## How It Works');
  const end = out.indexOf('## Compaction Decision Guide');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'strategic-compact: expected section markers not found; upstream layout changed',
    );
  }
  out = out.slice(0, start) + MYCODE_COMPACT_SECTION + '\n' + out.slice(end);

  // "Read the suggestion — The hook tells you when" assumes a hook we don't have.
  out = out.replace(
    /4\. \*\*Read the suggestion\*\*[^\n]*\n/,
    '4. **Watch the status line** — MyCode will not prompt you; the context bar under the composer is the signal\n',
  );

  // Related section points at ECC-only assets.
  const rel = out.indexOf('## Related');
  if (rel !== -1) {
    out =
      out.slice(0, rel) +
      `## Related

- \`memory\` tool — persist durable facts (preferences, project conventions, machine quirks) that must survive compaction.
- \`todo_write\` tool — the task list is a convenience, not a durable record; write plans to a file.
`;
  }
  return out;
}

// ── Partner definitions ────────────────────────────────────────────────────

const PARTNERS = [
  {
    name: 'ponytail',
    repo: 'DietrichGebert/ponytail',
    path: 'skills/ponytail/SKILL.md',
    version: '1.0.0',
    category: 'workflow',
    tags: ['minimalism', 'yagni', 'refactoring', 'code-review', 'dependencies'],
    description:
      'Force the smallest solution that actually works. Use on any coding task — writing, refactoring, fixing, reviewing, or choosing a dependency — and whenever the user says "ponytail", "be lazy", "simplest solution", "minimal", "yagni", "do less", "shortest path", or complains about over-engineering, bloat, boilerplate, or unnecessary dependencies. Not for non-coding requests.',
    adapt: (b) => b,
  },
  {
    name: 'humanizer',
    repo: 'blader/humanizer',
    path: 'SKILL.md',
    version: '3.0.0',
    category: 'writing',
    tags: ['prose', 'editing', 'documentation', 'writing'],
    description:
      'Rewrite AI-sounding prose so it reads like the writer, without changing the meaning. Use when editing or reviewing prose for AI tells: not-X-but-Y contrasts, one-line closers, staged openers, forced triads, overused dashes, inflated claims, sales language, stock AI words, bold labels, or filler. Applies to docs, READMEs, emails and copy — not to code.',
    adapt: (b) => b,
  },
  {
    name: 'strategic-compact',
    repo: 'affaan-m/ECC',
    path: '.agents/skills/strategic-compact/SKILL.md',
    version: '1.0.0',
    category: 'context-management',
    tags: ['context', 'compaction', 'token-efficiency', 'long-sessions'],
    description:
      'Suggest compacting context at logical task-phase boundaries instead of letting auto-compaction fire mid-task. Use in long sessions approaching the context limit, when a phase boundary — planning done, debugging resolved, milestone complete — is a natural place to compact.',
    adapt: adaptCompact,
    extraNotice: [
      "SKILL.md additionally replaces upstream's Claude Code PreToolUse hook",
      '(suggest-compact.js) and its Claude-specific environment variables with the',
      'MyCode equivalent: /compress (alias /compact) and the compressThreshold',
      'auto-compress in AgentSession. The upstream file is preserved unmodified as',
      'UPSTREAM-SKILL.md.',
    ],
  },
];

// ── Run ────────────────────────────────────────────────────────────────────

const result = {};
for (const p of PARTNERS) {
  const url = `https://github.com/${p.repo}`;
  const sha = CACHE ? cachedSha(p.name) : await headSha(p.repo);
  const upstream = CACHE ? cachedFile(p.name) : await fetchFile(p.repo, p.path);
  const meta = { ...p, url };
  result[p.name] = {
    'SKILL.md': skillMd(meta, p.adapt(body(upstream))),
    'UPSTREAM-SKILL.md': upstream,
    NOTICE: notice(meta, sha),
  };
  console.log(
    `  ✓ ${p.name.padEnd(18)} ${p.repo} @ ${sha.slice(0, 12)}  (upstream ${upstream.length} B)${CACHE ? '  [cache]' : ''}`,
  );
}

const banner = `/* AUTO-GENERATED by scripts/sync-partner-skills.mjs — do not edit by hand.
 *
 * Bundled partner skills, each MIT-licensed and attributed in its NOTICE file:
 *   ponytail           https://github.com/DietrichGebert/ponytail
 *   humanizer          https://github.com/blader/humanizer
 *   strategic-compact  https://github.com/affaan-m/ECC
 *
 * Synced: ${SYNCED}
 */
`;

const ts =
  banner +
  `export const PARTNER_SKILL_FILES: Record<string, Record<string, string>> = ${JSON.stringify(result, null, 2)};\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ts, 'utf-8');
console.log(`\nWrote ${OUT} (${ts.length} bytes, ${Object.keys(result).length} skills)`);
