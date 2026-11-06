import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSessions } = vi.hoisted(() => ({ mockSessions: [] as any[] }));

vi.mock('@mycode/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mycode/core')>();
  return {
    ...mod,
    AgentSession: vi.fn().mockImplementation((opts: any) => {
      const session = {
        id: 'sess-1',
        opts,
        run: vi.fn().mockImplementation(async (_input: string) => {
          opts?.onText?.('Mock answer');
          opts?.onFinish?.({ promptTokens: 1, completionTokens: 2 });
          return 'Mock answer';
        }),
        abort: vi.fn(),
        setMaxIterations: vi.fn(),
        toJSON: vi.fn(() => ({
          id: 'sess-1',
          title: null,
          cwd: '/tmp',
          createdAt: '2026-01-01T00:00:00.000Z',
          usage: {},
          messages: [],
        })),
      };
      mockSessions.push(session);
      return session;
    }),
  };
});

import { MyCodeAgent } from '../agent.js';
import { skillDir, discoverSkills, createSkill, loadSkillConfig } from '../skills.js';
import { skillManager, type BaseProvider, type ProviderConfig } from '@mycode/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const lastSession = () => mockSessions[mockSessions.length - 1];

beforeEach(() => {
  mockSessions.length = 0;
});

describe('MyCodeAgent', () => {
  it('creates with default config', () => {
    const agent = new MyCodeAgent();
    const info = agent.getInfo();
    // Version comes from the package manifest, not a hardcoded string.
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version: string };
    expect(info.version).toBe(pkg.version);
    expect(info.tools).toBeGreaterThanOrEqual(11);
    expect(info.sessionId).toBeNull();
  });

  it('creates with custom config', () => {
    const agent = new MyCodeAgent({ model: 'gpt-4', provider: 'openai', cwd: '/tmp' });
    const info = agent.getInfo();
    expect(info.model).toBe('gpt-4');
    expect(info.provider).toBe('openai');
  });

  it('getInfo returns uptime', () => {
    const agent = new MyCodeAgent();
    const info = agent.getInfo();
    expect(info.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof info.uptime).toBe('number');
  });

  it('getInfo reflects skills count', () => {
    const agent = new MyCodeAgent({ skills: [{ name: 'test', path: '/tmp/test' }] });
    const info = agent.getInfo();
    expect(info.skills).toBe(1);
  });

  it('run returns the result and reports the session id', async () => {
    const agent = new MyCodeAgent();
    const result = await agent.run('hello', { maxIterations: 1 });
    expect(typeof result).toBe('string');
    expect(agent.getInfo().sessionId).toBe('sess-1');
  });

  it('events callbacks fire', async () => {
    const events: string[] = [];
    const agent = new MyCodeAgent();
    await agent.run('hello', {
      maxIterations: 1,
      events: {
        onText(t) {
          events.push(`text:${t}`);
        },
        onToolCall(c) {
          events.push(`tool:${c.name}`);
        },
        onToolResult(r) {
          events.push(`result:${r.toolName}`);
        },
        onFinish(result) {
          events.push(`finish:${result}`);
        },
        onUsage(usage) {
          events.push(`usage:${usage.promptTokens}`);
        },
      },
    });
    expect(events).toContain('text:Mock answer');
    expect(events).toContain('finish:Mock answer');
    expect(events).toContain('usage:1');
  });

  it('reuses one session across runs (the conversation continues)', async () => {
    const agent = new MyCodeAgent();
    await agent.run('first');
    await agent.run('second');
    expect(mockSessions).toHaveLength(1);

    agent.newSession();
    await agent.run('third');
    expect(mockSessions).toHaveLength(2);
  });

  it('applies a per-run iteration cap to the live session', async () => {
    const agent = new MyCodeAgent();
    await agent.run('hello', { maxIterations: 7 });
    expect(lastSession().setMaxIterations).toHaveBeenCalledWith(7);
  });
});

describe('MyCodeAgent safety', () => {
  it('refuses writes and commands when nothing approves them', async () => {
    const agent = new MyCodeAgent();
    await agent.run('hello');
    const confirmFn = lastSession().opts.confirmFn;
    expect(await confirmFn('/tmp/file.txt', 'create file')).toBe(false);
    expect(await confirmFn('rm -rf /', null, { level: 'dangerous' })).toBe(false);
  });

  it('honours autoApprove', async () => {
    const agent = new MyCodeAgent({ autoApprove: true });
    await agent.run('hello');
    expect(await lastSession().opts.confirmFn('/tmp/file.txt', null)).toBe(true);
  });

  it('delegates to a confirm handler, which wins over autoApprove', async () => {
    const calls: string[] = [];
    const agent = new MyCodeAgent({
      autoApprove: true,
      confirm: (request) => {
        calls.push(request.target);
        return request.target.endsWith('.md');
      },
    });
    await agent.run('hello');
    const confirmFn = lastSession().opts.confirmFn;
    expect(await confirmFn('docs/readme.md', 'write')).toBe(true);
    expect(await confirmFn('src/index.ts', 'write')).toBe(false);
    expect(calls).toEqual(['docs/readme.md', 'src/index.ts']);
  });

  it('enables post-write verification by default, and can turn it off', async () => {
    await new MyCodeAgent().run('hello');
    expect(lastSession().opts.verify).toEqual({
      enabled: true,
      formatter: true,
      diagnostics: true,
    });

    mockSessions.length = 0;
    await new MyCodeAgent({ verify: false }).run('hello');
    expect(lastSession().opts.verify.enabled).toBe(false);
  });
});

