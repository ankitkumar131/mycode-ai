/**
 * ToolRegistry — canonical tool names, aliases, toolsets, enable/disable.
 *
 * Canonical names (snake_case, Hermes-style):
 *   files:     read_file, write_file, patch, list_dir, glob, search_files, read_document, read_pdf
 *   terminal:  terminal, process, execute_code
 *   git:       git_status
 *   web:       web_search, web_fetch
 *   skills:    skills_list, skill_view, skill_manage
 *   agent:     todo_write, read_instructions, delegate
 *
 * Older camelCase / kebab-case names remain accepted as aliases so existing
 * prompts, tests and third-party plugins keep working.
 */

import type { ToolModule, ToolFunctionDefinition, ToolDefinition, ToolHandler, SafetyResult, CommandRecord } from './types.js';
import { readFileTool } from './definitions/read-file.js';
import { writeFileTool } from './definitions/write-file.js';
import { editFileTool } from './definitions/edit-file.js';
import { listDirTool } from './definitions/list-dir.js';
import { searchFilesTool } from './definitions/search-files.js';
import { gitStatusTool } from './definitions/git-status.js';
import { execCommandTool } from './definitions/exec-command.js';
import { processTool } from './definitions/process.js';
import { readPdfTool } from './definitions/read-pdf.js';
import { readDocumentTool } from './definitions/read-document.js';
import { fetchWebPageTool } from './definitions/web-fetch.js';
import { webSearchTool } from './definitions/web-search.js';
import { globSearchTool } from './definitions/glob-search.js';
import { codeExecTool } from './definitions/code-exec.js';
import { todoWriteTool } from './definitions/todowrite.js';
import { readInstructionsTool } from './definitions/read-instructions.js';
import { skillsListTool, skillViewTool, skillManageTool } from './definitions/skills.js';
import { memoryTool } from './definitions/memory.js';

export const TOOLSETS: Record<string, string[]> = {
  files: ['read_file', 'write_file', 'patch', 'list_dir', 'glob', 'search_files', 'read_document', 'read_pdf'],
  terminal: ['terminal', 'process', 'execute_code'],
  git: ['git_status'],
  web: ['web_search', 'web_fetch'],
  skills: ['skills_list', 'skill_view', 'skill_manage'],
  agent: ['todo_write', 'read_instructions', 'memory'],
};

const ALL_TOOLS: ToolModule[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globSearchTool,
  searchFilesTool,
  readDocumentTool,
  readPdfTool,
  execCommandTool,
  processTool,
  codeExecTool,
  gitStatusTool,
  webSearchTool,
  fetchWebPageTool,
  skillsListTool,
  skillViewTool,
  skillManageTool,
  todoWriteTool,
  readInstructionsTool,
  memoryTool,
];

export const ALIASES: Record<string, string> = {
  // read_file
  readFile: 'read_file',
  'read-file': 'read_file',
  read: 'read_file',
  // write_file
  writeFile: 'write_file',
  'write-file': 'write_file',
  write: 'write_file',
  // patch
  editFile: 'patch',
  'edit-file': 'patch',
  edit_file: 'patch',
  edit: 'patch',
  str_replace: 'patch',
  // list_dir
  listDirectory: 'list_dir',
  'list-dir': 'list_dir',
  ls: 'list_dir',
  // glob
  globSearch: 'glob',
  glob_search: 'glob',
  find_files: 'glob',
  // search_files
  searchFiles: 'search_files',
  'search-files': 'search_files',
  grep: 'search_files',
  // documents
  readDocument: 'read_document',
  'read-document': 'read_document',
  readPDF: 'read_pdf',
  readPdf: 'read_pdf',
  // terminal
  executeCommand: 'terminal',
  'exec-command': 'terminal',
  exec_command: 'terminal',
  bash: 'terminal',
  shell: 'terminal',
  run_command: 'terminal',
  // execute_code
  codeExec: 'execute_code',
  code_exec: 'execute_code',
  // git
  gitStatus: 'git_status',
  'git-status': 'git_status',
  // web
  fetchWebPage: 'web_fetch',
  fetch_web_page: 'web_fetch',
  webSearch: 'web_search',
  // misc
  todoWrite: 'todo_write',
  readInstructions: 'read_instructions',
  skills: 'skills_list',
  list_skills: 'skills_list',
  view_skill: 'skill_view',
};

const WRITE_TOOLS = new Set(['write_file', 'patch', 'execute_code', 'terminal', 'skill_manage']);

export interface ExecuteToolOptions {
  confirmFn?: (target: string, context?: string | null, safety?: SafetyResult) => Promise<boolean>;
  commandHistory?: { add(record: CommandRecord): void };
  abortSignal?: AbortSignal;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private modules: Map<string, ToolModule> = new Map();
  private disabled: Set<string> = new Set();
  private order: string[] = [];

