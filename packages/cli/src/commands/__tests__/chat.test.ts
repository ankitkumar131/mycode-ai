import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mycode/core', () => {
  const mockRun = vi.fn().mockResolvedValue('Mock response');
  const MockSession = vi.fn().mockImplementation(() => ({
    run: mockRun,
    id: 'test-session',
    title: null,
    getContext: () => ({ getMessages: () => [], maxTokens: 128000 }),
    getState: () => ({ messageCount: 0, iterations: 0, estimatedTokens: 0, contextWindow: 128000, elapsedMs: 0, usage: {}, queued: 0 }),
    getRegistry: () => ({ disable: vi.fn(), getToolsets: () => [], getDefinitions: () => [] }),
    getUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, turns: 0, toolCalls: 0, compressions: 0 }),
    toJSON: () => ({ id: 'test-session', title: null, cwd: process.cwd(), createdAt: '', updatedAt: '', usage: {}, messages: [] }),
    load: vi.fn(),
    reset: vi.fn(),
    abort: vi.fn(),
    dequeuePrompt: () => undefined,
    queuedCount: 0,
  }));
  return {
    ConfigManager: vi.fn().mockImplementation(() => ({
      configExists: () => true,
      load: () =>
        Promise.resolve({
          providers: [{ name: 'test', apiKey: 'sk-test' }],
          preferences: { confirmCommands: true, confirmWrites: true },
        }),
      get: () => ({ providers: [], preferences: { confirmCommands: true, confirmWrites: true } }),
    })),
    AgentSession: MockSession,
    ProviderRouter: vi.fn().mockImplementation(() => ({
      getCurrentProvider: () => ({ name: 'test', model: 'gpt-4o' }),
    })),
    ProviderRouterStats: undefined,
    executeCommand: vi.fn().mockResolvedValue({ output: '', exitCode: 0 }),
    classifyCommand: vi.fn(() => ({ level: 'normal', reason: '' })),
    skillManager: {
      configure: vi.fn(),
      seedBundledSkills: vi.fn(() => []),
      list: vi.fn(() => []),
      find: vi.fn(() => undefined),
      getSkillsDir: () => '/tmp/skills',
    },
    sessionStore: { save: vi.fn(), load: vi.fn(() => null), latestFor: vi.fn(() => null), list: vi.fn(() => []), search: vi.fn(() => []), getDir: () => '/tmp/sessions' },
    processManager: { killAll: vi.fn().mockResolvedValue(0) },
    mcpManager: { listServers: () => [] },
    isDocumentFile: () => false,
    extractDocument: vi.fn(),
    renderDocument: vi.fn(),
    readMemoryFile: () => '',
    writeMemoryFile: vi.fn(),
    memoryPath: () => '/tmp/MEMORY.md',
    findContextFiles: () => [],
    TOOLSETS: {},
  };
});

vi.mock('../../ui/text-area.js', () => {
  const TextArea = vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue({ kind: 'exit' }),
    setBusy: vi.fn(),
    isBusy: () => false,
    setCommands: vi.fn(),
    close: vi.fn(),
    stashCount: 0,
  }));
  return { TextArea };
});

import { chatCommand } from '../chat.js';

describe('chatCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a text area and exits cleanly', async () => {
    const { TextArea } = await import('../../ui/text-area.js');
    await chatCommand();
    expect(TextArea).toHaveBeenCalledTimes(1);
  });

  it('runs a slash command selected from the inline menu', async () => {
    const { TextArea } = await import('../../ui/text-area.js');
    const readMock = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'slash', name: '/help' })
      .mockResolvedValueOnce({ kind: 'exit' });
    (TextArea as any).mockImplementation(() => ({
      read: readMock,
      setBusy: vi.fn(),
      isBusy: () => false,
      setCommands: vi.fn(),
      close: vi.fn(),
      stashCount: 0,
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await chatCommand();
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls.flat().join('\n').toLowerCase()).toContain('session');
    logSpy.mockRestore();
  });

  it('exits on the /exit slash command', async () => {
    const { TextArea } = await import('../../ui/text-area.js');
    const readMock = vi.fn().mockResolvedValueOnce({ kind: 'slash', name: '/exit' });
    (TextArea as any).mockImplementation(() => ({
      read: readMock,
      setBusy: vi.fn(),
      isBusy: () => false,
      setCommands: vi.fn(),
      close: vi.fn(),
      stashCount: 0,
    }));

    await chatCommand();
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('requires providers to be configured', async () => {
    const { ConfigManager } = await import('@mycode/core');
    (ConfigManager as any).mockImplementationOnce(() => ({
      configExists: () => false,
      load: () => Promise.resolve({ providers: [], preferences: {} }),
      get: () => ({ providers: [], preferences: {} }),
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await chatCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No providers'));
    logSpy.mockRestore();
  });
});
