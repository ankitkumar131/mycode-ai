/**
 * Ponytail — lazy senior dev mode.
 *
 * Vendored from https://github.com/DietrichGebert/ponytail (v4.10.0),
 * MIT License, Copyright (c) 2026 DietrichGebert. See NOTICE.md for the full
 * licence text. The rules below are reproduced and lightly adapted for MyCode's
 * tooling; the ladder, the intensity levels and the resolution order are
 * upstream's, deliberately unchanged so the behaviour matches what users of
 * ponytail already expect.
 *
 * Enabled by default and included in the system prompt for every query, so the
 * first thing the agent does is climb the ladder. Resolution order matches
 * upstream: PONYTAIL_DEFAULT_MODE, then the ponytail config file, then `full`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type PonytailMode = 'off' | 'lite' | 'full' | 'ultra';

export const PONYTAIL_MODES: readonly PonytailMode[] = ['off', 'lite', 'full', 'ultra'] as const;
export const DEFAULT_PONYTAIL_MODE: PonytailMode = 'full';

/** Where this was vendored from, for `mycode doctor` and the help command. */
export const PONYTAIL_SOURCE = 'https://github.com/DietrichGebert/ponytail';
export const PONYTAIL_VERSION = '4.10.0';
export const PONYTAIL_LICENSE = 'MIT';

export function isPonytailMode(value: string): value is PonytailMode {
  return (PONYTAIL_MODES as readonly string[]).includes(value);
}

/** Parse user input for a mode. Accepts a bare word or a `/ponytail <mode>` line. */
export function parsePonytailMode(input: string): PonytailMode | null {
  const word = input
    .trim()
    .toLowerCase()
    .replace(/^\/ponytail\s*/, '')
    .trim();
  if (!word) return null;
  // Common synonyms people actually type.
  if (word === 'stop' || word === 'none' || word === 'disable' || word === 'disabled') return 'off';
  if (word === 'on' || word === 'enable' || word === 'enabled' || word === 'default') return 'full';
  if (word === 'max' || word === 'maxim' || word === 'extreme') return 'ultra';
  if (word === 'min' || word === 'light') return 'lite';
  return isPonytailMode(word) ? word : null;
}

/**
 * The ponytail config file locations, in the order upstream checks them.
 * XDG_CONFIG_HOME is honoured before the default ~/.config location.
 */
export function ponytailConfigPaths(env: NodeJS.ProcessEnv = process.env, home?: string): string[] {
  const paths: string[] = [];
  // The home from the supplied environment wins over the ambient one, so a
  // caller passing an env gets the paths that environment actually implies.
  const resolvedHome = home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  if (process.platform === 'win32') {
    const appData = env.APPDATA;
    if (appData) paths.push(join(appData, 'ponytail', 'config.json'));
  } else {
    const xdg = env.XDG_CONFIG_HOME;
    if (xdg) paths.push(join(xdg, 'ponytail', 'config.json'));
    paths.push(join(resolvedHome, '.config', 'ponytail', 'config.json'));
  }
  return paths;
}

/** Read `defaultMode` from the first ponytail config file that exists. */
export function readPonytailConfig(env: NodeJS.ProcessEnv = process.env): PonytailMode | null {
  for (const path of ponytailConfigPaths(env)) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as { defaultMode?: unknown };
      if (typeof raw.defaultMode === 'string' && isPonytailMode(raw.defaultMode.toLowerCase())) {
        return raw.defaultMode.toLowerCase() as PonytailMode;
      }
    } catch {
      /* a malformed config must not stop the agent from running */
    }
  }
  return null;
}

/**
 * Resolve the mode to use: env → config file → default.
 *
 * Upstream's documented order. Invalid values are ignored rather than
 * propagated, so a typo in an env var cannot silently disable the behaviour.
 */
export function resolvePonytailMode(env: NodeJS.ProcessEnv = process.env): PonytailMode {
  const fromEnv = env.PONYTAIL_DEFAULT_MODE?.trim().toLowerCase();
  if (fromEnv && isPonytailMode(fromEnv)) return fromEnv;
  return readPonytailConfig(env) ?? DEFAULT_PONYTAIL_MODE;
}

// ─── Session override ────────────────────────────────────────────────────────
//
// `/ponytail lite` (or "stop ponytail") changes the mode for this process only,
// matching upstream's "runtime mode is process-local". Nothing is written.

let sessionOverride: PonytailMode | null = null;

export function setPonytailMode(mode: PonytailMode | null): void {
  sessionOverride = mode;
}

/** The mode actually in force right now. */
export function getPonytailMode(env: NodeJS.ProcessEnv = process.env): PonytailMode {
  return sessionOverride ?? resolvePonytailMode(env);
}

/** True when the mode came from `/ponytail` rather than config. */
export function isPonytailOverridden(): boolean {
  return sessionOverride !== null;
}

/** Test seam. */
export function resetPonytailMode(): void {
  sessionOverride = null;
}

