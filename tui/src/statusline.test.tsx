import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { StatusLine, buildStatusText, type TuiStatusState } from './components/StatusLine.js';

const base: TuiStatusState = {
  model: 'deepseek-v4',
  provider: 'ceanAPI',
  usedTokens: 12000,
  contextWindow: 128000,
  elapsedMs: 65000,
  bypass: 'YOLO',
};

describe('buildStatusText', () => {
  test('bypass badge survives narrow truncation', () => {
    const narrow = buildStatusText(base, 40);
    expect(narrow).toContain('YOLO');
  });

  test('full line fits wide terminals', () => {
    const wide = buildStatusText(base, 200);
    expect(wide).toContain('9%');
    expect(wide).toContain('YOLO');
  });

  test('no bypass renders without badge', () => {
    const line = buildStatusText({ ...base, bypass: null }, 200);
    expect(line).not.toContain('YOLO');
    expect(line).toContain('deepseek-v4');
  });
});

describe('StatusLine snapshot', () => {
  test('renders gauge + badge', async () => {
    const setup: any = await testRender(() => <StatusLine state={base} />, {
      width: 100,
      height: 4,
    });
    await setup.waitForVisualIdle?.();
    const frame = String(await setup.captureCharFrame());
    expect(frame).toContain('YOLO');
    expect(frame).toContain('%');
  });
});
