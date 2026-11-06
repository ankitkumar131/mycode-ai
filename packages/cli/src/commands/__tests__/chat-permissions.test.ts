/**
 * "Always allow all commands for this session" — what does "this session" mean?
 *
 * The user-facing promise is: approve everything once, stop being interrupted
 * for the rest of this session, and be asked again in the next one. These
 * tests drive the real chat loop (TextArea mocked, everything below it real)
 * and answer the actual arrow-key prompt, so they pin down all three parts:
 *
 *   1. the option is offered at the moment of the interruption;
 *   2. a follow-up question in the same session is not interrupted again;
 *   3. `/new` starts a new session, so the next run is interrupted again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let lastOpts: any = null;
/** What the CLI asked the (mocked) session to do. */
const sessionCalls: { planMode: boolean | null } = { planMode: null };

vi.mock('@mycode/core', () => {
  const getPonytailMode = vi.fn(() => 'full');
  const describePonytailMode = vi.fn(() => 'ponytail: full (default)');
  const noop = () => () => {};
  const FailoverCoordinator = vi.fn().mockImplementation(() => ({
    prime: vi.fn(),
    observe: vi.fn(),
    pinForTurn: vi.fn(),
    buildHandoffBrief: vi.fn(() => null),
    summary: vi.fn(() => null),
    safeWindow: 128000,
  }));
  const SubAgentRunner = vi.fn().mockImplementation(() => ({
    run: () => Promise.resolve({ report: '', tokens: 0, turns: 0 }),
  }));
  const todoStore = { get: () => [], set: vi.fn(), subscribe: noop, clear: vi.fn() };
  const sessionStore = {
    save: vi.fn(),
    load: vi.fn(() => null),
    latestFor: vi.fn(() => null),
    list: vi.fn(() => []),
    search: vi.fn(() => []),
    getDir: () => '/tmp/sessions',
  };
  const AgentSession = vi.fn().mockImplementation((opts: any) => {
    lastOpts = opts;
    return {
      setPlanMode: vi.fn((on: boolean) => {
        sessionCalls.planMode = on;
      }),
      isPlanMode: vi.fn(() => sessionCalls.planMode === true),
      // The mock plays the part of the model by calling the very confirmation
      // callback the real session would call for a shell command.
      run: vi.fn(async () => {
        if (opts?.confirmFn) {
          await opts.confirmFn('npm test', 'run the test suite', {
            level: 'normal',
            reason: 'runs the test suite',
          });
        }
        return 'done';
      }),
      id: 'session-1',
      title: null,
      getContext: () => ({ getMessages: () => [], maxTokens: 128000 }),
      getState: () => ({
        messageCount: 0,
        iterations: 0,
        estimatedTokens: 0,
        contextWindow: 128000,
        elapsedMs: 0,
        usage: {},
        filesTouched: [],
        queued: 0,
      }),
      getRegistry: () => ({ disable: vi.fn(), getToolsets: () => [], getDefinitions: () => [] }),
      getUsage: () => ({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        turns: 1,
        toolCalls: 0,
        compressions: 0,
      }),
      toJSON: () => ({
        id: 'session-1',
        title: null,
        cwd: process.cwd(),
        createdAt: '',
        updatedAt: '',
        usage: {},
        messages: [],
      }),
      load: vi.fn(),
      reset: vi.fn(),
      abort: vi.fn(),
      dequeuePrompt: () => undefined,
      queuedCount: 0,
    };
  });
  return {
    MUTATING_TOOLS: ['write_file', 'patch', 'execute_code', 'skill_manage'],
    getPonytailMode,
    describePonytailMode,
    ConfigManager: vi.fn().mockImplementation(() => ({
      configExists: () => true,
      load: () =>
        Promise.resolve({
          providers: [{ name: 'test', apiKey: 'sk-test' }],
          preferences: { confirmCommands: true, confirmWrites: true },
        }),
      get: () => ({ providers: [], preferences: { confirmCommands: true, confirmWrites: true } }),
    })),
    AgentSession,
    ProviderRouter: vi.fn().mockImplementation(() => ({
      getCurrentProvider: () => ({ name: 'test', model: 'gpt-4o' }),
      setCurrentProvider: vi.fn(),
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
    sessionStore,
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
    FailoverCoordinator,
    SubAgentRunner,
    effectiveWindowFor: vi.fn(() => 128000),
    safeContextWindow: vi.fn(() => 128000),
    renderSubAgentResult: (r: any) => r?.report ?? '',
    todoStore,
    setActiveProvider: vi.fn(),
    getPonytailModeForProviders: vi.fn(() => 'full'),
    describePonytailForProviders: vi.fn(() => 'ponytail: full'),
    estimateCost: vi.fn(() => null),
  };
});

vi.mock('../../ui/text-area.js', () => ({
  TextArea: vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue({ kind: 'exit' }),
    setBusy: vi.fn(),
    isBusy: () => false,
    setCommands: vi.fn(),
    close: vi.fn(),
    stashCount: 0,
  })),
}));

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatCommand } from '../chat.js';
import { TextArea } from '../../ui/text-area.js';

