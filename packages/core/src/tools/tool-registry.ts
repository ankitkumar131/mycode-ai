import type { ToolModule, ToolFunctionDefinition } from './types.js';
import { readFileTool } from './definitions/read-file.js';
import { writeFileTool } from './definitions/write-file.js';
import { editFileTool } from './definitions/edit-file.js';
import { listDirTool } from './definitions/list-dir.js';
import { searchFilesTool } from './definitions/search-files.js';
import { gitStatusTool } from './definitions/git-status.js';
import { execCommandTool } from './definitions/exec-command.js';
import type { ToolDefinition, ToolHandler } from './types.js';

const ALL_TOOLS: ToolModule[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchFilesTool,
  gitStatusTool,
  execCommandTool,
];

const WRITE_TOOLS = new Set(['write-file', 'edit-file']);

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private modules: Map<string, ToolModule> = new Map();

  constructor() {
    for (const mod of ALL_TOOLS) {
      const name = mod.definition.function.name;
      this.modules.set(name, mod);
    }
  }

  register(name: string, definition: ToolDefinition): void {
    this.tools.set(name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name) ?? this.modules.get(name) as unknown as ToolDefinition | undefined;
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
    let defs = Array.from(this.modules.values()).map(m => m.definition);
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
    const mod = this.modules.get(name);
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
    return this.modules.has(name) || this.tools.has(name);
  }

  isWriteTool(name: string): boolean {
    return WRITE_TOOLS.has(name);
  }

  getToolNames(): string[] {
    const modNames = Array.from(this.modules.keys());
    const legacyNames = Array.from(this.tools.keys());
    return [...new Set([...modNames, ...legacyNames])];
  }

  getTool(name: string): ToolModule | undefined {
    return this.modules.get(name);
  }
}
