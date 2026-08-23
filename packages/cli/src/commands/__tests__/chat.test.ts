import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mycode/core', () => {
  const mockRun = vi.fn().mockResolvedValue('Mock response');
  const MockSession = vi.fn().mockImplementation(() => ({
    run: mockRun,
    getContext: () => ({}),
    getState: () => ({ messageCount: 0, iterations: 0 }),
    abort: vi.fn(),
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
    executeCommand: vi.fn().mockResolvedValue({ output: '', exitCode: 0 }),
  };
});

vi.mock('../../ui/text-area.js', () => {
  const TextArea = vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue({ kind: 'exit' }),
    setBusy: vi.fn(),
    close: vi.fn(),
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
      close: vi.fn(),
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await chatCommand();
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls.flat().join('\n').toLowerCase()).toContain('mycode commands');
    logSpy.mockRestore();
  });

  it('exits on the /exit slash command', async () => {
    const { TextArea } = await import('../../ui/text-area.js');
    const readMock = vi.fn().mockResolvedValueOnce({ kind: 'slash', name: '/exit' });
    (TextArea as any).mockImplementation(() => ({
      read: readMock,
      setBusy: vi.fn(),
      close: vi.fn(),
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