  constructor(opts: { toolsets?: string[]; disabled?: string[] } = {}) {
    for (const mod of ALL_TOOLS) {
      const name = mod.definition.function.name;
      this.modules.set(name, mod);
      this.order.push(name);
    }
    if (opts.toolsets && opts.toolsets.length) {
      const allowed = new Set(opts.toolsets.flatMap(t => TOOLSETS[t] ?? [t]));
      for (const name of this.order) if (!allowed.has(name)) this.disabled.add(name);
    }
    for (const d of opts.disabled ?? []) this.disabled.add(this.canonical(d));
  }

  canonical(name: string): string {
    return ALIASES[name] ?? name;
  }

  register(name: string, definition: ToolDefinition): void {
    this.tools.set(name, definition);
  }

  registerModule(mod: ToolModule): void {
    const name = mod.definition.function.name;
    if (!this.modules.has(name)) this.order.push(name);
    this.modules.set(name, mod);
  }

  unregister(name: string): boolean {
    const c = this.canonical(name);
    const had = this.modules.delete(c) || this.tools.delete(c);
    this.order = this.order.filter(n => n !== c);
    return had;
  }

  // ─── Enable / disable ─────────────────────────────────────────────────────

  disable(name: string): boolean {
    const c = this.canonical(name);
    if (!this.modules.has(c) && !this.tools.has(c)) return false;
    this.disabled.add(c);
    return true;
  }

  enable(name: string): boolean {
    const c = this.canonical(name);
    if (!this.modules.has(c) && !this.tools.has(c)) return false;
    this.disabled.delete(c);
    return true;
  }

  isEnabled(name: string): boolean {
    return !this.disabled.has(this.canonical(name));
  }

  getDisabled(): string[] {
    return Array.from(this.disabled);
  }

  getToolsets(): Array<{ name: string; tools: string[]; enabled: number }> {
    return Object.entries(TOOLSETS).map(([name, tools]) => ({
      name,
      tools,
      enabled: tools.filter(t => this.modules.has(t) && !this.disabled.has(t)).length,
    }));
  }

  toolsetOf(name: string): string | undefined {
    const c = this.canonical(name);
    return Object.entries(TOOLSETS).find(([, tools]) => tools.includes(c))?.[0];
  }

  // ─── Lookup ───────────────────────────────────────────────────────────────

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name) ?? (this.modules.get(this.canonical(name)) as unknown as ToolDefinition | undefined);
  }

  getAll(): ToolDefinition[] {
    const legacy = Array.from(this.tools.values());
    const modDefs = Array.from(this.modules.values()).map(m => ({
      name: m.definition.function.name,
      description: m.definition.function.description,
      parameters: m.definition.function.parameters,
      handler: (async () => '') as ToolHandler,
    }));
    return [...legacy, ...modDefs];
  }

  getDefinitions(options?: { filterWriteTools?: boolean; includeDisabled?: boolean }): ToolFunctionDefinition[] {
    const seen = new Set<string>();
    let defs: ToolFunctionDefinition[] = [];
    for (const name of this.order) {
      const mod = this.modules.get(name);
      if (!mod || seen.has(name)) continue;
      if (!options?.includeDisabled && this.disabled.has(name)) continue;
      seen.add(name);
      defs.push(mod.definition);
    }
    for (const [name, legacy] of this.tools) {
      if (seen.has(name) || (!options?.includeDisabled && this.disabled.has(name))) continue;
      defs.push({ type: 'function', function: { name, description: legacy.description, parameters: legacy.parameters } });
    }
    if (options?.filterWriteTools) defs = defs.filter(d => !WRITE_TOOLS.has(d.function.name));
    return defs;
  }

  async executeTool(name: string, args: Record<string, unknown>, cwd: string, execOptions?: ExecuteToolOptions): Promise<string> {
    const canonicalName = this.canonical(name);
    if (this.disabled.has(canonicalName)) {
      throw new Error(`Tool "${canonicalName}" is disabled for this session.`);
    }
    const mod = this.modules.get(canonicalName) || this.modules.get(name);
    if (mod) {
      const res = await mod.execute(args, cwd, execOptions);
      return typeof res === 'string' ? res : JSON.stringify(res, null, 2);
    }
    const legacy = this.tools.get(name) ?? this.tools.get(canonicalName);
    if (legacy) return await legacy.handler(args);

    const known = this.getToolNames().slice(0, 12).join(', ');
    throw new Error(`Unknown tool: ${name}. Available: ${known}…`);
  }

  isValidTool(name: string): boolean {
    const c = this.canonical(name);
    return this.modules.has(c) || this.modules.has(name) || this.tools.has(name);
  }

  isWriteTool(name: string): boolean {
    return WRITE_TOOLS.has(this.canonical(name));
  }

  getToolNames(): string[] {
    return [...new Set([...this.order, ...this.tools.keys()])];
  }

  getTool(name: string): ToolModule | undefined {
    return this.modules.get(this.canonical(name)) || this.modules.get(name);
  }
}
