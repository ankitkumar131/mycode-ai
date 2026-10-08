import {
  AgentSession,
  ConfigManager,
  FailoverCoordinator,
  ProviderRouter,
  SubAgentRunner,
  ToolRegistry,
  renderSubAgentResult,
  sessionStore,
  skillManager,
  type ProviderConfig,
} from '@mycode/core';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AgentConfig,
  AgentEvents,
  AgentInfo,
  ProviderRegistration,
  RunOptions,
  ToolRegistration,
} from './types.js';
import { discoverSkills } from './skills.js';

/** Package version, from the build stamp or the package manifest next to this file. */
function sdkVersion(): string {
  const injected = process.env.MYCODE_VERSION;
  if (injected) return injected;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    /* running from a bundle without the manifest — fall through */
  }
  return '0.0.0-unknown';
}

const DEFAULT_MAX_ITERATIONS = 25;
/** Cap for sub-agent context. Mirrors the CLI: keep a child cheap. */
const SUB_AGENT_WINDOW_CAP = 128_000;

export class MyCodeAgent {
  private session: AgentSession | null = null;
  private router: ProviderRouter | null = null;
  private registry: ToolRegistry | null = null;
  private failover: FailoverCoordinator | null = null;
  private config: AgentConfig;
  private startTime = Date.now();
  private customTools: ToolRegistration[] = [];
  private skillDirs: string[] = [];
  /** Events for the run in flight; the session callbacks read this lazily. */
  private activeEvents: AgentEvents | undefined;

  constructor(config: AgentConfig = {}) {
    this.config = config;
  }

  // ─── Extension points ───────────────────────────────────────────────────

  /**
   * Contribute a tool. Registered into the session's registry, so the model can
   * call it exactly like a built-in one.
   */
  registerTool(tool: ToolRegistration): this {
    const i = this.customTools.findIndex((t) => t.name === tool.name);
    if (i >= 0) this.customTools[i] = tool;
    else this.customTools.push(tool);
    if (this.registry) this.registry.register(tool.name, this.toDefinition(tool));
    return this;
  }

  /**
   * Contribute a provider backend. Any config whose `apiProvider` matches `id`
   * will use it — see `ProviderRouter.registerProviderFactory`.
   */
  registerProvider(registration: ProviderRegistration): this {
    ProviderRouter.registerProviderFactory(registration.id, (config) =>
      registration.create(config),
    );
    return this;
  }

  /**
   * Discover skills in `dir` (default `<cwd>/skills`) and hand them to the
   * agent. They appear in the system prompt's skill index and are readable with
   * the `skill_view` tool. Returns how many were found.
   */
  async loadSkills(dir?: string): Promise<number> {
    const target = dir ?? join(this.config.cwd ?? process.cwd(), 'skills');
    if (!existsSync(target)) return 0;

    const found = await discoverSkills(target);
    if (found.length === 0) return 0;

    this.config.skills = [...(this.config.skills ?? []), ...found];
    this.skillDirs = [...new Set([...this.skillDirs, target])];
    this.applySkillDirs();
    return found.length;
  }

