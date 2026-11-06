/**
 * Plan files — `.mycode/plans/<date>-<slug>.md`.
 *
 * `/plan` used to make the *model* save this with `write_file`. That is exactly
 * the tool plan mode exists to remove: opencode's plan agent allows `edit` only
 * under its plans directory and denies everything else, and MyCode has no path
 * policy to express that. So the host writes the file instead — one write, in
 * code, to a directory the user chose by invoking `/plan`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `.mycode/plans/2026-10-08-fix-the-login-redirect.md` */
export function planFilePath(cwd: string, task: string, now: Date = new Date()): string {
  return join(cwd, '.mycode', 'plans', `${now.toISOString().slice(0, 10)}-${slug(task)}.md`);
}

/** Filesystem-safe, human-readable, never empty, never a path traversal. */
export function slug(task: string, maxWords = 6): string {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && w !== '.' && w !== '..')
    .slice(0, maxWords);
  return (words.join('-') || 'plan').slice(0, 60);
}

/** Writes the plan and returns the path relative to `cwd`, for the notice. */
export function savePlan(cwd: string, task: string, body: string, now: Date = new Date()): string {
  const file = planFilePath(cwd, task, now);
  mkdirSync(join(cwd, '.mycode', 'plans'), { recursive: true });
  writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`, 'utf-8');
  return relative(cwd, file);
}
