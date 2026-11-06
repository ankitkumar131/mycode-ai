import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCustomCommands, findCustomCommand, expandCustomCommand } from '../custom-commands.js';

const write = (dir: string, file: string, content: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
};

const cmd = (name: string, body: string, frontmatter = '') =>
  `${frontmatter ? `---\n${frontmatter}\n---\n` : ''}${body}\n`;

describe('loadCustomCommands', () => {
  let cwd: string;
  let fakeHome: string;
  const realHome = process.env.HOME;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mycode-cmd-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'mycode-home-'));
    // os.homedir() reads $HOME on POSIX, which is also how the CLI resolves
    // the user config directory.
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('loads a command from .mycode/commands', () => {
    write(join(cwd, '.mycode/commands'), 'review.md', cmd('review', 'Review $1', 'description: Review a file\nargument-hint: <path>'));
    const [c] = loadCustomCommands(cwd);
    expect(c.name).toBe('/review');
    expect(c.description).toBe('Review a file');
    expect(c.argumentHint).toBe('<path>');
    expect(c.template).toBe('Review $1');
    expect(c.scope).toBe('project');
  });

  it('also reads the opencode and claude directories, so existing projects work', () => {
    write(join(cwd, '.opencode/command'), 'ship.md', cmd('ship', 'Ship it'));
    write(join(cwd, '.claude/commands'), 'audit.md', cmd('audit', 'Audit it'));
    const names = loadCustomCommands(cwd).map((c) => c.name);
    expect(names).toContain('/ship');
    expect(names).toContain('/audit');
  });

  it('lets a project command shadow a user command of the same name', () => {
    write(join(fakeHome, '.mycode/commands'), 'review.md', cmd('review', 'user version'));
    write(join(cwd, '.mycode/commands'), 'review.md', cmd('review', 'project version'));
    const found = loadCustomCommands(cwd).filter((c) => c.name === '/review');
    expect(found).toHaveLength(1);
    expect(found[0].template).toBe('project version');
    expect(found[0].scope).toBe('project');
  });

  it('ignores files whose name would not be typeable', () => {
    write(join(cwd, '.mycode/commands'), 'my command!.md', cmd('x', 'nope'));
    write(join(cwd, '.mycode/commands'), 'ok.md', cmd('x', 'yes'));
    expect(loadCustomCommands(cwd).map((c) => c.name)).toEqual(['/ok']);
  });

  it('ignores empty bodies and non-markdown files', () => {
    write(join(cwd, '.mycode/commands'), 'empty.md', '---\ndescription: nothing\n---\n');
    write(join(cwd, '.mycode/commands'), 'notes.txt', 'not a command');
    expect(loadCustomCommands(cwd)).toHaveLength(0);
  });

  it('returns an empty list when no command directory exists', () => {
    expect(loadCustomCommands(cwd)).toEqual([]);
  });

  it('finds a command by name with or without the slash', () => {
    write(join(cwd, '.mycode/commands'), 'review.md', cmd('review', 'body'));
    expect(findCustomCommand(cwd, 'review')?.name).toBe('/review');
    expect(findCustomCommand(cwd, '/REVIEW')?.name).toBe('/review');
    expect(findCustomCommand(cwd, 'missing')).toBeUndefined();
  });
});

describe('expandCustomCommand', () => {
  it('substitutes $ARGUMENTS with the whole argument string', () => {
    expect(expandCustomCommand('Check $ARGUMENTS now', 'src/a.ts and src/b.ts')).toBe('Check src/a.ts and src/b.ts now');
  });

  it('substitutes positional arguments', () => {
    expect(expandCustomCommand('$1 then $2', 'first second')).toBe('first then second');
    expect(expandCustomCommand('[$3]', 'a b')).toBe('[]');
  });

  it('treats quoted runs as one argument', () => {
    expect(expandCustomCommand('file=$1 all=$@', '"my file.txt" b')).toBe('file=my file.txt all=my file.txt b');
  });

  it('leaves a template with no placeholders untouched', () => {
    expect(expandCustomCommand('Just do the thing', 'ignored')).toBe('Just do the thing');
  });

  it('does not eat a literal $ inside a word', () => {
    expect(expandCustomCommand('cost is $100', '')).toBe('cost is $100');
  });
});
