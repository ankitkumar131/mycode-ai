/**
 * Tool Registry
 * Central registry that manages all tools, their definitions, and execution.
 */

import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { listDirTool } from './list-dir.js';
import { searchFilesTool } from './search-files.js';
import { execCommandTool } from './exec-command.js';
import { gitStatusTool } from './git-status.js';
import logger from '../utils/logger.js';

/**
 * All registered tools.
 */
const ALL_TOOLS = {
  readFile: readFileTool,
  writeFile: writeFileTool,
  editFile: editFileTool,
  listDirectory: listDirTool,
  searchFiles: searchFilesTool,
  executeCommand: execCommandTool,
  gitStatus: gitStatusTool,
};

/**
 * Tools that only require read permission.
 */
const READ_ONLY_TOOLS = ['readFile', 'listDirectory', 'searchFiles', 'gitStatus'];

/**
 * Tools that require write permission.
 */
const WRITE_TOOLS = ['writeFile', 'editFile', 'executeCommand'];

/**
 * Get tool definitions in OpenAI function-calling format.
 * @param {object} options - { includeWrite: bool }
 * @returns {Array} Tool definitions for the API call
 */
export function getToolDefinitions(options = {}) {
  const includeWrite = options.includeWrite !== false;

  return Object.entries(ALL_TOOLS)
    .filter(([name]) => {
      if (!includeWrite && WRITE_TOOLS.includes(name)) return false;
      return true;
    })
    .map(([, tool]) => tool.definition);
}

/**
 * Execute a tool by name.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments (parsed JSON)
 * @param {string} cwd - Current working directory
 * @param {object} options - { confirmFn for write operations }
 * @returns {Promise<string>} Tool execution result
 */
export async function executeTool(name, args, cwd, options = {}) {
  const tool = ALL_TOOLS[name];

  if (!tool) {
    return `Error: Unknown tool "${name}". Available tools: ${Object.keys(ALL_TOOLS).join(', ')}`;
  }

  logger.tool(name, JSON.stringify(args).slice(0, 100));

  try {
    // Some tools are sync, some async — handle both
    const result = await Promise.resolve(tool.execute(args, cwd, options));
    return result;
  } catch (err) {
    return `Error executing tool "${name}": ${err.message}`;
  }
}

/**
 * Check if a tool name is valid.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidTool(name) {
  return name in ALL_TOOLS;
}

/**
 * Check if a tool requires write permission.
 * @param {string} name
 * @returns {boolean}
 */
export function isWriteTool(name) {
  return WRITE_TOOLS.includes(name);
}

/**
 * Get a list of all tool names.
 * @returns {string[]}
 */
export function getToolNames() {
  return Object.keys(ALL_TOOLS);
}
