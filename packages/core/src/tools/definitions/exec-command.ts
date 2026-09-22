/**
 * terminal — Claude Code-powerful command execution
 * 
 * Enhancements:
 * - Batching: multiple commands in one call (&&) optimized to single approval
 * - Smart output: token-efficient truncation with head+tail, error extraction
 * - Approval flow: safety classification, auto-approve read-only
 * - Background management: improved logs, process reuse
 * - Memory capture: auto-log to memory manager
 * - Verification: structured exit reporting
 * - Caching: avoid re-running identical commands quickly
 */

import type { ToolModule } from '../types.js';

const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT = 120_000;
const READONLY_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'pwd', 'echo', 'git status', 'git log', 'git diff', 'npm list', 'node -v', 'python -v']);

// Simple command cache to avoid token waste on repeated reads
const recentCommands = new Map<string, { output: string; timestamp: number }>();
const CACHE_TTL = 10_000; // 10s cache for identical commands

function isReadOnly(cmd: string): boolean {
  const trimmed = cmd.trim().toLowerCase();
  for (const ro of READONLY_COMMANDS) {
    if (trimmed.startsWith(ro)) return true;
  }
  return trimmed.startsWith('ls ') || trimmed.startsWith('cat ') || trimmed.startsWith('echo ') || trimmed.startsWith('pwd');
}

function smartTruncate(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  
  // Try to preserve errors
  const lines = output.split('\n');
  const errorLines = lines.filter(l => /error|fail|exception|traceback/i.test(l)).slice(0, 10);
  
  const headSize = Math.floor(maxChars * 0.4);
  const tailSize = Math.floor(maxChars * 0.4);
  const head = output.slice(0, headSize);
  const tail = output.slice(-tailSize);
  const truncated = output.length - head.length - tail.length;
  
  let result = `${head}\n...[${truncated} chars truncated, ${lines.length} lines total]...\n${tail}`;
  
  if (errorLines.length > 0) {
    result += `\n\nErrors detected:\n${errorLines.join('\n').slice(0, 1000)}`;
  }
  
  return result;
}

function extractSummary(output: string, exitCode: number | null): string {
  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '(no output)';
  
  // Last few lines often have summary
  const lastLines = lines.slice(-3).join(' | ').slice(0, 200);
  if (exitCode === 0) {
    if (output.includes('passed') || output.includes('ok') || output.includes('success')) {
      return lastLines;
    }
  }
  return '';
}

