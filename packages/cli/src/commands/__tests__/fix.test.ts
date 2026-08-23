import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockRun = vi.fn();
vi.mock('@mycode/core', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    configExists: () => true,
    load: () => Promise.resolve({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
    get: () => ({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
  })),
  AgentSession: vi.fn().mockImplementation(() => ({ run: mockRun })),
  ProviderRouter: vi.fn(),
}));

const { fixCommand } = await import('../fix.js');

describe('fixCommand', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue('```\nconst y = 2;\n```');
    tempDir = mkdtempSync(join(tmpdir(), 'mycode-fix-test-'));
    testFile = join(tempDir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows usage when no args given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await fixCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    logSpy.mockRestore();
  });

  it('runs fix with file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await fixCommand(testFile);
    expect(mockRun).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Analyzing'));
    logSpy.mockRestore();
  });

  it('treats missing file path as error text', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await fixCommand('/nonexistent/file.ts');
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('/nonexistent/file.ts'));
    logSpy.mockRestore();
  });

  it('renders agent output directly', async () => {
    mockRun.mockResolvedValue('Diagnosis: fix this');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await fixCommand(testFile);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Diagnosis'));
    logSpy.mockRestore();
  });
});