  /** Read a discovered skill's SKILL.md body. */
  async readSkill(nameOrPath: string): Promise<string | null> {
    const match = (this.config.skills ?? []).find(
      (s) => s.name === nameOrPath || s.path === nameOrPath,
    );
    const dir = match?.path ?? nameOrPath;
    if (!existsSync(join(dir, 'SKILL.md'))) return null;
    return readFile(join(dir, 'SKILL.md'), 'utf-8');
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /** Load provider settings from a JSON file, or from `~/.mycode/settings.json`. */
  async loadConfig(path?: string): Promise<void> {
    if (path && existsSync(path)) {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as AgentConfig;
      this.config = { ...this.config, ...parsed };
      return;
    }
    const cm = new ConfigManager();
    if (cm.configExists()) {
      const cfg = await cm.load();
      this.config.providers = cfg.providers;
    }
  }

  /** Names of the configured providers, in failover order. */
  listProviders(): string[] {
    return (this.config.providers ?? []).map((p) => p.name);
  }

  // ─── Running ────────────────────────────────────────────────────────────

  async run(input: string, options: RunOptions = {}): Promise<string> {
    const session = await this.ensureSession();
    if (options.maxIterations !== undefined) session.setMaxIterations(options.maxIterations);
    this.activeEvents = options.events;

    const onAbort = () => session.abort();
    const signal = options.signal;
    if (signal) {
      if (signal.aborted) {
        this.activeEvents?.onError?.(new Error('Run was aborted before it started.'));
        return 'Interrupted.';
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const result = await session.run(input);
      this.activeEvents?.onFinish?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.activeEvents?.onError?.(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Stop the run in flight. */
  abort(): void {
    this.session?.abort();
  }

  /** Forget the conversation: the next `run()` starts a fresh session. */
  newSession(): void {
    this.session = null;
    this.failover = null;
  }

  /** The live session, for hosts that need registry or usage access. */
  getSession(): AgentSession | null {
    return this.session;
  }

  getInfo(): AgentInfo {
    const registry = this.registry ?? this.buildRegistry();
    const active = this.router?.getCurrentProvider();
    return {
      version: sdkVersion(),
      model: active?.model ?? this.config.model ?? 'default',
      provider:
        active?.name ?? (typeof this.config.provider === 'string' ? this.config.provider : 'auto'),
      tools: registry.getDefinitions().length,
      skills: this.config.skills?.length ?? 0,
      uptime: Date.now() - this.startTime,
      sessionId: this.session?.id ?? null,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private toDefinition(tool: ToolRegistration) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      handler: async (args: Record<string, unknown>) => {
        const out = await tool.handler(args);
        return typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      },
    };
  }

  private buildRegistry(): ToolRegistry {
    const registry = new ToolRegistry(
      this.config.toolsets?.length ? { toolsets: this.config.toolsets } : {},
    );
    if (this.config.tools === false) {
      for (const name of registry.getToolNames()) registry.disable(name);
    }
    for (const tool of this.customTools) registry.register(tool.name, this.toDefinition(tool));
    return registry;
  }

  private applySkillDirs(): void {
    // The skills tools and the prompt's skill index both read the shared
    // manager, so pointing it at the discovered directories is what makes
    // loadSkills() actually apply.
    const containers = new Set<string>(this.skillDirs);
    for (const s of this.config.skills ?? []) containers.add(dirname(s.path));
    if (containers.size > 0) skillManager.configure({ externalDirs: [...containers] });
  }

  private async ensureSession(): Promise<AgentSession> {
    if (this.session) return this.session;

    const cwd = this.config.cwd ?? process.cwd();
    const providers = this.resolveProviders();
    this.router = new ProviderRouter(providers);
    this.registry = this.buildRegistry();
    this.applySkillDirs();

    // The coordinator is built before the session (each needs the other), so the
    // checkpoint callback reaches the session through this holder.
    const sessionHolder: { current?: AgentSession } = {};

    const failover = new FailoverCoordinator({
      providers,
      onAnnounce: (event) => this.activeEvents?.onFailover?.(event),
      onCheckpoint: () => {
        const sessionRef = sessionHolder.current;
        if (!this.config.persistSessions || !sessionRef) return;
        try {
          const json = sessionRef.toJSON();
          sessionStore.save({
            id: json.id,
            title: json.title ?? null,
            cwd: json.cwd ?? cwd,
            createdAt: json.createdAt,
            updatedAt: new Date().toISOString(),
            model: this.router?.getCurrentProvider()?.model,
            usage: json.usage as Record<string, number> | undefined,
            messages: json.messages,
          });
        } catch {
          /* a failed checkpoint must never abort the task */
        }
      },
    });
    failover.prime(this.router.getCurrentProvider()?.name ?? 'unknown');
    this.failover = failover;

    const session = new AgentSession({
      providerRouter: this.router,
      cwd,
      toolRegistry: this.registry,
      maxIterations: this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      failover,
      verify: { enabled: this.config.verify !== false, formatter: true, diagnostics: true },
      extraSystemSections: this.config.systemPrompt ? [this.config.systemPrompt] : undefined,
      confirmFn: async (target, context, safety) => {
        // Fail closed: with no approval channel, nothing writes.
        if (this.config.confirm) {
          return await this.config.confirm({ target, context, safety: safety ?? null });
        }
        return this.config.autoApprove === true;
      },
      askUserFn: this.config.askUser,
      delegateFn: async (req) => {
        const runner = new SubAgentRunner({
          kind: req.kind,
          task: req.task,
          cwd,
          router: this.router!,
          contextWindow: Math.min(failover.safeWindow, SUB_AGENT_WINDOW_CAP),
        });
        return renderSubAgentResult(await runner.run());
      },
      // Failover announcements are per run, so read the events of the run in
      // flight rather than closing over the first caller's object.
      onText: (text) => this.activeEvents?.onText?.(text),
      onReasoning: (text) => this.activeEvents?.onReasoning?.(text),
      onToolCall: (name, args) => this.activeEvents?.onToolCall?.({ name, args }),
      onToolResult: (name, result) => this.activeEvents?.onToolResult?.({ toolName: name, result }),
      onError: (message) => this.activeEvents?.onError?.(new Error(message)),
      onFinish: (usage) => this.activeEvents?.onUsage?.(usage),
      onCompress: (info) => this.activeEvents?.onCompress?.(info),
    });

    sessionHolder.current = session;
    this.session = session;
    return session;
  }

  private resolveProviders(): ProviderConfig[] {
    if (this.config.providers && this.config.providers.length > 0) {
      return this.config.providers;
    }
    if (this.config.provider && typeof this.config.provider === 'object') {
      return [this.config.provider as ProviderConfig];
    }
    const providerName =
      typeof this.config.provider === 'string'
        ? this.config.provider
        : process.env.MYCODE_PROVIDER || 'openai';
    const apiKey =
      process.env.MYCODE_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';
    return [
      {
        name: providerName,
        apiProvider: providerName,
        model: this.config.model || process.env.MYCODE_MODEL || 'gpt-4o',
        apiKey,
      },
    ];
  }
}
