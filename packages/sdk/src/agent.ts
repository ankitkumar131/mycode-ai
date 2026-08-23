import {
  AgentSession,
  ConfigManager,
  ProviderRouter,
  ToolRegistry,
  type ProviderConfig,
} from '@mycode/core';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, RunOptions, AgentInfo } from './types.js';
import { discoverSkills } from './skills.js';

export class MyCodeAgent {
  private session: AgentSession | null = null;
  private router: ProviderRouter | null = null;
  private config: AgentConfig;
  private startTime = Date.now();

  constructor(config: AgentConfig = {}) {
    this.config = config;
  }

  async run(input: string, options?: RunOptions): Promise<string> {
    const session = await this.ensureSession(options);
    return session.run(input);
  }

  async loadConfig(path?: string): Promise<void> {
    const cm = new ConfigManager();
    if (path && existsSync(path)) {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      this.config = { ...this.config, ...parsed };
    } else if (cm.configExists()) {
      const cfg = await cm.load();
      this.config.providers = cfg.providers;
    }
  }

  async loadSkills(skillDir?: string): Promise<void> {
    const dir = skillDir || join(process.cwd(), 'skills');
    if (!existsSync(dir)) return;

    const skills = await discoverSkills(dir);
    if (skills.length > 0) {
      this.config.skills = [...(this.config.skills || []), ...skills];
    }
  }

  getInfo(): AgentInfo {
    const registry = new ToolRegistry();
    return {
      version: '1.0.0-alpha',
      model: this.config.model || 'default',
      provider: typeof this.config.provider === 'string' ? this.config.provider : 'auto',
      tools: registry.getDefinitions().length,
      skills: this.config.skills?.length || 0,
      uptime: Date.now() - this.startTime,
    };
  }

  private async ensureSession(options?: RunOptions): Promise<AgentSession> {
    const ev = options?.events;
    const cwd = this.config.cwd || process.cwd();
    const providers = this.resolveProviders();
    this.router = new ProviderRouter(providers);

    const session = new AgentSession({
      providerRouter: this.router,
      cwd,
      maxIterations: options?.maxIterations ?? this.config.maxIterations ?? 25,
      onText(text) { ev?.onText?.(text); },
      onToolCall(name, args) { ev?.onToolCall?.({ name, args }); },
      onToolResult(name, result) { ev?.onToolResult?.({ toolName: name, result }); },
      onError(message) { ev?.onError?.(new Error(message)); },
    });

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
    const providerName = typeof this.config.provider === 'string'
      ? this.config.provider
      : process.env.MYCODE_PROVIDER || 'openai';
    const apiKey = process.env.MYCODE_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    return [{
      name: providerName,
      apiProvider: providerName,
      model: this.config.model || process.env.MYCODE_MODEL || 'gpt-4o',
      apiKey,
    }];
  }
}