// ─── The section injected into the system prompt ─────────────────────────────

const LADDER = `Before writing any code, stop at the first rung that holds:
1. Does this need to exist at all? A speculative need is not a need — skip it and say so in one line. (YAGNI)
2. Does it already exist in this codebase? A helper, util, type or pattern that already lives here — reuse it. Re-implementing what is a few files away is the most common slop.
3. Does the standard library do it? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it — never add a new one for what a few lines can do.
6. Can it be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder is a reflex, not a research project — but it runs AFTER you understand the problem, not instead of it. Read the task and the code it touches first, trace the real flow end to end, then climb. Two rungs work → take the higher one and move on.`;

const RULES = `Rules:
- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later" — later can scaffold for itself.
- Deletion over addition. Boring over clever; clever is what someone decodes at 3am.
- Fewest files possible. The shortest working diff wins, but only once you understand the problem — the smallest change in the wrong place is not lazy, it is a second bug.
- Complex request? Build the lazy version and question it in the same response ("Did X; Y covers it. Need full X? Say so."). Never stall on an answer you can default.
- Two approaches the same size? Take the one that is correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.
- Bug fix = root cause, not symptom. A report names a symptom: grep every caller of the function you are about to touch and fix the shared function once — one guard there is a smaller diff than one in every caller, and patching only the path the ticket names leaves the sibling callers broken.
- Mark deliberate simplifications that cut a real corner with a known ceiling (a global lock, an O(n²) scan, a naive heuristic) with a \`ponytail:\` comment naming the ceiling and the upgrade path.`;

const NOT_LAZY = `Never simplify away: input validation at trust boundaries, error handling that prevents data loss, security, accessibility basics, the calibration real hardware needs, or anything explicitly requested. If the user insists on the full version, build it — no re-arguing.

Never lazy about understanding. The ladder shortens the solution, never the reading. Comprehension skipped to ship a small diff is the dangerous kind: it dresses up as efficiency and ships a confident wrong fix.

Lazy code without its check is unfinished. Non-trivial logic (a branch, a loop, a parser, a money or security path) leaves ONE runnable check behind — the smallest thing that fails if the logic breaks. Trivial one-liners need no test; YAGNI applies to tests too.`;

const OUTPUT = `Output: code first, then at most three short lines — what you skipped and when to add it. Pattern: \`[code] → skipped: [X], add when [Y].\` No essays, no feature tours, no design notes. If the explanation is longer than the code, delete the explanation. Prose the user explicitly asked for (a report, a walkthrough) is not debt — give it in full; the rule is only against unrequested prose.`;

const LEVELS: Record<Exclude<PonytailMode, 'off'>, string> = {
  lite: `Intensity: lite. Build what was asked, but name the lazier alternative in one line and let the user pick. Do not silently substitute a smaller solution.`,
  full: `Intensity: full (default). Enforce the ladder: standard library and native features first, shortest working diff, shortest explanation.`,
  ultra: `Intensity: ultra. YAGNI extremist. Deletion before addition. Build the one-liner and challenge the rest of the requirement in the same breath.`,
};

const PREAMBLE = `You are a lazy senior developer. Lazy means efficient, not careless. You have seen every over-engineered codebase and been paged at 3am for one. The best code is the code never written.

This is active on every response. Do not drift back to over-building; stay on it when unsure. It governs what you build, not how you talk.`;

/**
 * The system-prompt section for a mode, or null when ponytail is off.
 *
 * Kept as one function so the off switch is a single check rather than a
 * condition spread across the prompt builder.
 */
export function ponytailSection(mode: Exclude<PonytailMode, 'off'>): string {
  return `${PREAMBLE}\n\n${LADDER}\n\n${RULES}\n\n${NOT_LAZY}\n\n${LEVELS[mode]}\n\n${OUTPUT}`;
}

/**
 * The section to inject, or null when ponytail is disabled.
 * Reads the live mode, so a `/ponytail` switch takes effect on the next query.
 */
export function currentPonytailSection(env: NodeJS.ProcessEnv = process.env): string | null {
  const mode = getPonytailMode(env);
  if (mode === 'off') return null;
  return `Ponytail — lazy senior dev mode (${PONYTAIL_SOURCE}, ${PONYTAIL_LICENSE}):\n\n${ponytailSection(mode)}`;
}

/** One-line status for `/ponytail` and the banner. */
export function describePonytailMode(env: NodeJS.ProcessEnv = process.env): string {
  const mode = getPonytailMode(env);
  if (mode === 'off') return 'ponytail: off';

  let source: string;
  if (isPonytailOverridden()) {
    source = 'set this session';
  } else {
    const fromEnv = env.PONYTAIL_DEFAULT_MODE?.trim().toLowerCase();
    if (fromEnv && isPonytailMode(fromEnv)) source = 'from PONYTAIL_DEFAULT_MODE';
    else if (readPonytailConfig(env)) source = 'from config';
    else source = 'default';
  }
  return `ponytail: ${mode} (${source})`;
}
