import { mkdtempSync, writeFileSync, rmSync } from 'fs';
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

const { ConfigManager } = await import('./config-manager.js');

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mycode-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('ConfigManager', () => {
  it('returns default config for new instance', () => {
    const cm = new ConfigManager();
    const config = cm.get();
    expect(config.version).toBe('1');
    expect(config.providers).toEqual([]);
    expect(config.preferences.confirmWrites).toBe(true);
  });

  it('configExists returns false when no file', () => {
    const cm = new ConfigManager();
    expect(cm.configExists()).toBe(false);
  });

  it('saves and loads config', async () => {
    const cm = new ConfigManager();
    const saved = {
      version: '1',
      providers: [{ name: 'test', apiProvider: 'openai' as const, apiKey: 'sk-xxx', model: 'gpt-4' }],
      preferences: { confirmWrites: false, confirmCommands: true },
    };
    await cm.save(saved);
    const loaded = await cm.load();
    expect(loaded.providers).toHaveLength(1);
    expect(loaded.providers[0].name).toBe('test');
    expect(loaded.preferences.confirmWrites).toBe(false);
  });

  it('configExists returns true after save', async () => {
    const cm = new ConfigManager();
    await cm.save({ version: '1', providers: [], preferences: { confirmWrites: true, confirmCommands: true } });
    expect(cm.configExists()).toBe(true);
  });

  it('addProvider appends to provider list', async () => {
    const cm = new ConfigManager();
    await cm.addProvider({ name: 'p1', apiProvider: 'openai', apiKey: 'k1', model: 'gpt-4' });
    const cfg = await cm.load();
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0].name).toBe('p1');
  });

  it('removeProvider removes by name (case-insensitive)', async () => {
    const cm = new ConfigManager();
    await cm.addProvider({ name: 'TestProvider', apiProvider: 'openai', apiKey: 'k1', model: 'gpt-4' });
    const removed = await cm.removeProvider('testprovider');
    expect(removed).toBe(true);
    const cfg = await cm.load();
    expect(cfg.providers).toHaveLength(0);
  });

  it('removeProvider returns false if not found', async () => {
    const cm = new ConfigManager();
    await cm.addProvider({ name: 'p1', apiProvider: 'openai', apiKey: 'k1', model: 'gpt-4' });
    const result = await cm.removeProvider('nonexistent');
    expect(result).toBe(false);
  });

  it('updatePreferences merges preferences', async () => {
    const cm = new ConfigManager();
    await cm.save({ version: '1', providers: [], preferences: { confirmWrites: true, confirmCommands: false } });
    await cm.updatePreferences({ confirmWrites: false, maxContextFiles: 50 });
    const cfg = await cm.load();
    expect(cfg.preferences.confirmWrites).toBe(false);
    expect(cfg.preferences.confirmCommands).toBe(false);
    expect(cfg.preferences.maxContextFiles).toBe(50);
  });

  it('getConfigPath returns correct path', () => {
    const cm = new ConfigManager();
    const p = cm.getConfigPath();
    expect(p).toContain('.mycode');
    expect(p).toContain('settings.json');
  });

  it('handles corrupt JSON gracefully', async () => {
    const cm = new ConfigManager();
    await cm.save({ version: '1', providers: [], preferences: { confirmWrites: true, confirmCommands: true } });
    writeFileSync(cm.getConfigPath(), '{invalid json}', 'utf-8');
    const config = await cm.load();
    expect(config.version).toBe('1');
    expect(config.providers).toEqual([]);
  });
});
