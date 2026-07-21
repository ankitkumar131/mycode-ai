import { describe, it, expect, vi } from 'vitest';

vi.mock('@mycode/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mycode/core')>();
  return {
    ...mod,
    AgentSession: vi.fn().mockImplementation((opts: any) => ({
      run: vi.fn().mockImplementation(async (input: string) => {
        opts?.onText?.('Mock answer');
        return 'Mock answer';
      }),
    })),
  };
});

import { MyCodeAgent } from '../agent.js';
import { skillDir, discoverSkills, createSkill, loadSkillConfig } from '../skills.js';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

describe('MyCodeAgent', () => {
  it('creates with default config', () => {
    const agent = new MyCodeAgent();
    const info = agent.getInfo();
    expect(info.version).toBe('1.0.0-alpha');
    expect(info.tools).toBe(11);
  });

  it('creates with custom config', () => {
    const agent = new MyCodeAgent({ model: 'gpt-4', provider: 'openai', cwd: '/tmp' });
    const info = agent.getInfo();
    expect(info.model).toBe('gpt-4');
    expect(info.provider).toBe('openai');
  });

  it('getInfo returns uptime', async () => {
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

  it('runStream returns result', async () => {
    const agent = new MyCodeAgent();
    const result = await agent.run('hello', { maxIterations: 1 });
    expect(typeof result).toBe('string');
  });

  it('events callbacks fire', async () => {
    const events: string[] = [];
    const agent = new MyCodeAgent();
    await agent.run('hello', {
      maxIterations: 1,
      events: {
        onText(t) { events.push(`text:${t}`); },
        onToolCall(c) { events.push(`tool:${c.name}`); },
        onToolResult(r) { events.push(`result:${r.toolName}`); },
      },
    });
    expect(Array.isArray(events)).toBe(true);
    expect(events).toContain('text:Mock answer');
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
