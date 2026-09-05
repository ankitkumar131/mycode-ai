/**
 * process — Manage background processes started by terminal(background=true).
 */

import type { ToolModule } from '../types.js';
import { processManager } from '../process-manager.js';

export const processTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'process',
      description:
        'Manage background processes: list them, read logs, wait for a log pattern (e.g. "listening on"), send stdin, or kill. Use after terminal(background=true).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'logs', 'poll', 'wait', 'write', 'kill', 'kill_all'], description: 'Operation' },
          id: { type: 'string', description: 'Process id (e.g. "p1") — required for logs/poll/wait/write/kill' },
          tail: { type: 'number', description: 'Number of trailing lines for logs (default 100)' },
          from_line: { type: 'number', description: 'Absolute line index to read from (use next_line from a previous poll)' },
          pattern: { type: 'string', description: 'Regex to wait for (wait action)' },
          timeout: { type: 'number', description: 'Max ms to wait (wait action, default 30000, max 180000)' },
          input: { type: 'string', description: 'Text to write to stdin (write action). Add "\\n" to submit a line.' },
        },
        required: ['action'],
      },
    },
  },

  async execute(args) {
    const action = String(args.action ?? '');
    const id = typeof args.id === 'string' ? args.id : '';

    const fmt = (p: ReturnType<typeof processManager.list>[number]) => {
      const dur = ((p.exitedAt ?? Date.now()) - p.startedAt) / 1000;
      return `${p.id}\tpid=${p.pid ?? '?'}\t${p.status}${p.exitCode !== null ? `(${p.exitCode})` : ''}\t${dur.toFixed(0)}s\t${p.command}${p.label ? `  — ${p.label}` : ''}`;
    };

    switch (action) {
      case 'list': {
        const all = processManager.list();
        if (all.length === 0) return 'No background processes.';
        return `id\tpid\tstatus\tuptime\tcommand\n${all.map(fmt).join('\n')}`;
      }
      case 'logs':
      case 'poll': {
        if (!id) throw new Error('id is required');
        const { lines, nextLine, proc } = processManager.poll(id, {
          tail: typeof args.tail === 'number' ? args.tail : 100,
          fromLine: typeof args.from_line === 'number' ? args.from_line : undefined,
        });
        return `[${proc.id} ${proc.status}${proc.exitCode !== null ? ` exit=${proc.exitCode}` : ''} · next_line=${nextLine}]\n${lines.join('\n') || '(no new output)'}`;
      }
      case 'wait': {
        if (!id) throw new Error('id is required');
        const timeout = Math.min(180_000, typeof args.timeout === 'number' ? args.timeout : 30_000);
        const pattern = typeof args.pattern === 'string' && args.pattern ? new RegExp(args.pattern, 'i') : null;
        const r = await processManager.waitFor(id, pattern, timeout);
        const proc = processManager.get(id)!;
        const head = r.matched ? 'Pattern matched.' : r.exited ? `Process exited (code ${proc.exitCode}).` : 'Timed out waiting.';
        return `${head}\n${r.lines.slice(-80).join('\n')}`;
      }
      case 'write': {
        if (!id) throw new Error('id is required');
        const input = typeof args.input === 'string' ? args.input : '';
        processManager.write(id, input);
        await new Promise(r => setTimeout(r, 300));
        const { lines } = processManager.poll(id, { tail: 20 });
        return `Wrote ${input.length} chars to ${id}.\n${lines.join('\n')}`;
      }
      case 'kill': {
        if (!id) throw new Error('id is required');
        const ok = await processManager.kill(id);
        return ok ? `Killed ${id}.` : `No such process: ${id}`;
      }
      case 'kill_all': {
        const n = await processManager.killAll();
        return `Killed ${n} process(es).`;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};
