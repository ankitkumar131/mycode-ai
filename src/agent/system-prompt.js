/**
 * System Prompt Builder
 * Constructs the system prompt for the AI agent, including context about
 * the current project, available tools, and user instructions.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { getToolNames } from '../tools/registry.js';

/**
 * Build the full system prompt for the AI agent.
 * @param {string} cwd - Current working directory
 * @param {object} options - { mode: 'chat'|'agent'|'explain'|'fix'|'edit' }
 * @returns {string} The complete system prompt
 */
export function buildSystemPrompt(cwd, options = {}) {
  const mode = options.mode || 'agent';
  const parts = [];

  // Core identity
  parts.push(getIdentityPrompt(mode));

  // Tool usage instructions (only for agent/chat modes)
  if (mode === 'agent' || mode === 'chat') {
    parts.push(getToolInstructions());
  }

  // Project context
  parts.push(getProjectContext(cwd));

  // MYCODE.md instructions (if present)
  const mycodeInstructions = getMycodeInstructions(cwd);
  if (mycodeInstructions) {
    parts.push(mycodeInstructions);
  }

  // Git context
  const gitContext = getGitContext(cwd);
  if (gitContext) {
    parts.push(gitContext);
  }

  return parts.join('\n\n');
}

function getIdentityPrompt(mode) {
  const base = `You are MyCode, an expert AI coding assistant running in the user's terminal.
You help users understand, write, debug, and improve code.
You are direct, precise, and write high-quality code.

Key behaviors:
- Keep explanations brief and get to the change quickly
- When editing files, use the editFile tool for targeted changes (preferred) or writeFile for new files
- Read files before editing them to understand the full context
- Run tests after making changes when possible
- Ask for clarification when requirements are ambiguous
- Use markdown formatting in your responses`;

  const modeInstructions = {
    agent: `\n\nYou are in AGENT MODE. You can read files, write files, search code, execute commands, and interact with git. Work autonomously to complete the user's task, iterating until done.`,
    chat: `\n\nYou are in CHAT MODE. You can use tools to read and understand code, and write/edit files when asked. Have a helpful conversation with the user about their codebase.`,
    explain: `\n\nYou are in EXPLAIN MODE. Analyze the given code and provide a clear, structured explanation including: purpose, key functions/classes, dependencies, potential issues, and suggestions for improvement.`,
    fix: `\n\nYou are in FIX MODE. Analyze the given error or problem, identify the root cause, and propose a fix. Show the exact changes needed.`,
    edit: `\n\nYou are in EDIT MODE. Apply the user's requested changes to the file. Show exactly what you're changing and why.`,
  };

  return base + (modeInstructions[mode] || '');
}

function getToolInstructions() {
  const toolNames = getToolNames();

  return `## Available Tools

You have the following tools available:
${toolNames.map((name) => `- **${name}**`).join('\n')}

When you need to use a tool, call it through the function calling interface.
Always use readFile before editing to understand the full context.
Use editFile for targeted changes to existing files.
Use writeFile only for creating new files.
Use executeCommand to run tests, install packages, or other shell operations.

IMPORTANT:
- Read files before editing them
- NEVER read the same file twice in a single task — remember what you already read
- NEVER call the same tool with the same arguments more than once
- The project context above already contains package.json info and the file tree — do NOT re-read those unless you need the full content
- Be efficient: batch your reads, then make your changes
- Keep pre-change commentary short and avoid long planning when the request is clear
- When writing new files with writeFile, include the COMPLETE file content in a single call — do NOT split across multiple calls
- Show the user what you changed and why after the work is done
- After making changes, verify they work (run tests, check syntax)`;
}

function getProjectContext(cwd) {
  const parts = [`## Project Context\nWorking directory: ${cwd}`];

  // Check for package.json
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      parts.push(`Project: ${pkg.name || 'unnamed'} v${pkg.version || '0.0.0'}`);
      if (pkg.description) parts.push(`Description: ${pkg.description}`);

      const deps = Object.keys(pkg.dependencies || {}).slice(0, 15);
      if (deps.length) parts.push(`Dependencies: ${deps.join(', ')}`);

      const devDeps = Object.keys(pkg.devDependencies || {}).slice(0, 10);
      if (devDeps.length) parts.push(`Dev dependencies: ${devDeps.join(', ')}`);
    } catch {
      // Skip if can't parse
    }
  }

  // File tree (top level)
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    const skipDirs = ['node_modules', '.git', '.next', 'dist', '__pycache__'];
    const tree = entries
      .filter((e) => !skipDirs.includes(e.name) && !e.name.startsWith('.'))
      .slice(0, 30)
      .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`));

    if (tree.length) {
      parts.push(`\nProject files:\n${tree.join('\n')}`);
    }
  } catch {
    // Skip if can't read
  }

  return parts.join('\n');
}

function getMycodeInstructions(cwd) {
  // Check for MYCODE.md (like CLAUDE.md for project-specific instructions)
  const instructionFiles = ['MYCODE.md', 'mycode.md', '.mycode.md'];

  for (const file of instructionFiles) {
    const filePath = join(cwd, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        // Limit to 2000 chars to avoid blowing up context
        const trimmed = content.slice(0, 2000);
        return `## Project Instructions (from ${file})\n${trimmed}`;
      } catch {
        // Skip if can't read
      }
    }
  }

  return null;
}

function getGitContext(cwd) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const branch = execSync('git branch --show-current', {
      cwd,
      encoding: 'utf-8',
    }).trim();

    const status = execSync('git status --short', {
      cwd,
      encoding: 'utf-8',
    }).trim();

    const parts = [`## Git Context\nBranch: ${branch}`];
    if (status) {
      parts.push(`Modified files:\n${status.split('\n').slice(0, 10).join('\n')}`);
    } else {
      parts.push('Working tree clean.');
    }

    return parts.join('\n');
  } catch {
    return null;
  }
}
