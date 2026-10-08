/**
 * Todo panel renderer.
 *
 * The agent already maintains a plan; before this it was written to a variable
 * nobody read, so the model's planning work was invisible and cost tokens for
 * nothing. This renders it.
 */

import chalk from 'chalk';
import { theme, getWidth } from './themes/theme.js';
import { countTodos, hasOpenWork, todoStore, type Todo } from '@mycode/core';

export interface TodoViewOptions {
  /** Collapse the list when it has more than this many items (default 8). */
  collapseAfter?: number;
  /** Force expansion regardless of length. */
  expand?: boolean;
  /** Show the section even when nothing is open. */
  showWhenDone?: boolean;
}

const GLYPH = {
  completed: '✔',
  in_progress: '•',
  pending: '○',
  cancelled: '✖',
} as const;

function colourFor(status: Todo['status'], text: string): string {
  switch (status) {
    case 'completed':
      return chalk.hex(theme.success)(text);
    case 'in_progress':
      return chalk.hex(theme.warning).bold(text);
    case 'cancelled':
      return chalk.hex(theme.textDim).strikethrough(text);
    default:
      return chalk.hex(theme.textSecondary)(text);
  }
}

function priorityMark(t: Todo): string {
  if (t.priority === 'high') return chalk.hex(theme.error)('!');
  if (t.priority === 'low') return chalk.hex(theme.textDim)('·');
  return ' ';
}

/** Render the panel. Returns an empty string when there is nothing to show. */
export function renderTodoPanel(todos: readonly Todo[], opts: TodoViewOptions = {}): string {
  if (!todos.length) return '';
  if (!opts.showWhenDone && !hasOpenWork(todos)) return '';

  const counts = countTodos(todos);
  const collapseAfter = opts.collapseAfter ?? 8;
  const collapsed = !opts.expand && todos.length > collapseAfter;

  const width = Math.max(40, getWidth() - 4);
  const lines: string[] = [];

  const done = counts.completed + counts.cancelled;
  const progress = counts.total > 0 ? Math.round((done / counts.total) * 100) : 0;
  const barWidth = 12;
  const filled = Math.round((progress / 100) * barWidth);
  const bar =
    chalk.hex(theme.success)('█'.repeat(filled)) +
    chalk.hex(theme.border)('░'.repeat(barWidth - filled));

  lines.push(
    `  ${chalk.hex(theme.brand)('◆')} ${chalk.hex(theme.brand).bold('Plan')}  ` +
      `${bar} ${chalk.hex(theme.textMuted)(`${done}/${counts.total}`)}` +
      (counts.inProgress ? chalk.hex(theme.warning)(`  ${counts.inProgress} active`) : ''),
  );

  if (collapsed) {
    // Collapsed: show the live task and the next few, not the whole backlog.
    const active = todos.filter((t) => t.status === 'in_progress').slice(0, 2);
    const upcoming = todos.filter((t) => t.status === 'pending').slice(0, 3);
    const shown = [...active, ...upcoming];
    for (const t of shown) lines.push(renderRow(t, width));
    const hidden = todos.length - shown.length;
    if (hidden > 0)
      lines.push(chalk.hex(theme.textDim)(`    … ${hidden} more ( /todo to expand )`));
  } else {
    for (const t of todos) lines.push(renderRow(t, width));
  }

  return lines.join('\n');
}

function renderRow(t: Todo, width: number): string {
  const glyph = GLYPH[t.status] ?? '○';
  const indentSpaces = '    ';
  const available = width - indentSpaces.length - 6;
  const text = t.content.length > available ? `${t.content.slice(0, available - 1)}…` : t.content;
  const marked = `${priorityMark(t)}${text}`;
  return `${indentSpaces}${colourFor(t.status, glyph)} ${colourFor(t.status, marked)}`;
}

/** Print the panel to stdout. */
export function printTodoPanel(todos: readonly Todo[], opts: TodoViewOptions = {}): void {
  const rendered = renderTodoPanel(todos, opts);
  if (!rendered) return;
  console.log();
  console.log(rendered);
  console.log();
}

/**
 * Subscribe a session's todos to the terminal, re-rendering on change.
 * Returns an unsubscribe function.
 */
export function bindTodoPanel(sessionId: string, opts: TodoViewOptions = {}): () => void {
  let lastRendered = '';
  return todoStore.subscribe(sessionId, (todos) => {
    const rendered = renderTodoPanel(todos, opts);
    if (rendered === lastRendered) return;
    lastRendered = rendered;
    if (rendered) {
      console.log();
      console.log(rendered);
    }
  });
}