export const execCommandTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'terminal',
      description: 'Run shell commands — batched, token-efficient, self-verifying. Use for builds, tests, git, package managers. Set background=true for servers. Output smart-truncated (errors preserved). Read-only commands auto-approved. Batch related commands with && to save approval prompts.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command (can batch with && ; || ). Multiple related steps in ONE call to minimize approvals.' },
          description: { type: 'string', description: 'Short human-readable description (shown to user)' },
          timeout: { type: 'number', description: 'Timeout ms, default 120000, max 1800000' },
          background: { type: 'boolean', description: 'Start in background, return process id immediately' },
          cwd: { type: 'string', description: 'Subdirectory relative to workspace to run in' },
        },
        required: ['command'],
      },
    },
  },

  async execute(args, cwd, options) {
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    const description = typeof args.description === 'string' ? args.description : undefined;
    const timeout = Math.min(1_800_000, typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT);
    const background = args.background === true;

    if (!command) throw new Error('Command required');
    if (options?.abortSignal?.aborted) return 'Aborted.';

    const { resolve, relative, isAbsolute } = await import('node:path');
    let runCwd = cwd;
    if (typeof args.cwd === 'string' && args.cwd.trim()) {
      const target = resolve(cwd, args.cwd);
      const rel = relative(cwd, target);
      if (rel.startsWith('..') || isAbsolute(rel) && !target.startsWith(cwd)) {
        throw new Error(`cwd must be inside workspace: ${args.cwd}`);
      }
      runCwd = target;
    }

    // Cache check for identical read-only commands
    const cacheKey = `${runCwd}:${command}`;
    const cached = recentCommands.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && isReadOnly(command)) {
      return `${cached.output}\n[cached ${Math.round((Date.now() - cached.timestamp)/1000)}s ago]`;
    }

    const { classifyCommand } = await import('../command-safety.js');
    const safety = classifyCommand(command);
    if (safety.level === 'blocked') throw new Error(`Blocked: ${safety.reason}`);

    // Approval: auto-approve read-only unless dangerous
    const needsApproval = !isReadOnly(command) || safety.level !== 'safe';
    if (needsApproval && options?.confirmFn) {
      const confirmed = await options.confirmFn(command, description ?? null, safety);
      if (!confirmed) {
        options.commandHistory?.add({ 
          command, cwd: runCwd, exitCode: null, signal: null, 
          durationMs: 0, status: 'cancelled', 
          output: 'Cancelled', outputPreview: 'Cancelled' 
        });
        return 'Cancelled by user. Ask before retrying or try different approach.';
      }
    }

    if (background) {
      const { processManager } = await import('../process-manager.js');
      const proc = processManager.start(command, runCwd, { label: description });
      await new Promise(r => setTimeout(r, 800));
      const { lines } = processManager.poll(proc.id, { tail: 30 });
      const state = proc.status === 'running' ? `running pid ${proc.pid}` : `exited ${proc.exitCode}`;
      
      // Memory capture
      try {
        const { memoryManager } = await import('../../memory/memory-manager.js');
        memoryManager.captureObservation({
          sessionId: `sess_${Date.now()}`,
          cwd: runCwd,
          tool: 'terminal',
          input: { command, background: true },
          output: `Started ${proc.id}: ${state}`,
          success: true,
          durationMs: 0,
          tags: [command.split(' ')[0], 'background'],
        });
      } catch {}

      return [
        `Background ${proc.id}: ${state}`,
        lines.length ? `Initial:\n${lines.join('\n').slice(0, 2000)}` : '(no output yet)',
        `Use process(action="logs", id="${proc.id}") to read, process(action="kill", id="${proc.id}") to stop.`
      ].join('\n');
    }

    const { executeCommand } = await import('../command-executor.js');
    const result = await executeCommand(command, runCwd, { timeout, abortSignal: options?.abortSignal });

    options?.commandHistory?.add({
      command,
      cwd: runCwd,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      status: result.status,
      output: result.output,
      outputPreview: result.output.slice(0, 200),
    });

    // Cache successful read-only commands
    if (result.exitCode === 0 && isReadOnly(command)) {
      recentCommands.set(cacheKey, { output: result.output.slice(0, MAX_OUTPUT_CHARS), timestamp: Date.now() });
      // Cleanup old cache entries
      if (recentCommands.size > 50) {
        const oldest = Array.from(recentCommands.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) recentCommands.delete(oldest[0]);
      }
    }

    // Memory capture for important commands
    try {
      const { memoryManager } = await import('../../memory/memory-manager.js');
      const isImportant = /npm|yarn|pnpm|build|test|git|deploy|migrate/i.test(command);
      if (isImportant) {
        memoryManager.captureObservation({
          sessionId: `sess_${Date.now()}`,
          cwd: runCwd,
          tool: 'terminal',
          input: { command, description },
          output: result.output.slice(0, 1000),
          success: result.exitCode === 0,
          durationMs: result.durationMs,
          tags: [command.split(' ')[0], result.exitCode === 0 ? 'success' : 'failed'],
        });
      }
    } catch {}

    let output = smartTruncate(result.output || '', MAX_OUTPUT_CHARS);
    const parts: string[] = [];
    
    if (output.trim()) parts.push(output.trimEnd());
    else parts.push('(no output)');

    const status = result.timedOut ? 'TIMED OUT' : result.killed ? 'KILLED' : result.exitCode === 0 ? 'SUCCESS' : 'FAILED';
    const summary = extractSummary(result.output, result.exitCode);
    
    parts.push(`\n[${status} exit ${result.exitCode ?? result.signal ?? '?'} · ${(result.durationMs / 1000).toFixed(1)}s${summary ? ` · ${summary}` : ''}]`);
    
    // Suggest next steps on failure
    if (result.exitCode !== 0 && result.exitCode !== null) {
      if (result.output.toLowerCase().includes('module not found') || result.output.toLowerCase().includes('cannot find')) {
        parts.push('Hint: missing dependency — try npm install / check import path');
      } else if (result.output.toLowerCase().includes('permission denied')) {
        parts.push('Hint: permission issue — check file permissions or use sudo if appropriate');
      } else if (result.output.toLowerCase().includes('port in use') || result.output.toLowerCase().includes('eaddrinuse')) {
        parts.push('Hint: port busy — kill existing process or use different port');
      }
    }

    return parts.join('\n');
  },
};
