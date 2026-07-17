import type { MyCodeConfig } from './types.js';

export class ConfigManager {
  private config: MyCodeConfig | null = null;

  async load(): Promise<MyCodeConfig> {
    return this.getDefault();
  }

  get(): MyCodeConfig {
    return this.config ?? this.getDefault();
  }

  async save(config: MyCodeConfig): Promise<void> {}

  getConfigPath(): string {
    return '';
  }

  private getDefault(): MyCodeConfig {
    return {
      version: '1',
      providers: [],
      preferences: {
        confirmWrites: true,
        confirmCommands: true,
      },
    };
  }
}
