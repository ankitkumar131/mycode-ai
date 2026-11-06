/**
 * TodoStore — per-session, observable task list.
 *
 * Replaces the previous module-global `activeTodos` variable in the todo_write
 * tool, which had two problems: (1) todos were shared across concurrent
 * sessions, and (2) nothing ever rendered them, so the model's planning work
 * was invisible to the user.
 *
 * The shape matches what agentic models are actually trained to emit:
 *   { content, status: pending|in_progress|completed|cancelled, priority }
 *
 * A four-state status (rather than a `done` boolean) is what lets the UI show
 * *which* step is live, and lets the model express "I am working on this now"
 * separately from "this is finished".
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface Todo {
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
}

export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export type TodoListener = (todos: readonly Todo[], sessionId: string) => void;

const VALID_STATUS: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const VALID_PRIORITY: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

/**
 * A todo item is a line, not an essay. The whole list is re-sent to the model on
 * every turn, so one runaway entry would tax every subsequent request.
 */
const MAX_TODO_LENGTH = 500;

/** Coerce arbitrary model output into well-formed todos. Never throws. */
export function normalizeTodos(input: unknown): Todo[] {
  if (!Array.isArray(input)) return [];
  const out: Todo[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    // Accept `content`/`text` and `status`/`done` so older prompts still work.
    const content =
      typeof item.content === 'string' ? item.content
      : typeof item.text === 'string' ? item.text
      : '';
    if (!content.trim()) continue;

    let status: TodoStatus;
    if (typeof item.status === 'string' && VALID_STATUS.has(item.status)) {
      status = item.status as TodoStatus;
    } else if (typeof item.done === 'boolean') {
      status = item.done ? 'completed' : 'pending';
    } else {
      status = 'pending';
    }

    const priority =
      typeof item.priority === 'string' && VALID_PRIORITY.has(item.priority)
        ? (item.priority as TodoPriority)
        : undefined;

    const trimmed = content.trim();
    const text = trimmed.length > MAX_TODO_LENGTH ? `${trimmed.slice(0, MAX_TODO_LENGTH - 1)}…` : trimmed;
    out.push(priority ? { content: text, status, priority } : { content: text, status });
  }
  return out;
}

export function countTodos(todos: readonly Todo[]): TodoCounts {
  const c: TodoCounts = { total: todos.length, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
  for (const t of todos) {
    if (t.status === 'pending') c.pending++;
    else if (t.status === 'in_progress') c.inProgress++;
    else if (t.status === 'completed') c.completed++;
    else c.cancelled++;
  }
  return c;
}

/** True when there is still work outstanding (used to auto-hide the panel). */
export function hasOpenWork(todos: readonly Todo[]): boolean {
  return todos.some((t) => t.status === 'pending' || t.status === 'in_progress');
}

class TodoStore {
  private bySession = new Map<string, Todo[]>();
  private listeners = new Map<string, Set<TodoListener>>();

  get(sessionId: string): readonly Todo[] {
    return this.bySession.get(sessionId) ?? [];
  }

  set(sessionId: string, todos: readonly Todo[]): void {
    const normalized = normalizeTodos(todos);
    this.bySession.set(sessionId, normalized);
    for (const fn of this.listeners.get(sessionId) ?? []) {
      try {
        fn(normalized, sessionId);
      } catch {
        // A broken listener must never break the agent loop.
      }
    }
  }

  /** Merge updates by content, preserving order. Used by the merge mode. */
  merge(sessionId: string, todos: readonly Todo[]): Todo[] {
    const existing = this.bySession.get(sessionId) ?? [];
    const merged = [...existing];
    for (const next of normalizeTodos(todos)) {
      const i = merged.findIndex((t) => t.content === next.content);
      if (i === -1) merged.push(next);
      else merged[i] = next;
    }
    this.set(sessionId, merged);
    return merged;
  }

  subscribe(sessionId: string, fn: TodoListener): () => void {
    if (!this.listeners.has(sessionId)) this.listeners.set(sessionId, new Set());
    this.listeners.get(sessionId)!.add(fn);
    return () => {
      this.listeners.get(sessionId)?.delete(fn);
    };
  }

  /** Serialisable snapshot, for session persistence. */
  snapshot(sessionId: string): Todo[] {
    return [...this.get(sessionId)];
  }

  restore(sessionId: string, todos: unknown): void {
    this.set(sessionId, normalizeTodos(todos));
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
    this.listeners.delete(sessionId);
  }

  /** Test helper. */
  reset(): void {
    this.bySession.clear();
    this.listeners.clear();
  }

  sessionIds(): string[] {
    return [...this.bySession.keys()];
  }
}

export const todoStore = new TodoStore();
