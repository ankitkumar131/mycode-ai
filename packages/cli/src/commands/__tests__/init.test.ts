import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => tempDir,
  };
});

const { ConfigManager, adjustProviderPriorities } = await import('@mycode/core');

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mycode-init-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('init command priority handling', () => {
  it('cascades priority shifts when priority collisions occur', async () => {
    const cm = new ConfigManager();
    await cm.addProvider({
      priority: 1,
      name: 'provider-1',
      apiProvider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-1',
      baseUrl: 'https://api.openai.com/v1',
      read: true,
      write: true,
      maxRetries: 3,
    });

    await cm.addProvider({
      priority: 2,
      name: 'provider-2',
      apiProvider: 'openrouter',
      model: 'claude-3-5-sonnet',
      apiKey: 'sk-2',
      baseUrl: 'https://openrouter.ai/api/v1',
      read: true,
      write: true,
      maxRetries: 3,
    });

    // Add a new provider with priority 1 (collides with provider-1)
    await cm.addProvider({
      priority: 1,
      name: 'provider-new',
      apiProvider: 'ollama',
      model: 'llama3.1:8b',
      baseUrl: 'http://localhost:11434',
      read: true,
      write: false,
      maxRetries: 3,
    });

    const cfg = await cm.load();
    expect(cfg.providers).toHaveLength(3);

    // provider-new should be priority 1
    expect(cfg.providers[0].name).toBe('provider-new');
    expect(cfg.providers[0].priority).toBe(1);

    // provider-1 should automatically shift to priority 2
    expect(cfg.providers[1].name).toBe('provider-1');
    expect(cfg.providers[1].priority).toBe(2);

    // provider-2 should automatically shift to priority 3
    expect(cfg.providers[2].name).toBe('provider-2');
    expect(cfg.providers[2].priority).toBe(3);
  });

  it('adjustProviderPriorities handles arbitrary priority shifts', () => {
    const providers = [
      { name: 'p1', priority: 1 },
      { name: 'p2', priority: 2 },
      { name: 'p3', priority: 3 },
    ];

    // Change p3 priority to 1
    providers[2].priority = 1;
    adjustProviderPriorities(providers, 2);

    expect(providers[0].name).toBe('p3');
    expect(providers[0].priority).toBe(1);

    expect(providers[1].name).toBe('p1');
    expect(providers[1].priority).toBe(2);

    expect(providers[2].name).toBe('p2');
    expect(providers[2].priority).toBe(3);
  });
});
