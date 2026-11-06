import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { Transcript } from './components/Transcript.js';
import { filterSlashMenu, isSlashInput } from './components/Composer.js';

describe('Transcript snapshot', () => {
  test('renders user + tool messages', async () => {
    const setup: any = await testRender(
      () => (
        <Transcript
          messages={[
            { id: 'u1', role: 'user', text: 'fix the login bug' },
            { id: 't1', role: 'tool', detail: 'read src/auth.ts (120 lines)' , text: 'ok' },
          ]}
        />
      ),
      { width: 80, height: 10 },
    );
    await setup.waitForVisualIdle?.();
    const frame = String(await setup.captureCharFrame());
    expect(frame).toContain('fix the login bug');
    expect(frame).toContain('src/auth.ts');
  });
});

describe('filterSlashMenu', () => {
  const items = [
    { name: 'allow-all', description: 'Stop asking for this session' },
    { name: 'model', description: 'Switch model' },
    { name: 'exit', description: 'Exit the session' },
  ];
  test('empty query returns all', () => {
    expect(filterSlashMenu(items, '/')).toHaveLength(3);
  });
  test('fuzzy match finds allow-all via alow', () => {
    const out = filterSlashMenu(items, '/alow');
    expect(out[0]?.name).toBe('allow-all');
  });
  test('isSlashInput detects slash', () => {
    expect(isSlashInput('/model')).toBe(true);
    expect(isSlashInput('hello')).toBe(false);
  });
});