describe('MyCodeAgent abort', () => {
  it('aborts the session when the signal fires', async () => {
    const agent = new MyCodeAgent();
    const controller = new AbortController();
    controller.abort();
    const result = await agent.run('hello', { signal: controller.signal });
    expect(result).toBe('Interrupted.');
    // The session exists (the signal needs something to abort) but never ran.
    expect(lastSession().run).not.toHaveBeenCalled();
  });

  it('does not start a run whose signal is already aborted', async () => {
    const agent = new MyCodeAgent();
    const controller = new AbortController();
    controller.abort();
    const onError = vi.fn();
    await agent.run('hello', { signal: controller.signal, events: { onError } });
    expect(onError).toHaveBeenCalled();
  });
});

describe('MyCodeAgent extensions', () => {
  it('registers a host tool that the session can call', async () => {
    const agent = new MyCodeAgent();
    const handler = vi.fn(
      async (args: Record<string, unknown>) => `deployed to ${args.environment}`,
    );
    agent.registerTool({
      name: 'deploy',
      description: 'Deploy the application',
      parameters: {
        type: 'object',
        properties: { environment: { type: 'string' } },
        required: ['environment'],
      },
      handler,
    });

    await agent.run('hello');
    const registry = lastSession().opts.toolRegistry;
    expect(registry.getDefinitions().map((d: any) => d.function.name)).toContain('deploy');
    await expect(registry.executeTool('deploy', { environment: 'staging' })).resolves.toBe(
      'deployed to staging',
    );
    expect(handler).toHaveBeenCalledWith({ environment: 'staging' });
  });

  it('registers a host provider backend', async () => {
    const { ProviderRouter } = await import('@mycode/core');
    const agent = new MyCodeAgent();
    agent.registerProvider({
      id: 'acme-llm',
      create: () => ({}) as unknown as BaseProvider,
    });
    expect(ProviderRouter.providerFactoryIds()).toContain('acme-llm');
    ProviderRouter.unregisterProviderFactory('acme-llm');
    expect(ProviderRouter.providerFactoryIds()).not.toContain('acme-llm');
  });

  it('runs without tools when tools is false', () => {
    const agent = new MyCodeAgent({ tools: false });
    expect(agent.getInfo().tools).toBe(0);
  });

  it('wires a failover coordinator covering every configured provider', async () => {
    const providers: ProviderConfig[] = [
      { name: 'primary', apiProvider: 'openai', model: 'gpt-4o', priority: 1 },
      { name: 'backup', apiProvider: 'ollama', model: 'llama3.1:8b', priority: 2 },
    ];
    const agent = new MyCodeAgent({ providers });
    await agent.run('hello');
    expect(lastSession().opts.failover).toBeDefined();
    expect(agent.listProviders()).toEqual(['primary', 'backup']);
  });
});

describe('MyCodeAgent skills', () => {
  it('discovers skills and makes them visible to the agent', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-skills-'));
    const originalDirs = skillManager.getExternalDirs();
    try {
      const dir = join(tmp, 'deploy-checklist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), '# Deploy checklist\n\nSteps to ship safely.\n');

      const agent = new MyCodeAgent();
      await expect(agent.loadSkills(tmp)).resolves.toBe(1);

      // Reaches the shared manager, which is what the skills tools and the
      // prompt index read from.
      expect(skillManager.getExternalDirs()).toContain(tmp);
      expect(agent.getInfo().skills).toBe(1);
      await expect(agent.readSkill('deploy-checklist')).resolves.toContain('ship safely');
    } finally {
      skillManager.configure({ externalDirs: originalDirs });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns 0 for a directory with no skills', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-skills-'));
    try {
      await expect(new MyCodeAgent().loadSkills(tmp)).resolves.toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('skills', () => {
  it('skillDir returns correct config', () => {
    const result = skillDir('/path/to/my-skill');
    expect(result.name).toBe('my-skill');
    expect(result.path).toBe('/path/to/my-skill');
  });

  it('discoverSkills returns empty for nonexistent dir', async () => {
    const skills = await discoverSkills('/nonexistent/path');
    expect(skills).toEqual([]);
  });

  it('discoverSkills finds skills with SKILL.md', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-test-'));
    try {
      const skillPath = join(tmp, 'test-skill');
      mkdirSync(skillPath, { recursive: true });
      writeFileSync(join(skillPath, 'SKILL.md'), '# Test Skill\n\nA test skill\n');

      const skills = await discoverSkills(tmp);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('test-skill');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('discoverSkills finds skills with skill.json', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-test-'));
    try {
      const skillPath = join(tmp, 'json-skill');
      mkdirSync(skillPath, { recursive: true });
      writeFileSync(join(skillPath, 'skill.json'), JSON.stringify({ name: 'json-skill' }));

      const skills = await discoverSkills(tmp);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('json-skill');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('createSkill creates SKILL.md', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-test-'));
    try {
      const config = await createSkill(tmp, 'my-new-skill', 'Does something useful');
      expect(config.name).toBe('my-new-skill');
      expect(existsSync(join(tmp, 'my-new-skill', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('loadSkillConfig reads SKILL.md', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sdk-test-'));
    try {
      const skillPath = join(tmp, 'test-skill');
      mkdirSync(skillPath, { recursive: true });
      writeFileSync(join(skillPath, 'SKILL.md'), '# Test Skill\n\nMy description\n');

      const result = await loadSkillConfig(skillPath);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test Skill');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('loadSkillConfig returns null for missing SKILL.md', async () => {
    const result = await loadSkillConfig('/nonexistent');
    expect(result).toBeNull();
  });
});
