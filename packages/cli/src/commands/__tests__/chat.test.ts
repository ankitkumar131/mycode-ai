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
    ProviderRouter: vi.fn(),
  };
});

vi.mock('readline/promises', () => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  const mockResume = vi.fn();
  const mockPause = vi.fn();

  const rl = {
    question: mockQuestion,
    close: mockClose,
    resume: mockResume,
    pause: mockPause,
  };

  return {
    createInterface: vi.fn(() => rl),
  };
});

import { chatCommand } from '../chat.js';
import * as readline from 'readline/promises';

describe('chatCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const rl = (readline as any).createInterface();
    rl.question
      .mockResolvedValueOnce('/exit');
  });

  it('exits on /exit command', async () => {
    await chatCommand();
    expect(readline.createInterface).toHaveBeenCalled();
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
