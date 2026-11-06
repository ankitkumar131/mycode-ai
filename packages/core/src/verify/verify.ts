/**
 * Verification — closing the write → verify → fix loop.
 *
 * Without this, the loop is open: the agent writes code, and the *user* is the
 * first thing that notices it doesn't compile. Everything here exists so the
 * model sees its own mistakes on the very next turn, while the relevant file is
 * still in context.
 *
 * Two signals, deliberately cheap:
 *   - FORMATTER  — cosmetic churn never reaches the model's diff.
 *   - DIAGNOSTICS — type errors, unresolved imports and lint failures.
 *
 * Full LSP is the polished version of diagnostics; a typechecker subprocess
 * captures most of the value for a fraction of the complexity. We shell out,
 * filter to the touched files, and cap the output so one broken generated file
 * cannot eat the context window.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { extname, relative, isAbsolute } from 'path';

export interface VerifyResult {
  /** Diagnostics text, ready to append to a tool result. Empty when clean. */
  diagnostics: string;
  /** Formatter feedback, e.g. "formatted 2 files with prettier". */
  formatted: string;
  /** The command(s) actually run, for transparency. */
  ran: string[];
  /** True when a diagnostics run failed to execute (missing toolchain, etc.). */
  skipped: boolean;
}

const EMPTY: VerifyResult = { diagnostics: '', formatted: '', ran: [], skipped: true };

const MAX_DIAGNOSTIC_CHARS = 3_000;
const DEFAULT_TIMEOUT_MS = 60_000;

interface CommandSpec {
  /** Command + args. */
  cmd: string;
  args: string[];
}

/** Run a command, capturing output. Never rejects. */
function runCommand(
  spec: CommandSpec,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { code: number | null; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const child = spawn(spec.cmd, spec.args, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const cap = (s: string) => (s.length > 200_000 ? s.slice(0, 200_000) : s);
      child.stdout?.on('data', (d) => (stdout = cap(stdout + d.toString())));
      child.stderr?.on('data', (d) => (stderr = cap(stderr + d.toString())));
      child.on('error', () => done({ code: null, stdout: '', stderr: '' }));
      child.on('close', (code) => done({ code, stdout, stderr }));
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        done({ code: null, stdout, stderr: stderr + '\n[verification timed out]' });
      }, timeoutMs);
      timer.unref?.();
    } catch {
      done({ code: null, stdout: '', stderr: '' });
    }
  });
}

