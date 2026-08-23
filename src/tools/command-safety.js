/**
 * Command Safety & Classification System
 * Classifies commands into safety levels and detects dangerous patterns.
 *
 * Safety Levels:
 *   BLOCKED   — Never execute (destructive system commands, fork bombs)
 *   DANGEROUS — Extra confirmation + warning banner required
 *   ELEVATED  — Standard confirmation with context
 *   NORMAL    — Standard confirmation (or auto-approve if --yes)
 */

/**
 * @typedef {'blocked'|'dangerous'|'elevated'|'normal'} SafetyLevel
 */

/**
 * @typedef {object} SafetyResult
 * @property {SafetyLevel} level
 * @property {string} reason — Human-readable explanation
 * @property {string[]} warnings — Additional warning messages
 */

// ── BLOCKED commands — never allowed ────────────────────────────────────────

const BLOCKED_PATTERNS = [
  // Unix destructive — only block root-targeting recursive deletes
  { pattern: /\brm\s+(-\w*r\w*\s+\/\s*$|--recursive\s+\/\s*$)/, reason: 'Recursive delete on root path' },
  { pattern: /\brm\s+-\w*f\w*\s+-\w*r\w*\s+\/\s*$/, reason: 'Force recursive delete on root' },
  { pattern: /\brm\s+-\w*r\w*\s+-\w*f\w*\s+\/\s*$/, reason: 'Force recursive delete on root' },
  { pattern: /\brm\s+-rf\s+\/\s*$/, reason: 'Force recursive delete on root' },
  { pattern: /\bmkfs\b/, reason: 'Filesystem format command' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/, reason: 'Fork bomb detected' },
  { pattern: /\bdd\s+.*of=\/dev\/[sh]d/, reason: 'Direct disk write' },
  { pattern: /\b>\s*\/dev\/[sh]d/, reason: 'Direct disk write via redirect' },

  // Windows destructive
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Disk format command' },
  { pattern: /\bdel\s+\/[fF]\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i, reason: 'Force delete entire drive' },
  { pattern: /\brd\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i, reason: 'Remove directory tree on drive root' },
  { pattern: /\bdiskpart/i, reason: 'Disk partition tool' },
  { pattern: /\bbcdedit/i, reason: 'Boot configuration editor' },
  { pattern: /\breg\s+delete\s+HKLM/i, reason: 'Registry deletion on HKLM' },
  { pattern: /\breg\s+delete\s+HKCR/i, reason: 'Registry deletion on HKCR' },

  // Cross-platform
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, reason: 'Piping remote script to shell' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/i, reason: 'Piping remote script to shell' },
];

// ── DANGEROUS commands — require extra warning ──────────────────────────────

const DANGEROUS_PATTERNS = [
  // Destructive file operations
  { pattern: /\brm\s+(-\w*r|-R|--recursive)\b/, reason: 'Recursive file deletion' },
  { pattern: /\brm\s+(-\w*f|--force)\b/, reason: 'Forced file deletion' },
  { pattern: /\bdel\s+\/[sS]/i, reason: 'Recursive file deletion (Windows)' },
  { pattern: /\brmdir\s+\/[sS]/i, reason: 'Recursive directory deletion (Windows)' },
  { pattern: /\brd\s+\/[sS]/i, reason: 'Recursive directory deletion (Windows)' },

  // Git destructive operations
  { pattern: /\bgit\s+push\s+.*--force\b/, reason: 'Force push (can lose remote commits)' },
  { pattern: /\bgit\s+push\s+-f\b/, reason: 'Force push (can lose remote commits)' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Hard reset (discards uncommitted changes)' },
  { pattern: /\bgit\s+clean\s+-\w*f\w*d/i, reason: 'Git clean (removes untracked files and directories)' },
  { pattern: /\bgit\s+checkout\s+--\s*\.\s*$/, reason: 'Discard all working changes' },

  // Package publishing
  { pattern: /\bnpm\s+publish\b/, reason: 'Publishing to npm registry' },
  { pattern: /\bnpm\s+unpublish\b/, reason: 'Unpublishing from npm registry' },

  // System modification
  { pattern: /\bchmod\s+(-\w*R|--recursive)\b/, reason: 'Recursive permission change' },
  { pattern: /\bchown\s+(-\w*R|--recursive)\b/, reason: 'Recursive ownership change' },
  { pattern: /\bsudo\b/, reason: 'Elevated privilege execution' },
  { pattern: /\brunas\b/i, reason: 'Elevated privilege execution (Windows)' },

  // Process management
  { pattern: /\bkill\s+-9\b/, reason: 'Force kill process' },
  { pattern: /\bkillall\b/, reason: 'Kill all processes by name' },
  { pattern: /\btaskkill\s+\/F/i, reason: 'Force kill process (Windows)' },

  // Database operations
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: 'Database drop operation' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: 'Database truncate operation' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*;?\s*$/i, reason: 'Unfiltered database delete' },
];

