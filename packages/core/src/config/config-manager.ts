import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MyCodeConfig } from './types.js';
import type { ProviderConfig } from '../routing/types.js';
import {
  DEFAULT_PONYTAIL_SETTINGS,
  normalizePonytailMode,
} from '../policy/ponytail.js';

const SNAKE_TO_CAMEL = new Map<string, string>([
  ['api_key', 'apiKey'],
  ['api_provider', 'apiProvider'],
  ['base_url', 'baseUrl'],
  ['max_retries', 'maxRetries'],
]);

export function adjustProviderPriorities<T extends { priority?: number }>(
  providers: T[],
  targetIndex: number
): T[] {
  if (targetIndex < 0 || targetIndex >= providers.length) {
    return providers;
  }

  const targetPriority = providers[targetIndex].priority ?? 1;

  for (let i = 0; i < providers.length; i++) {
    if (i !== targetIndex) {
      const currentP = providers[i].priority ?? 1;
      if (currentP >= targetPriority) {
        providers[i].priority = currentP + 1;
      }
    }
  }

  providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  providers.forEach((p, idx) => {
    p.priority = idx + 1;
  });

  return providers;
}

function normalizeProvider(p: Record<string, unknown>): ProviderConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    out[SNAKE_TO_CAMEL.get(key) ?? key] = value;
  }
  if (out.read === undefined) out.read = true;
  if (out.write === undefined) out.write = true;
  if (out.maxRetries === undefined) out.maxRetries = 3;
  return out as unknown as ProviderConfig;
}

export class ConfigManager {
  private config: MyCodeConfig | null = null;

  private getConfigDir(): string {
    return join(homedir(), '.mycode');
  }

  private getConfigFile(): string {
    return join(this.getConfigDir(), 'settings.json');
  }

  private ensureDir(): void {
    const dir = this.getConfigDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const logsDir = join(dir, 'logs');
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
  }

  private getDefault(): MyCodeConfig {
    return {
      version: '1',
      providers: [],
      preferences: {
        theme: 'dark',
        confirmWrites: true,
        confirmCommands: true,
        maxContextFiles: 20,
        logConversations: true,
      },
      ponytail: { ...DEFAULT_PONYTAIL_SETTINGS },
      usage: { unlimited: true },
      orchestration: { enabled: true, maxParallelTasks: 2 },
      integrations: { browser: { enabled: false }, decision: { enabled: false }, sandbox: { enabled: false } },
    };
  }

  async load(): Promise<MyCodeConfig> {
    this.ensureDir();
    const configFile = this.getConfigFile();

    if (!existsSync(configFile)) {
      this.config = this.getDefault();
      return this.config;
    }

    try {
      const raw = readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const providers: ProviderConfig[] = (parsed.providers || []).map(normalizeProvider);

      const priorityCounts = new Map<number, number>();
      let hasDuplicates = false;
      for (const p of providers) {
        const pr = p.priority ?? 99;
        if (priorityCounts.has(pr)) {
          hasDuplicates = true;
          break;
        }
        priorityCounts.set(pr, 1);
      }

      if (hasDuplicates) {
        providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        providers.forEach((p, idx) => {
          p.priority = idx + 1;
        });
      }

      const defaults = this.getDefault();
      const rawPonytail = parsed.ponytail && typeof parsed.ponytail === 'object' ? parsed.ponytail : {};
      const rawUsage = parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {};
      const rawOrchestration = parsed.orchestration && typeof parsed.orchestration === 'object' ? parsed.orchestration : {};
      const rawIntegrations = parsed.integrations && typeof parsed.integrations === 'object' ? parsed.integrations : {};
      const rawBrowser = rawIntegrations.browser && typeof rawIntegrations.browser === 'object' ? rawIntegrations.browser : {};
      const rawDecision = rawIntegrations.decision && typeof rawIntegrations.decision === 'object' ? rawIntegrations.decision : {};
      const rawSandbox = rawIntegrations.sandbox && typeof rawIntegrations.sandbox === 'object' ? rawIntegrations.sandbox : {};
      this.config = {
        ...defaults,
        ...parsed,
        providers,
        preferences: {
          ...defaults.preferences,
          ...(parsed.preferences || {}),
        },
        ponytail: {
          ...defaults.ponytail,
          ...rawPonytail,
          mode: normalizePonytailMode(rawPonytail.mode),
          applyToAllTasks: rawPonytail.applyToAllTasks !== false,
        },
        usage: {
          ...defaults.usage,
          ...rawUsage,
          // Older settings files get the no-artificial-cap behavior on upgrade.
          unlimited: rawUsage.unlimited !== false,
        },
        orchestration: {
          ...defaults.orchestration,
          ...rawOrchestration,
          enabled: rawOrchestration.enabled !== false,
          maxParallelTasks: typeof rawOrchestration.maxParallelTasks === 'number'
            ? Math.max(1, Math.min(16, Math.floor(rawOrchestration.maxParallelTasks)))
            : defaults.orchestration?.maxParallelTasks,
        },
        integrations: {
          ...defaults.integrations,
          ...rawIntegrations,
          browser: {
            ...defaults.integrations?.browser,
            ...rawBrowser,
            enabled: rawBrowser.enabled !== false && typeof rawBrowser.command === 'string' && rawBrowser.command.length > 0,
          },
          decision: {
            ...defaults.integrations?.decision,
            ...rawDecision,
            enabled: rawDecision.enabled !== false && typeof rawDecision.command === 'string' && rawDecision.command.length > 0,
          },
          sandbox: {
            ...defaults.integrations?.sandbox,
            ...rawSandbox,
            enabled: rawSandbox.enabled !== false && typeof rawSandbox.command === 'string' && rawSandbox.command.length > 0,
          },
        },
      };
      return this.config as MyCodeConfig;
    } catch {
      this.config = this.getDefault();
      return this.config;
    }
  }

  get(): MyCodeConfig {
    if (!this.config) {
      this.config = this.getDefault();
    }
    return this.config;
  }

  async save(config: MyCodeConfig): Promise<void> {
    this.ensureDir();
    writeFileSync(this.getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
    this.config = config;
  }

  getConfigPath(): string {
    return this.getConfigFile();
  }

  getConfigDirPath(): string {
    return this.getConfigDir();
  }

  getLogsDir(): string {
    return join(this.getConfigDir(), 'logs');
  }

  async addProvider(provider: MyCodeConfig['providers'][0]): Promise<void> {
    const config = await this.load();
    config.providers.push(provider);
    adjustProviderPriorities(config.providers, config.providers.length - 1);
    await this.save(config);
  }

  async removeProvider(name: string): Promise<boolean> {
    const config = await this.load();
    const before = config.providers.length;
    config.providers = config.providers.filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
    if (config.providers.length < before) {
      config.providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      config.providers.forEach((p, idx) => {
        p.priority = idx + 1;
      });
      await this.save(config);
      return true;
    }
    return false;
  }

  async updatePreferences(prefs: Partial<MyCodeConfig['preferences']>): Promise<void> {
    const config = await this.load();
    config.preferences = { ...config.preferences, ...prefs };
    await this.save(config);
  }

  configExists(): boolean {
    return existsSync(this.getConfigFile());
  }
}
