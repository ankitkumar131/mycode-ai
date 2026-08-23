import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@mycode/core', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    configExists: () => true,
    load: () => Promise.resolve({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
    get: () => ({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
  })),
  AgentSession: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue('Explanation of the file.'),
  })),
  ProviderRouter: vi.fn(),
}));

const { explainCommand } = await import('../explain.js');

describe('explainCommand', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'mycode-explain-test-'));
    testFile = join(tempDir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows usage when no file is given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await explainCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    logSpy.mockRestore();
  });

  it('explains a file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await explainCommand(testFile);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Explanation'));
    logSpy.mockRestore();
  });

  it('handles missing file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await explainCommand('/nonexistent/file.ts');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot read'));
    logSpy.mockRestore();
  });
});
