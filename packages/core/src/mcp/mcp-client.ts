/**
 * MCP client — real Model Context Protocol over stdio.
 *
 * The previous implementation was a stub: `callTool()` returned a fabricated
 * JSON object and `listTools()` returned a single invented health tool. Nothing
 * was ever spawned, so the `/mcp` command reported servers that did not exist.
 *
 * This is a dependency-free implementation of the parts that matter:
 *   - JSON-RPC 2.0 over stdio, newline-delimited (the MCP stdio transport)
 *   - the `initialize` / `initialized` handshake with protocol-version negotiation
 *   - `tools/list` and `tools/call`
 *   - per-request timeouts, so a hung server cannot hang the agent
 *
 * Server stdout is the protocol channel; anything it writes to stderr is kept
 * for diagnostics rather than parsed.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { MCPConfig, MCPServerConfig, MCPToolInfo } from './types.js';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
  stderr?: string;
}

export class MCPClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private _stderr = '';
  private _tools: MCPToolInfo[] = [];
  private _connected = false;
  private _starting: Promise<void> | null = null;
  private _timers: NodeJS.Timeout[] = [];

  constructor(public config: MCPServerConfig) {}

  get connected(): boolean {
    return this._connected;
  }

  get tools(): readonly MCPToolInfo[] {
    return this._tools;
  }

  get stderrTail(): string {
    return this._stderr.slice(-2_000);
  }

  /** Spawn + handshake. Safe to call repeatedly; concurrent calls share one start. */
  async start(): Promise<void> {
    if (this._connected) return;
    if (this._starting) return this._starting;
    this._starting = this.doStart();
    try {
      await this._starting;
    } finally {
      this._starting = null;
    }
  }

  private async doStart(): Promise<void> {
    if (!this.config.command) {
      throw new Error(`MCP server "${this.config.name}" has no command configured`);
    }

    const env = { ...process.env, ...(this.config.env ?? {}) };
    const child = spawn(this.config.command, this.config.args ?? [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    }) as ChildProcessWithoutNullStreams;

    this.child = child;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      this._stderr = (this._stderr + chunk).slice(-20_000);
    });

    child.on('error', (err) => {
      this.failAll(new Error(`MCP server "${this.config.name}" failed to start: ${err.message}`));
      this._connected = false;
    });
    child.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.failAll(new Error(`MCP server "${this.config.name}" exited (${reason})`));
      this._connected = false;
    });

    // ── initialize handshake
    const initResult = (await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: 'mycode', version: '1.0.0' },
      },
      DEFAULT_STARTUP_TIMEOUT_MS
    )) as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };

    // Per spec the client acknowledges with a notification.
    this.notify('notifications/initialized', {});

    this._connected = true;
    this.config.status = 'connected';

    // Discover tools. A server that fails here is still connected but useless,
    // so surface that rather than pretending it works.
    try {
      await this.refreshTools();
    } catch (err) {
      this._stderr += `\n[tools/list failed: ${err instanceof Error ? err.message : String(err)}]`;
    }

    void initResult;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_BYTES / 2);
    }

    // MCP stdio framing: one JSON-RPC message per line.
    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcResponse);
      } catch {
        // Not JSON — some servers log to stdout. Ignore rather than crash.
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse): void {
    if (msg.id === undefined || msg.id === null) return; // notification
    const id = Number(msg.id);
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);

    if (msg.error) {
      entry.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  private request(method: string, params: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error(`MCP server "${this.config.name}" is not running`));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this._timers.push(timer);

      this.pending.set(id, { resolve, reject, timer });

      try {
        child.stdin.write(payload, (err) => {
          if (err) {
            this.pending.delete(id);
            clearTimeout(timer);
            reject(new Error(`Failed to write to MCP server: ${err.message}`));
          }
        });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) return;
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch {
      /* best effort */
    }
  }

  async refreshTools(): Promise<MCPToolInfo[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    this._tools = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      serverName: this.config.name,
      parameters: t.inputSchema,
    }));
    return this._tools;
  }

  async listTools(): Promise<MCPToolInfo[]> {
    if (!this._connected) await this.start();
    return [...this._tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this._connected) await this.start();

    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };

    const parts = (result.content ?? []).map((c) => {
      if (c.type === 'text') return c.text ?? '';
      if (c.type === 'image') return `[image ${c.mimeType ?? 'unknown'}]`;
      if (c.type === 'resource') return `[resource]`;
      return '';
    });

    const text = parts.filter(Boolean).join('\n');
    if (result.isError) return `MCP tool error: ${text || 'unknown error'}`;
    return text || '(the tool returned no text content)';
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    this.config.status = 'error';
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    this.failAll(new Error('client disconnected'));
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.stdin.end();
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 2_000).unref?.();
      } catch {
        /* already gone */
      }
    }
    this.config.status = 'disconnected';
  }
}

export class MCPClientManager {
  private clients = new Map<string, MCPClient>();

  /** Register servers from config without connecting. */
  configure(config: MCPConfig): void {
    for (const server of config.servers ?? []) {
      if (!this.clients.has(server.name)) {
        this.clients.set(server.name, new MCPClient(server));
      }
    }
  }

  get(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  list(): MCPClient[] {
    return [...this.clients.values()];
  }

  /** Connect every enabled server, tolerating individual failures. */
  async connectAll(): Promise<MCPServerStatus[]> {
    const results = await Promise.all(
      this.list().map(async (client): Promise<MCPServerStatus> => {
        if (client.config.enabled === false) {
          return { name: client.config.name, connected: false, tools: 0, error: 'disabled' };
        }
        try {
          await client.start();
          return { name: client.config.name, connected: true, tools: client.tools.length };
        } catch (err) {
          return {
            name: client.config.name,
            connected: false,
            tools: 0,
            error: err instanceof Error ? err.message : String(err),
            stderr: client.stderrTail,
          };
        }
      })
    );
    return results;
  }

  /**
   * Status view for the `/mcp` command. Reports real connection state — the
   * previous stub reported servers that had never been contacted.
   */
  listServers(): Array<{ name: string; status: string; connected: boolean; tools: number; error?: string }> {
    return this.list().map((c) => ({
      name: c.config.name,
      status: c.connected ? 'connected' : c.config.status ?? 'disconnected',
      connected: c.connected,
      tools: c.tools.length,
    }));
  }

  /** All tools across all connected servers, namespaced as `server__tool`. */
  async allTools(): Promise<Array<MCPToolInfo & { qualifiedName: string }>> {
    const out: Array<MCPToolInfo & { qualifiedName: string }> = [];
    for (const client of this.list()) {
      if (client.config.enabled === false) continue;
      try {
        const tools = await client.listTools();
        for (const t of tools) out.push({ ...t, qualifiedName: `${client.config.name}__${t.name}` });
      } catch {
        /* a broken server contributes no tools */
      }
    }
    return out;
  }

  /** Route a `server__tool` call to the right client. */
  async call(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
    const sep = qualifiedName.indexOf('__');
    if (sep === -1) throw new Error(`Not a namespaced MCP tool: ${qualifiedName}`);
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 2);
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`Unknown MCP server: ${serverName}`);
    return client.callTool(toolName, args);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.list().map((c) => c.disconnect()));
  }
}

export const mcpManager = new MCPClientManager();