// ── ELEVATED commands — standard confirmation with context ──────────────────

const ELEVATED_PATTERNS = [
  { pattern: /\bnpm\s+install\b/, reason: 'Package installation' },
  { pattern: /\bnpm\s+i\b/, reason: 'Package installation' },
  { pattern: /\byarn\s+add\b/, reason: 'Package installation' },
  { pattern: /\bpnpm\s+(add|install)\b/, reason: 'Package installation' },
  { pattern: /\bpip\s+install\b/, reason: 'Python package installation' },
  { pattern: /\bgit\s+push\b/, reason: 'Pushing to remote repository' },
  { pattern: /\bgit\s+commit\b/, reason: 'Creating a git commit' },
  { pattern: /\bgit\s+merge\b/, reason: 'Merging branches' },
  { pattern: /\bgit\s+rebase\b/, reason: 'Rebasing branch' },
  { pattern: /\bgit\s+stash\s+drop\b/, reason: 'Dropping stashed changes' },
  { pattern: /\bdocker\s+(rm|rmi|stop|kill)\b/, reason: 'Docker container/image modification' },
  { pattern: /\bdocker-compose\s+down\b/, reason: 'Stopping Docker services' },
  { pattern: /\bnpx\b/, reason: 'Executing npm package binaries' },
  { pattern: /\breg\s+(add|delete)\b/i, reason: 'Windows registry modification' },
];

// ── Structural warnings (not a safety level, but additional context) ────────

/**
 * Detect structural concerns in a command string.
 * @param {string} command
 * @returns {string[]} List of warning messages
 */
function detectStructuralWarnings(command) {
  const warnings = [];

  // Pipe chains — potential for injection or unexpected behavior
  if (/\|/.test(command)) {
    const pipeCount = (command.match(/\|/g) || []).length;
    if (pipeCount > 2) {
      warnings.push(`Complex pipe chain (${pipeCount} pipes) — review each stage carefully`);
    }
  }

  // Command chaining with && or ; or ||
  if (/[;&]{1,2}|\|\|/.test(command)) {
    const parts = command.split(/\s*(?:&&|;|\|\|)\s*/);
    if (parts.length > 3) {
      warnings.push(`Long command chain (${parts.length} commands) — each command will execute sequentially`);
    }
  }

  // Path traversal
  if (/\.\.\/.*\.\.\//.test(command) || /\.\.\\\.\.\\/i.test(command)) {
    warnings.push('Multiple path traversals detected (../../..) — verify target path');
  }

  // Redirect to existing file (overwrite risk)
  if (/[^>]>\s*[^>]/.test(command) && !/>>/.test(command.split(/[^>]>\s*/)[0])) {
    warnings.push('Output redirection (>) will overwrite the target file');
  }

  // Environment variable injection
  if (/\$\(.*\)/.test(command) || /`.*`/.test(command)) {
    warnings.push('Command substitution detected — output of subcommand will be used');
  }

  return warnings;
}

/**
 * Classify a command's safety level.
 * @param {string} command - The shell command to classify
 * @returns {SafetyResult}
 */
export function classifyCommand(command) {
  const trimmed = command.trim();
  const warnings = detectStructuralWarnings(trimmed);

  // Check BLOCKED first
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: 'blocked', reason, warnings };
    }
  }

  // Check DANGEROUS
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: 'dangerous', reason, warnings };
    }
  }

  // Check ELEVATED
  for (const { pattern, reason } of ELEVATED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: 'elevated', reason, warnings };
    }
  }

  return { level: 'normal', reason: '', warnings };
}

/**
 * Check if a command is completely blocked.
 * @param {string} command
 * @returns {{ blocked: boolean, reason: string }}
 */
export function isBlocked(command) {
  const result = classifyCommand(command);
  return {
    blocked: result.level === 'blocked',
    reason: result.reason,
  };
}

/**
 * Get a human-readable label for a safety level.
 * @param {SafetyLevel} level
 * @returns {string}
 */
export function getSafetyLabel(level) {
  switch (level) {
    case 'blocked':   return '🚫 BLOCKED';
    case 'dangerous': return '⛔ DANGEROUS';
    case 'elevated':  return '⚠️  ELEVATED';
    case 'normal':    return '✔  NORMAL';
    default:          return '?  UNKNOWN';
  }
}
