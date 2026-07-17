import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MyCodeConfig } from './types.js';
import type { ProviderConfig } from '../routing/types.js';

const SNAKE_TO_CAMEL = new Map<string, string>([
  ['api_key', 'apiKey'],
  ['api_provider', 'apiProvider'],
  ['base_url', 'baseUrl'],
  ['max_retries', 'maxRetries'],
]);

function normalizeProvider(p: Record<string, unknown>): ProviderConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    out[SNAKE_TO_CAMEL.get(key) ?? key] = value;
  }
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
      this.config = {
        ...this.getDefault(),
        ...parsed,
        providers: (parsed.providers || []).map(normalizeProvider),
        preferences: {
          ...this.getDefault().preferences,
          ...(parsed.preferences || {}),
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
    await this.save(config);
  }

  async removeProvider(name: string): Promise<boolean> {
    const config = await this.load();
    const before = config.providers.length;
    config.providers = config.providers.filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
    if (config.providers.length < before) {
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
