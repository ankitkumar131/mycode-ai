import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mycode/core', () => {
  const mockRun = vi.fn().mockResolvedValue('Mock response');
  const MockSession = vi.fn().mockImplementation(() => ({
    run: mockRun,
  }));
  return {
    ConfigManager: vi.fn().mockImplementation(() => ({
      configExists: () => true,
      load: () => Promise.resolve({ providers: [{ name: 'test', apiKey: 'sk-test' }] }),
      get: () => ({ providers: [] }),
    })),
    AgentSession: MockSession,
    ProviderRouter: vi.fn().mockImplementation(() => ({
      getCurrentProvider: () => ({ name: 'test', model: 'gpt-4o' }),
    })),
  };
});

vi.mock('readline', () => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  const mockResume = vi.fn();
  const mockPause = vi.fn();
  const listeners: Record<string, Function[]> = {};

  const rl = {
    question: mockQuestion,
    close: vi.fn(() => {
      listeners['close']?.forEach(fn => fn());
    }),
    resume: mockResume,
    pause: mockPause,
    prompt: vi.fn(),
    on: vi.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      if (event === 'line') {
        setTimeout(() => {
          fn('/exit');
        }, 10);
      }
    }),
    once: vi.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    }),
  };

  return {
    createInterface: vi.fn(() => rl),
    default: {
      createInterface: vi.fn(() => rl),
    },
  };
});

import { chatCommand } from '../chat.js';

describe('chatCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits on /exit command', async () => {
    await chatCommand();
    const { createInterface } = await import('readline');
    expect(createInterface).toHaveBeenCalled();
  });

  it('requires providers to be configured', async () => {
    const { ConfigManager } = await import('@mycode/core');
    (ConfigManager as any).mockImplementationOnce(() => ({
      configExists: () => false,
      load: () => Promise.resolve({ providers: [] }),
      get: () => ({ providers: [] }),
    }));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await chatCommand();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No providers'));
    logSpy.mockRestore();
  });
});
