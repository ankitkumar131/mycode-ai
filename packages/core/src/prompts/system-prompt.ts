import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform, arch, release, hostname } from 'node:os';
import { execSync } from 'node:child_process';

export class SystemPromptBuilder {
  private parts: string[] = [];

  addSection(section: string): void {
    this.parts.push(section);
  }

  build(): string {
    return this.parts.join('\n\n');
  }

  static default(): string {
    return 'You are MyCode, a multi-provider AI coding agent.';
  }

  static async buildSystemPrompt(
    cwd: string,
    options?: {
      tools?: string[];
      model?: string;
      provider?: string;
    }
  ): Promise<string> {
    const builder = new SystemPromptBuilder();

    // Core identity
    const modelInfo = options?.model ? ` (${options.model})` : '';
    const providerInfo = options?.provider ? ` via ${options.provider}` : '';
    builder.addSection(
      `You are MyCode, an AI coding agent${modelInfo}${providerInfo}. You help users with software engineering tasks by reading, writing, and searching files, fetching web documentation, and executing shell commands.`
    );

    // OS and environment
    const osInfo = `${platform()} ${arch()} ${release()}`;
    const host = hostname();
    let shell = '';
    try {
      if (platform() === 'win32') {
        shell = process.env.COMSPEC || 'cmd.exe';
      } else {
        shell = process.env.SHELL || '/bin/bash';
      }
    } catch {
      shell = 'unknown';
    }

    builder.addSection(
      `Environment:\n- OS: ${osInfo}\n- Host: ${host}\n- Shell: ${shell}\n- Working directory: ${cwd}`
    );

    // Project context
    const projectParts: string[] = [];

    const pkgPath = resolve(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const name = pkg.name ?? '(unnamed)';
        const desc = pkg.description ?? '';
        projectParts.push(`Package: ${name}${desc ? ` — ${desc}` : ''}`);
        if (pkg.scripts) {
          const scripts = Object.keys(pkg.scripts).slice(0, 10);
          if (scripts.length > 0) {
            projectParts.push(`Available scripts: ${scripts.join(', ')}`);
          }
        }
      } catch {
        // ignore
      }
    }

    if (projectParts.length > 0) {
      builder.addSection(projectParts.join('\n'));
    }

    // Git context
    const gitParts: string[] = [];
    try {
      const branch = execSync('git branch --show-current', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (branch) {
        gitParts.push(`Branch: ${branch}`);
      }
    } catch {
      // not a git repo
    }

    try {
      const status = execSync('git status --short 2>nul', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (status) {
        const lines = status.split('\n').filter(Boolean);
        gitParts.push(`Working tree: ${lines.length} change(s)`);
      }
    } catch {
      // ignore
    }

    if (gitParts.length > 0) {
      builder.addSection(gitParts.join('\n'));
    }

    // MYCODE.md or AGENTS.md custom instructions
    for (const filename of ['MYCODE.md', 'AGENTS.md', 'CLAUDE.md']) {
      const mdPath = resolve(cwd, filename);
      if (existsSync(mdPath)) {
        try {
          const content = readFileSync(mdPath, 'utf-8').trim();
          if (content) {
            builder.addSection(
              `Custom instructions from ${filename}:\n${content}`
            );
          }
        } catch {
          // ignore
        }
        break;
      }
    }

    // Available tools
    if (options?.tools && options.tools.length > 0) {
      builder.addSection(`Available tools: ${options.tools.join(', ')}`);
    }

    // Behavior rules
    builder.addSection(
      `Rules:
- Use readDocument or readPDF or read-file to examine files and extract text directly.
- CRITICAL DOCUMENT INSTRUCTION: NEVER write or execute scripts (Python, Node, Bash, etc.) to read PDF, Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx), OpenDocument (.odt), Rich Text (.rtf), HTML, or text files. ALWAYS use readDocument, readPDF, or read-file tools directly. Writing scripts for file reading is strictly forbidden.
- Use fetchWebPage to read online docs, articles, or API references.
- Use globSearch to quickly discover files by pattern (e.g. "**/*.ts").
- Use search-files to find code text inside files.
- Use exec-command to run tests, linters, and build commands.
- Use write-file for creating new files.
- Use edit-file for targeted edits to existing files.
- Use git-status to check repository state before and after changes.
- Always verify your changes work by running appropriate commands.`
    );

    return builder.build();
  }
}
