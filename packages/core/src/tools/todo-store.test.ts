import { describe, it, expect, beforeEach } from 'vitest';
import { todoStore, normalizeTodos, countTodos, hasOpenWork, type Todo } from './todo-store.js';

const todo = (
  content: string,
  status: Todo['status'] = 'pending',
  priority?: Todo['priority'],
): Todo => ({
  content,
  status,
  ...(priority ? { priority } : {}),
});

describe('normalizeTodos', () => {
  it('accepts the canonical shape', () => {
    const out = normalizeTodos([{ content: 'a', status: 'in_progress', priority: 'high' }]);
    expect(out).toEqual([{ content: 'a', status: 'in_progress', priority: 'high' }]);
  });

  it('accepts the legacy {text, done} shape', () => {
    const out = normalizeTodos([
      { text: 'first', done: true },
      { text: 'second', done: false },
    ]);
    expect(out[0]).toMatchObject({ content: 'first', status: 'completed' });
    expect(out[1]).toMatchObject({ content: 'second', status: 'pending' });
  });

  it('coerces unknown statuses to pending rather than dropping the item', () => {
    const out = normalizeTodos([{ content: 'x', status: 'wobbly' }]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('pending');
  });

  it('drops entries with no content', () => {
    expect(normalizeTodos([{ content: '' }, { text: '  ' }, { content: 'keep' }])).toHaveLength(1);
  });

  it('returns an empty array for non-arrays', () => {
    expect(normalizeTodos(null)).toEqual([]);
    expect(normalizeTodos('nope')).toEqual([]);
    expect(normalizeTodos(undefined)).toEqual([]);
  });

  it('trims whitespace and caps absurdly long items', () => {
    const out = normalizeTodos([{ content: '  padded  ' }]);
    expect(out[0].content).toBe('padded');
    const long = normalizeTodos([{ content: 'x'.repeat(5_000) }]);
    expect(long[0].content.length).toBeLessThanOrEqual(500);
  });
});

describe('countTodos / hasOpenWork', () => {
  const list = [
    todo('a', 'completed'),
    todo('b', 'in_progress'),
    todo('c'),
    todo('d', 'cancelled'),
  ];

  it('counts by status', () => {
    expect(countTodos(list)).toEqual({
      total: 4,
      completed: 1,
      inProgress: 1,
      pending: 1,
      cancelled: 1,
    });
  });

  it('reports open work only for pending or in-progress', () => {
    expect(hasOpenWork(list)).toBe(true);
    expect(hasOpenWork([todo('a', 'completed'), todo('b', 'cancelled')])).toBe(false);
    expect(hasOpenWork([])).toBe(false);
  });
});

describe('todoStore', () => {
  beforeEach(() => todoStore.reset());

  it('keeps sessions isolated', () => {
    todoStore.set('s1', [todo('one')]);
    todoStore.set('s2', [todo('two')]);
    expect(todoStore.get('s1')[0].content).toBe('one');
    expect(todoStore.get('s2')[0].content).toBe('two');
  });

  it('returns an empty list for an unknown session', () => {
    expect(todoStore.get('missing')).toEqual([]);
  });

  it('notifies subscribers with the normalized list', () => {
    const seen: string[][] = [];
    todoStore.subscribe('s1', (todos) => seen.push(todos.map((t) => t.content)));
    todoStore.set('s1', [{ text: 'legacy', done: false } as unknown as Todo]);
    expect(seen).toEqual([['legacy']]);
  });

  it('unsubscribe stops delivery', () => {
    let calls = 0;
    const off = todoStore.subscribe('s1', () => calls++);
    todoStore.set('s1', [todo('a')]);
    off();
    todoStore.set('s1', [todo('b')]);
    expect(calls).toBe(1);
  });

  it('a throwing listener does not break the agent loop', () => {
    todoStore.subscribe('s1', () => {
      throw new Error('renderer exploded');
    });
    expect(() => todoStore.set('s1', [todo('a')])).not.toThrow();
    expect(todoStore.get('s1')).toHaveLength(1);
  });

  it('merge updates by content and appends new items', () => {
    todoStore.set('s1', [todo('first'), todo('second', 'in_progress')]);
    const merged = todoStore.merge('s1', [todo('second', 'completed'), todo('third')]);
    expect(merged.map((t) => `${t.content}:${t.status}`)).toEqual([
      'first:pending',
      'second:completed',
      'third:pending',
    ]);
  });

  it('snapshot is a copy, not a live reference', () => {
    todoStore.set('s1', [todo('a')]);
    const snap = todoStore.snapshot('s1');
    snap.push(todo('injected'));
    expect(todoStore.get('s1')).toHaveLength(1);
  });

  it('restore rehydrates a persisted list', () => {
    todoStore.set('s1', [todo('a')]);
    const snap = todoStore.snapshot('s1');
    todoStore.clear('s1');
    expect(todoStore.get('s1')).toEqual([]);
    todoStore.restore('s1', snap);
    expect(todoStore.get('s1')[0].content).toBe('a');
  });

  it('clear removes both state and listeners', () => {
    let calls = 0;
    todoStore.subscribe('s1', () => calls++);
    todoStore.set('s1', [todo('a')]);
    todoStore.clear('s1');
    todoStore.set('s1', [todo('b')]);
    expect(calls).toBe(1);
    expect(todoStore.get('s1')).toHaveLength(1);
  });

  it('tracks which sessions have state', () => {
    todoStore.set('a', [todo('x')]);
    todoStore.set('b', [todo('y')]);
    expect(todoStore.sessionIds().sort()).toEqual(['a', 'b']);
  });
});