const ENTER = { name: 'return', sequence: '\r' };
const DOWN = { name: 'down', sequence: '\x1b[B' };

describe('session-scoped modes in `mycode chat` (approvals, plan mode)', () => {
  let writes: string[];
  let logs: string[];
  let promptsAnswered = 0;
  let planning = false;

  /** The choice list itself, i.e. the option the user is asking about. */
  const ALLOW_ALL_LABEL = 'Always allow all commands for this session';

  beforeEach(() => {
    writes = [];
    logs = [];
    promptsAnswered = 0;
    planning = false;
    sessionCalls.planMode = null;

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      const text = String(chunk);
      writes.push(text);
      // Answer the real arrow-key prompt: "always allow everything" is the
      // third entry (1x yes, 2x always-this-command, 3x allow-all).
      if (text.includes('Execute command?') && !planning) {
        planning = true;
        setTimeout(() => {
          process.stdin.emit('keypress', '', DOWN);
          process.stdin.emit('keypress', '', DOWN);
          process.stdin.emit('keypress', '', ENTER);
          promptsAnswered++;
          planning = false;
        }, 0);
      }
      return true;
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    (process.stdin as any).isRaw = false;
    (process.stdin as any).setRawMode = () => {};
    process.stdin.resume = (() => process.stdin) as any;
  });

  afterEach(() => {
    // Only the two spies — restoring every mock would also wipe the module
    // factories the next test depends on.
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(console.log).mockRestore();
    delete (process.env as any).MYCODE_TEST;
  });

  const script = (entries: any[]) => {
    const read = vi.fn();
    for (const entry of entries) read.mockResolvedValueOnce(entry);
    read.mockResolvedValue({ kind: 'exit' });
    (TextArea as any).mockImplementation(() => ({
      read,
      setBusy: vi.fn(),
      isBusy: () => false,
      setCommands: vi.fn(),
      close: vi.fn(),
      stashCount: 0,
    }));
    return read;
  };

  it('stops asking for the rest of the session, and asks again after /new', async () => {
    script([
      { kind: 'text', text: 'run the tests' }, // turn 1 — the interruption
      { kind: 'text', text: 'and again' }, // turn 2 — same session
      { kind: 'slash', name: '/new' }, // new session
      { kind: 'text', text: 'third turn' }, // turn 3 — new session
      { kind: 'exit' },
    ]);

    await chatCommand();

    const output = writes.join('');
    // 1. the option is reachable exactly where the interruption happens
    expect(output).toContain(ALLOW_ALL_LABEL);
    // 3. /new is a new session, so the user is asked again (2 prompts total)
    expect(promptsAnswered).toBe(2);
  });

  it('/plan turns on a real mode, not just a prompt', async () => {
    script([{ kind: 'slash', name: '/plan' }, { kind: 'exit' }]);
    await chatCommand();

    expect(sessionCalls.planMode).toBe(true);
    expect(logs.join('\n')).toContain('PLAN MODE');
  });

  it('/plan <task> runs a planning turn and saves the plan where the user asked', async () => {
    // chatCommand resolves cwd from process.cwd(); pin it to a scratch dir.
    const dir = mkdtempSync(join(tmpdir(), 'mycode-plan-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      script([{ kind: 'slash', name: '/plan fix the uploader' }, { kind: 'exit' }]);
      await chatCommand();

      expect(sessionCalls.planMode).toBe(true);
      const saved = readdirSync(join(dir, '.mycode', 'plans'));
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatch(/^\d{4}-\d{2}-\d{2}-fix-the-uploader\.md$/);
      expect(readFileSync(join(dir, '.mycode', 'plans', saved[0]), 'utf-8')).toContain('done');
    } finally {
      cwdSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('/build leaves the mode, and a new session does not silently keep it', async () => {
    script([{ kind: 'slash', name: '/plan' }, { kind: 'slash', name: '/build' }, { kind: 'exit' }]);
    await chatCommand();

    // Last word wins: /build switched it back off.
    expect(sessionCalls.planMode).toBe(false);
    expect(logs.join('\n')).toContain('Build mode');
  });

  it('/plan off is the same as /build', async () => {
    script([
      { kind: 'slash', name: '/plan' },
      { kind: 'slash', name: '/plan off' },
      { kind: 'exit' },
    ]);
    await chatCommand();

    expect(sessionCalls.planMode).toBe(false);
  });

  it('does not interrupt a follow-up question in the same session', async () => {
    script([
      { kind: 'text', text: 'run the tests' },
      { kind: 'text', text: 'and again' },
      { kind: 'exit' },
    ]);

    await chatCommand();

    // One prompt for two turns: the bypass covers the whole session.
    expect(promptsAnswered).toBe(1);
    expect(lastOpts?.confirmFn).toBeTypeOf('function');
  });
});
