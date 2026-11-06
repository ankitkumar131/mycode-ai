import { describe, it, expect } from 'vitest';
import { renderTodoPanel } from '../todo-view.js';
import type { Todo } from '@mycode/core';

const todo = (content: string, status: Todo['status'], priority?: Todo['priority']): Todo => ({
  content,
  status,
  ...(priority ? { priority } : {}),
});

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderTodoPanel', () => {
  it('renders nothing for an empty list', () => {
    expect(renderTodoPanel([])).toBe('');
  });

  it('hides itself when all work is finished', () => {
    // A stale "plan" panel after the task completes is noise.
    const done = [todo('a', 'completed'), todo('b', 'cancelled')];
    expect(renderTodoPanel(done)).toBe('');
  });

  it('can be forced to show a finished list', () => {
    const done = [todo('a', 'completed')];
    expect(renderTodoPanel(done, { showWhenDone: true })).toContain('a');
  });

  it('shows a progress bar and counts', () => {
    const out = strip(
      renderTodoPanel([todo('one', 'completed'), todo('two', 'in_progress'), todo('three', 'pending')])
    );
    expect(out).toContain('Plan');
    expect(out).toContain('1/3');
    expect(out).toContain('1 active');
  });

  it('uses distinct glyphs per status', () => {
    const out = strip(
      renderTodoPanel([
        todo('done', 'completed'),
        todo('doing', 'in_progress'),
        todo('todo', 'pending'),
        todo('nope', 'cancelled'),
      ])
    );
    expect(out).toContain('✔');
    expect(out).toContain('•');
    expect(out).toContain('○');
    expect(out).toContain('✖');
  });

  it('marks high and low priority items', () => {
    const out = strip(
      renderTodoPanel([
        todo('urgent', 'in_progress', 'high'),
        todo('later', 'pending', 'low'),
        todo('normal', 'pending', 'medium'),
      ])
    );
    expect(out).toContain('!urgent');
    expect(out).toContain('·later');
    expect(out).toContain('normal');
  });

  it('collapses long lists, showing active work and the next few', () => {
    const many = [
      todo('done 1', 'completed'),
      todo('done 2', 'completed'),
      todo('active', 'in_progress'),
      ...Array.from({ length: 8 }, (_, i) => todo(`pending ${i}`, 'pending')),
    ];
    const out = strip(renderTodoPanel(many));
    expect(out).toContain('active');
    expect(out).toContain('pending 0');
    expect(out).toContain('more');
    // The completed backlog is not what the user needs to see mid-task.
    expect(out).not.toContain('done 1');
  });

  it('expands fully on request', () => {
    const many = Array.from({ length: 12 }, (_, i) => todo(`item ${i}`, 'pending'));
    const out = strip(renderTodoPanel(many, { expand: true }));
    expect(out).toContain('item 0');
    expect(out).toContain('item 11');
    expect(out).not.toContain('more');
  });

  it('truncates a very long task line rather than wrapping the panel', () => {
    const out = strip(renderTodoPanel([todo('x'.repeat(500), 'pending')]));
    expect(out).toContain('…');
    expect(Math.max(...out.split('\n').map((l) => l.length))).toBeLessThan(200);
  });

  it('always terminates with a newline-free block (caller adds spacing)', () => {
    const out = renderTodoPanel([todo('a', 'pending')]);
    expect(out.endsWith('\n')).toBe(false);
  });
});
