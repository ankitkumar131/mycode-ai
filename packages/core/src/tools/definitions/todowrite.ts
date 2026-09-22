/**
 * todo_write — Claude Code-powerful persistent planning
 * 
 * Enhancements:
 * - Persistent storage (survives restarts)
 * - Dependencies between todos
 * - Verification steps
 * - Priority levels
 * - Time tracking
 * - Auto-suggest next todo
 * - Memory integration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolModule } from '../types.js';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  priority?: 'high' | 'medium' | 'low';
  dependsOn?: string[];
  verification?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedMinutes?: number;
}

interface TodoStore {
  todos: TodoItem[];
  sessionId: string;
  cwd: string;
  updatedAt: string;
}

let activeTodos: TodoItem[] = [];
const STORE_DIR = join(homedir(), '.mycode', 'todos');

function ensureDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function getStorePath(cwd: string): string {
  const safePath = cwd.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);
  return join(STORE_DIR, `${safePath}.json`);
}

function loadTodos(cwd: string): TodoItem[] {
  ensureDir();
  const path = getStorePath(cwd);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as TodoStore;
      // Only load if recent (24h)
      if (Date.now() - new Date(data.updatedAt).getTime() < 24 * 60 * 60 * 1000) {
        return data.todos;
      }
    } catch {}
  }
  return activeTodos;
}

function saveTodos(cwd: string, todos: TodoItem[]) {
  ensureDir();
  const path = getStorePath(cwd);
  const store: TodoStore = {
    todos,
    sessionId: `sess_${Date.now()}`,
    cwd,
    updatedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
  } catch {}
}

function validateDependencies(todos: TodoItem[]): string | null {
  const ids = new Set(todos.map(t => t.id));
  for (const todo of todos) {
    if (todo.dependsOn) {
      for (const dep of todo.dependsOn) {
        if (!ids.has(dep)) {
          return `Todo ${todo.id} depends on unknown ${dep}`;
        }
      }
    }
  }
  // Check cycles
  const visited = new Set<string>();
  const recStack = new Set<string>();
  
  function hasCycle(id: string): boolean {
    if (!visited.has(id)) {
      visited.add(id);
      recStack.add(id);
      const todo = todos.find(t => t.id === id);
      if (todo?.dependsOn) {
        for (const dep of todo.dependsOn) {
          if (!visited.has(dep) && hasCycle(dep)) return true;
          if (recStack.has(dep)) return true;
        }
      }
    }
    recStack.delete(id);
    return false;
  }
  
  for (const todo of todos) {
    if (hasCycle(todo.id)) return `Circular dependency involving ${todo.id}`;
  }
  
  return null;
}

export const todoWriteTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Persistent task planning — tracks multi-step work with priorities, dependencies, verification. Survives restarts. Use at start of complex tasks, update as you go, verify at end. Claude Code style: plan → execute → verify.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique id, e.g. \"1\", \"research\", \"implement-api\"' },
                text: { type: 'string', description: 'Task description' },
                done: { type: 'boolean', description: 'Completed?' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids of todos this depends on' },
                verification: { type: 'string', description: 'How to verify completion (e.g. \"run npm test\")' },
              },
              required: ['id', 'text', 'done'],
            },
            description: 'Updated todo list',
          },
        },
        required: ['items'],
      },
    },
  },
  execute: (async (args: Record<string, unknown>, cwd: string) => {
    const items = Array.isArray(args.items) ? (args.items as TodoItem[]) : [];
    
    // Validation
    if (items.length > 50) throw new Error('Too many todos (max 50), break into smaller chunks');
    
    const depError = validateDependencies(items);
    if (depError) throw new Error(depError);

    // Track timing
    const now = new Date().toISOString();
    for (const item of items) {
      const existing = activeTodos.find(t => t.id === item.id);
      if (!existing && !item.done) {
        item.startedAt = now;
      }
      if (item.done && existing && !existing.done) {
        item.completedAt = now;
      }
    }

    activeTodos = items;
    saveTodos(cwd, items);

    // Calculate stats
    const total = items.length;
    const done = items.filter(t => t.done).length;
    const pending = total - done;
    const highPriority = items.filter(t => !t.done && t.priority === 'high').length;
    
    // Find next actionable todo (no pending dependencies)
    const doneIds = new Set(items.filter(t => t.done).map(t => t.id));
    const nextTodo = items.find(t => !t.done && (!t.dependsOn || t.dependsOn.every(d => doneIds.has(d))));

    // Memory capture for high priority todos
    try {
      const { memoryManager } = await import('../../memory/memory-manager.js');
      if (items.length > 0) {
        memoryManager.captureObservation({
          sessionId: `sess_${Date.now()}`,
          cwd,
          tool: 'todo_write',
          input: { total, done, pending },
          output: `Todos: ${done}/${total} done, ${pending} pending, ${highPriority} high priority`,
          success: true,
          durationMs: 0,
          tags: ['planning', `${done}/${total}`],
        });
      }
    } catch {}

    const lines: string[] = [];
    lines.push(`Todos — ${done}/${total} done, ${pending} pending${highPriority ? `, ${highPriority} high priority` : ''}`);
    lines.push('');
    
    for (const todo of items) {
      const icon = todo.done ? '✓' : todo.priority === 'high' ? '🔴' : todo.priority === 'medium' ? '🟡' : '⚪';
      const depInfo = todo.dependsOn?.length ? ` [depends: ${todo.dependsOn.join(', ')}]` : '';
      const verifyInfo = todo.verification ? ` (verify: ${todo.verification})` : '';
      lines.push(`${icon} ${todo.id}: ${todo.text}${depInfo}${verifyInfo}${todo.done ? ' ✓' : ''}`);
    }

    if (nextTodo) {
      lines.push('');
      lines.push(`Next: ${nextTodo.id} — ${nextTodo.text}${nextTodo.verification ? ` → verify with: ${nextTodo.verification}` : ''}`);
    } else if (pending === 0 && total > 0) {
      lines.push('');
      lines.push('All todos complete! Verify all changes and summarize.');
    }

    if (pending > 0) {
      const blocked = items.filter(t => !t.done && t.dependsOn?.some(d => !doneIds.has(d)));
      if (blocked.length > 0) {
        lines.push('');
        lines.push(`Blocked: ${blocked.map(t => t.id).join(', ')} (waiting for dependencies)`);
      }
    }

    return lines.join('\n');
  }) as unknown as ToolModule['execute'],
};

// Export for programmatic use
export function getActiveTodos(cwd?: string): TodoItem[] {
  if (cwd) {
    return loadTodos(cwd);
  }
  return activeTodos;
}

export function isTodoComplete(id: string): boolean {
  return activeTodos.find(t => t.id === id)?.done ?? false;
}
