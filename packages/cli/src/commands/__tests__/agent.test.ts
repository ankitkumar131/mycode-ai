import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockRun = vi.fn();
const mockSession = { run: mockRun };
vi.mock('@mycode/core', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    configExists: () => true,
    load: () => Promise.resolve({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
    get: () => ({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
  })),
  AgentSession: vi.fn().mockImplementation(() => mockSession),
  ProviderRouter: vi.fn(),
}));

const mockQuestion = vi.fn();
mockQuestion.mockResolvedValue('/exit');
vi.mock('readline/promises', () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

const { agentCommand } = await import('../agent.js');

describe('agentCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue('task result');
    mockQuestion.mockResolvedValue('/exit');
    tempDir = mkdtempSync(join(tmpdir(), 'mycode-agent-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs agent with a task string', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await agentCommand('explain this');
    expect(mockRun).toHaveBeenCalledWith('explain this');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Agent'));
    logSpy.mockRestore();
  });

  it('enters interactive mode when no task given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await agentCommand();
    expect(mockQuestion).toHaveBeenCalledWith(expect.stringContaining('agent>'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Agent Mode'));
    logSpy.mockRestore();
  });

  it('handles session errors', async () => {
    mockRun.mockRejectedValue(new Error('API error'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await agentCommand('do something');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Agent'));
    logSpy.mockRestore();
  });

  it('shows no providers message', async () => {
    const { ConfigManager } = await import('@mycode/core');
    (ConfigManager as any).mockImplementationOnce(() => ({
      configExists: () => true,
      load: () => Promise.resolve({ providers: [] }),
      get: () => ({ providers: [] }),
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await agentCommand('task');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No providers configured'));
    logSpy.mockRestore();
  });
});
