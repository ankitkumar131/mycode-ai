import type { ToolModule, ToolFunctionDefinition } from './types.js';
import { readFileTool } from './definitions/read-file.js';
import { writeFileTool } from './definitions/write-file.js';
import { editFileTool } from './definitions/edit-file.js';
import { listDirTool } from './definitions/list-dir.js';
import { searchFilesTool } from './definitions/search-files.js';
import { gitStatusTool } from './definitions/git-status.js';
import { execCommandTool } from './definitions/exec-command.js';
import { readPdfTool } from './definitions/read-pdf.js';
import { fetchWebPageTool } from './definitions/web-fetch.js';
import { globSearchTool } from './definitions/glob-search.js';
import type { ToolDefinition, ToolHandler } from './types.js';

const ALL_TOOLS: ToolModule[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchFilesTool,
  gitStatusTool,
  execCommandTool,
  readPdfTool,
  fetchWebPageTool,
  globSearchTool,
];

// Aliases for camelCase / kebab-case tool invocation matching
const ALIASES: Record<string, string> = {
  'readFile': 'read-file',
  'writeFile': 'write-file',
  'editFile': 'edit-file',
  'listDirectory': 'list-dir',
  'searchFiles': 'search-files',
  'gitStatus': 'git-status',
  'executeCommand': 'exec-command',
  'readPdf': 'readPDF',
  'fetchWebPage': 'fetchWebPage',
  'globSearch': 'globSearch',
};

const WRITE_TOOLS = new Set(['write-file', 'edit-file', 'writeFile', 'editFile']);

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private modules: Map<string, ToolModule> = new Map();

  constructor() {
    for (const mod of ALL_TOOLS) {
      const name = mod.definition.function.name;
      this.modules.set(name, mod);
    }
    // Also register camelCase aliases
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      const mod = this.modules.get(canonical);
      if (mod) {
        this.modules.set(alias, mod);
      }
    }
  }

  register(name: string, definition: ToolDefinition): void {
    this.tools.set(name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name) ?? (this.modules.get(name) as unknown as ToolDefinition | undefined);
  }

  getAll(): ToolDefinition[] {
    const legacy = Array.from(this.tools.values());
    const modDefs = Array.from(this.modules.values()).map(m => ({
      name: m.definition.function.name,
      description: m.definition.function.description,
      parameters: m.definition.function.parameters,
      handler: (async (args: Record<string, unknown>) => '') as ToolHandler,
    }));
    return [...legacy, ...modDefs];
  }

  getDefinitions(options?: { filterWriteTools?: boolean }): ToolFunctionDefinition[] {
    // Return unique definitions by function name
    const seen = new Set<string>();
    let defs: ToolFunctionDefinition[] = [];

    for (const mod of this.modules.values()) {
      const name = mod.definition.function.name;
      if (!seen.has(name)) {
        seen.add(name);
        defs.push(mod.definition);
      }
    }

    if (options?.filterWriteTools) {
      defs = defs.filter(d => !WRITE_TOOLS.has(d.function.name));
    }
    return defs;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    cwd: string,
    execOptions?: {
      confirmFn?: (target: string, context?: string | null, safety?: import('./types.js').SafetyResult) => Promise<boolean>;
      commandHistory?: { add(record: import('./types.js').CommandRecord): void };
      abortSignal?: AbortSignal;
    }
  ): Promise<string> {
    const canonicalName = ALIASES[name] || name;
    const mod = this.modules.get(canonicalName) || this.modules.get(name);
    if (mod) {
      return await mod.execute(args, cwd, execOptions);
    }

    const legacy = this.tools.get(name);
    if (legacy) {
      return await legacy.handler(args);
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  isValidTool(name: string): boolean {
    const canonicalName = ALIASES[name] || name;
    return this.modules.has(canonicalName) || this.modules.has(name) || this.tools.has(name);
  }

  isWriteTool(name: string): boolean {
    const canonicalName = ALIASES[name] || name;
    return WRITE_TOOLS.has(canonicalName) || WRITE_TOOLS.has(name);
  }

  getToolNames(): string[] {
    const modNames = Array.from(this.modules.keys());
    const legacyNames = Array.from(this.tools.keys());
    return [...new Set([...modNames, ...legacyNames])];
  }

  getTool(name: string): ToolModule | undefined {
    const canonicalName = ALIASES[name] || name;
    return this.modules.get(canonicalName) || this.modules.get(name);
  }
}
