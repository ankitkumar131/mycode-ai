/**
 * MCP → tool registry bridge.
 *
 * `mcpManager` could connect to servers and list their tools, but nothing ever
 * registered those tools with the agent, so a configured MCP server was visible
 * in `/mcp` and unusable everywhere else. This exposes them as first-class tools.
 *
 * Two deliberate choices:
 *
 *   1. NAMESPACING. Tools are exposed as `server__tool`. Two servers can both
 *      define `search`; without a prefix the second silently shadows the first.
 *
 *   2. LAZY SCHEMAS. `tools/list` requires a live round-trip. Bridging is a
 *      best-effort enhancement, so a server that fails to answer contributes no
 *      tools and the rest of the agent keeps working.
 */

import type { ToolModule, ToolFunctionDefinition } from '../tools/types.js';
import type { MCPClientManager } from './mcp-client.js';
import type { MCPToolInfo } from './types.js';

/** Turn one MCP tool into a registry-compatible module. */
export function mcpToolToModule(
  manager: MCPClientManager,
  tool: MCPToolInfo & { qualifiedName: string }
): ToolModule {
  const definition: ToolFunctionDefinition = {
    type: 'function',
    function: {
      name: tool.qualifiedName,
      description:
        (tool.description || `Tool "${tool.name}" from the MCP server "${tool.serverName}".`) +
        ` (provided by MCP server: ${tool.serverName})`,
      parameters: (tool.parameters as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    },
  };

  return {
    definition,
    // MCP calls are I/O bound and have side effects we cannot classify, so they
    // are treated as writes: serialised, and never run in a parallel burst.
    execute: async (args: Record<string, unknown>) => {
      try {
        return await manager.call(tool.qualifiedName, args);
      } catch (err) {
        return `MCP tool "${tool.qualifiedName}" failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * Connect enabled servers and register their tools. Returns a summary for the
 * caller to display. Never throws: a broken MCP server must not prevent the CLI
 * from starting.
 */
export async function registerMCPTools(
  manager: MCPClientManager,
  registry: { registerModule(mod: ToolModule): void }
): Promise<{ servers: number; tools: number; failed: string[] }> {
  const failed: string[] = [];

  let servers = 0;
  try {
    const statuses = await manager.connectAll();
    for (const s of statuses) {
      if (s.connected) servers++;
      else if (s.error && s.error !== 'disabled') failed.push(`${s.name}: ${s.error}`);
    }
  } catch (err) {
    failed.push(err instanceof Error ? err.message : String(err));
    return { servers: 0, tools: 0, failed };
  }

  let tools = 0;
  try {
    for (const tool of await manager.allTools()) {
      if (!tool.qualifiedName.endsWith('__') && /^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(tool.qualifiedName)) {
        registry.registerModule(mcpToolToModule(manager, tool));
        tools++;
      }
    }
  } catch {
    /* partial registration is better than none */
  }

  return { servers, tools, failed };
}
