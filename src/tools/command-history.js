/**
 * Command History — Session Command Tracker
 * Tracks all commands executed within a session for review and AI context.
 */

/**
 * @typedef {object} CommandRecord
 * @property {string} command — The command that was executed
 * @property {string} cwd — Working directory
 * @property {number|null} exitCode — Exit code (null if killed/timeout)
 * @property {string|null} signal — Signal that terminated the process (e.g., 'SIGTERM')
 * @property {number} durationMs — Execution time in milliseconds
 * @property {string} status — 'success' | 'failed' | 'killed' | 'timeout' | 'cancelled'
 * @property {string} outputPreview — First 200 chars of output for quick review
 * @property {string} timestamp — ISO timestamp when command was started
 */

export class CommandHistory {
  constructor() {
    /** @type {CommandRecord[]} */
    this._records = [];
  }

  /**
   * Record a completed command execution.
   * @param {object} record
   * @param {string} record.command
   * @param {string} record.cwd
   * @param {number|null} record.exitCode
   * @param {string|null} record.signal
   * @param {number} record.durationMs
   * @param {string} record.status
   * @param {string} record.output — Full output (will be truncated for preview)
   */
  add(record) {
    this._records.push({
      command: record.command,
      cwd: record.cwd,
      exitCode: record.exitCode ?? null,
      signal: record.signal || null,
      durationMs: record.durationMs || 0,
      status: record.status || 'success',
      outputPreview: (record.output || '').slice(0, 200),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get all records.
   * @returns {CommandRecord[]}
   */
  getAll() {
    return [...this._records];
  }

  /**
   * Get the count of recorded commands.
   * @returns {number}
   */
  count() {
    return this._records.length;
  }

  /**
   * Get a formatted summary for display in the terminal.
   * @returns {string}
   */
  formatSummary() {
    if (this._records.length === 0) {
      return 'No commands executed in this session.';
    }

    const lines = ['Command History', '─'.repeat(50)];

    for (let i = 0; i < this._records.length; i++) {
      const r = this._records[i];
      const num = String(i + 1).padStart(2, ' ');
      const statusIcon = this._getStatusIcon(r.status);
      const duration = this._formatDuration(r.durationMs);
      const exitStr = r.exitCode !== null ? `exit ${r.exitCode}` : r.signal || 'n/a';

      lines.push(`${num}. ${statusIcon} $ ${r.command}`);
      lines.push(`     ${duration} | ${exitStr} | ${r.cwd}`);
    }

    const successes = this._records.filter((r) => r.status === 'success').length;
    const failures = this._records.length - successes;
    lines.push('─'.repeat(50));
    lines.push(`Total: ${this._records.length} commands | ${successes} succeeded | ${failures} failed`);

    return lines.join('\n');
  }

  /**
   * Get a compact context string for the AI system prompt.
   * Shows the last N commands to help the AI avoid re-running them.
   * @param {number} maxEntries
   * @returns {string|null} null if no commands
   */
  getContextSummary(maxEntries = 10) {
    if (this._records.length === 0) return null;

    const recent = this._records.slice(-maxEntries);
    const lines = recent.map((r) => {
      const status = r.status === 'success' ? '✔' : '✖';
      const exit = r.exitCode !== null ? `exit ${r.exitCode}` : r.signal || '?';
      return `${status} $ ${r.command} → ${exit}`;
    });

    return `## Recent Commands (this session)\n${lines.join('\n')}`;
  }

  /**
   * Clear history.
   */
  clear() {
    this._records = [];
  }

  // ── Private ──

  _getStatusIcon(status) {
    switch (status) {
      case 'success':   return '✔';
      case 'failed':    return '✖';
      case 'killed':    return '⚡';
      case 'timeout':   return '⏱';
      case 'cancelled': return '⊘';
      default:          return '?';
    }
  }

  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
}
