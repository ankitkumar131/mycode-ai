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

const mockQuestion = vi.fn().mockResolvedValue('y');
vi.mock('readline/promises', () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  }),
}));

const { editCommand } = await import('../edit.js');

describe('editCommand', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue('```\nconst y = 2;\n```');
    tempDir = mkdtempSync(join(tmpdir(), 'mycode-edit-test-'));
    testFile = join(tempDir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows usage when no file given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await editCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    logSpy.mockRestore();
  });

  it('shows usage when no instruction given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await editCommand(testFile);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    logSpy.mockRestore();
  });

  it('edits a file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await editCommand(testFile, 'rename x to y');
    expect(mockRun).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Wrote'));
    logSpy.mockRestore();
  });

  it('handles missing file', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await editCommand('/nonexistent/file.ts', 'fix it');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot read'));
    logSpy.mockRestore();
  });

  it('shows raw response when no code block found', async () => {
    mockRun.mockResolvedValue('some random text');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await editCommand(testFile, 'fix it');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Could not extract'));
    logSpy.mockRestore();
  });
});