function which(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
        stdio: 'ignore',
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** True when the repo has the given package in its dependencies. */
export function hasDependency(cwd: string, pkg: string): boolean {
  try {
    const p = `${cwd}/package.json`;
    if (!existsSync(p)) return false;
    const json = JSON.parse(require('fs').readFileSync(p, 'utf-8')) as Record<
      string,
      Record<string, string>
    >;
    return Boolean(json.dependencies?.[pkg] || json.devDependencies?.[pkg]);
  } catch {
    return false;
  }
}

/** TypeScript: run the project's own tsc, filtered to the files we touched. */
async function typescriptDiagnostics(files: string[], cwd: string): Promise<VerifyResult | null> {
  const hasTsconfig = existsSync(`${cwd}/tsconfig.json`);
  if (!hasTsconfig) return null;

  const localTsc = `${cwd}/node_modules/.bin/tsc`;
  const cmd = existsSync(localTsc) ? localTsc : 'tsc';
  const spec: CommandSpec = { cmd, args: ['--noEmit', '--pretty', 'false'] };

  const res = await runCommand(spec, cwd);
  if (res.code === null && !res.stdout && !res.stderr) return null; // tsc unavailable

  const combined = `${res.stdout}\n${res.stderr}`;
  if (!combined.trim())
    return { diagnostics: '', formatted: '', ran: ['tsc --noEmit'], skipped: false };

  return {
    diagnostics: filterDiagnostics(combined, files),
    formatted: '',
    ran: ['tsc --noEmit'],
    skipped: false,
  };
}

/** Python: prefer basedpyright/pyright, then ruff. */
async function pythonDiagnostics(files: string[], cwd: string): Promise<VerifyResult | null> {
  for (const tool of ['pyright', 'basedpyright']) {
    if (await which(tool)) {
      const res = await runCommand({ cmd: tool, args: ['--outputjson', ...files] }, cwd);
      if (res.code === null) continue;
      const text = summarizePyright(res.stdout);
      return {
        diagnostics: text,
        formatted: '',
        ran: [`${tool} ${files.length} file(s)`],
        skipped: false,
      };
    }
  }
  if (await which('ruff')) {
    const res = await runCommand({ cmd: 'ruff', args: ['check', ...files] }, cwd);
    if (res.code === null) return null;
    return {
      diagnostics: cap(res.stdout || res.stderr, MAX_DIAGNOSTIC_CHARS),
      formatted: '',
      ran: ['ruff check'],
      skipped: false,
    };
  }
  return null;
}

/** Go: `go vet` + `go build` on the touched packages. */
async function goDiagnostics(files: string[], cwd: string): Promise<VerifyResult | null> {
  if (!(await which('go')) || !existsSync(`${cwd}/go.mod`)) return null;
  const dirs = [...new Set(files.map((f) => `./${dirOf(f)}`))];
  const res = await runCommand({ cmd: 'go', args: ['vet', ...dirs] }, cwd);
  if (res.code === null) return null;
  const out = `${res.stdout}${res.stderr}`.trim();
  if (!out) return { diagnostics: '', formatted: '', ran: ['go vet'], skipped: false };
  return {
    diagnostics: cap(out, MAX_DIAGNOSTIC_CHARS),
    formatted: '',
    ran: ['go vet'],
    skipped: false,
  };
}

/** Rust: `cargo check`. Whole-crate, so no file filtering. */
async function rustDiagnostics(cwd: string): Promise<VerifyResult | null> {
  if (!(await which('cargo')) || !existsSync(`${cwd}/Cargo.toml`)) return null;
  const res = await runCommand(
    { cmd: 'cargo', args: ['check', '--message-format', 'short'] },
    cwd,
    120_000,
  );
  if (res.code === null) return null;
  const out = `${res.stdout}${res.stderr}`.trim();
  if (!out) return { diagnostics: '', formatted: '', ran: ['cargo check'], skipped: false };
  return {
    diagnostics: cap(out, MAX_DIAGNOSTIC_CHARS),
    formatted: '',
    ran: ['cargo check'],
    skipped: false,
  };
}

/** Keep only lines mentioning our files; fall back to the head of the output. */
export function filterDiagnostics(raw: string, files: string[]): string {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (!files.length) return cap(raw, MAX_DIAGNOSTIC_CHARS);

  const base = files.map((f) => f.split(/[\\/]/).pop() ?? f).filter(Boolean);
  const relevant = lines.filter((l) => base.some((b) => l.includes(b)));
  const chosen = relevant.length ? relevant : lines;
  return cap(chosen.slice(0, 60).join('\n'), MAX_DIAGNOSTIC_CHARS);
}

function summarizePyright(json: string): string {
  try {
    const data = JSON.parse(json) as {
      generalDiagnostics?: Array<{
        file: string;
        severity: string;
        message: string;
        range?: { start?: { line: number } };
      }>;
    };
    const diags = data.generalDiagnostics ?? [];
    if (!diags.length) return '';
    return cap(
      diags
        .slice(0, 40)
        .map(
          (d) =>
            `${relative(process.cwd(), d.file)}:${(d.range?.start?.line ?? 0) + 1} ${d.severity}: ${d.message}`,
        )
        .join('\n'),
      MAX_DIAGNOSTIC_CHARS,
    );
  } catch {
    return cap(json, MAX_DIAGNOSTIC_CHARS);
  }
}

function dirOf(file: string): string {
  const i = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return i === -1 ? '.' : file.slice(0, i);
}

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n... [diagnostics truncated]` : s;
}

export function isVerifiable(file: string): boolean {
  return [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.rs',
  ].includes(extname(file).toLowerCase());
}

/**
 * Run the appropriate diagnostics for the touched files.
 * Returns an empty result rather than throwing when no toolchain is available.
 */
export async function runDiagnostics(files: string[], cwd: string): Promise<VerifyResult> {
  const targets = files.filter(isVerifiable);
  if (!targets.length) return { ...EMPTY };

  const abs = targets.map((f) => (isAbsolute(f) ? f : `${cwd}/${f}`));
  const exts = new Set(targets.map((f) => extname(f).toLowerCase()));

  try {
    if (
      [...exts].some((e) =>
        ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(e),
      )
    ) {
      const r = await typescriptDiagnostics(abs, cwd);
      if (r) return r;
    }
    if (exts.has('.py')) {
      const r = await pythonDiagnostics(abs, cwd);
      if (r) return r;
    }
    if (exts.has('.go')) {
      const r = await goDiagnostics(abs, cwd);
      if (r) return r;
    }
    if (exts.has('.rs')) {
      const r = await rustDiagnostics(cwd);
      if (r) return r;
    }
  } catch {
    /* verification must never break the loop */
  }
  return { ...EMPTY };
}

// ─── Formatter ───────────────────────────────────────────────────────────────

interface FormatterSpec {
  name: string;
  cmd: string;
  args: (files: string[]) => string[];
  exts: string[];
}

const FORMATTERS: FormatterSpec[] = [
  {
    name: 'prettier',
    cmd: 'prettier',
    args: (f) => ['--write', ...f],
    exts: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.json',
      '.css',
      '.scss',
      '.md',
      '.yaml',
      '.yml',
    ],
  },
  {
    name: 'biome',
    cmd: 'biome',
    args: (f) => ['format', '--write', ...f],
    exts: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  { name: 'black', cmd: 'black', args: (f) => ['-q', ...f], exts: ['.py'] },
  { name: 'ruff-format', cmd: 'ruff', args: (f) => ['format', ...f], exts: ['.py'] },
  { name: 'gofmt', cmd: 'gofmt', args: (f) => ['-w', ...f], exts: ['.go'] },
  { name: 'rustfmt', cmd: 'rustfmt', args: (f) => [...f], exts: ['.rs'] },
];

/** Prefer a locally installed formatter from node_modules/.bin. */
function resolveFormatter(fmt: FormatterSpec, cwd: string): CommandSpec | null {
  const local = `${cwd}/node_modules/.bin/${fmt.cmd}`;
  if (existsSync(local)) return { cmd: local, args: fmt.args([]) };
  return { cmd: fmt.cmd, args: fmt.args([]) };
}

/**
 * Format the touched files. Returns a short human-readable note, never throws.
 * Skips silently when no formatter is available or when formatting would take
 * too long.
 */
export async function runFormatter(files: string[], cwd: string): Promise<VerifyResult> {
  const targets = files.filter((f) => existsSync(f) && isVerifiable(f));
  if (!targets.length) return { ...EMPTY };

  for (const fmt of FORMATTERS) {
    const applicable = targets.filter((f) => fmt.exts.includes(extname(f).toLowerCase()));
    if (!applicable.length) continue;

    const spec = resolveFormatter(fmt, cwd);
    if (!spec) continue;
    if (!existsSync(spec.cmd) && !(await which(fmt.cmd))) continue;

    const res = await runCommand({ cmd: spec.cmd, args: fmt.args(applicable) }, cwd, 30_000);
    if (res.code === null) continue; // not runnable — try the next formatter
    return {
      diagnostics: '',
      formatted: `formatted ${applicable.length} file${applicable.length === 1 ? '' : 's'} with ${fmt.name}`,
      ran: [fmt.name],
      skipped: false,
    };
  }
  return { ...EMPTY };
}

/** Render both signals as a single block appended to a tool result. */
export function renderVerification(v: VerifyResult): string {
  const parts: string[] = [];
  if (v.formatted) parts.push(`[formatter] ${v.formatted}`);
  if (v.diagnostics.trim()) {
    parts.push(`[diagnostics — fix these before moving on]\n${v.diagnostics.trim()}`);
  }
  return parts.join('\n\n');
}
