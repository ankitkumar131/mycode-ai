import {
  DEFAULT_PONYTAIL_MODE,
  PONYTAIL_MOTTO,
  buildPonytailCommandPrompt,
  getPonytailPolicy,
  normalizePonytailMode,
} from './ponytail.js';

describe('native Ponytail policy', () => {
  it('defaults to full mode and applies to every task', () => {
    const policy = getPonytailPolicy();
    expect(DEFAULT_PONYTAIL_MODE).toBe('full');
    expect(policy).toContain(PONYTAIL_MOTTO);
    expect(policy).toContain('every user request');
    expect(policy).toContain('standard library');
    expect(policy).toContain('security, validation, error handling');
  });

  it('supports explicit modes and deactivation', () => {
    expect(normalizePonytailMode(undefined)).toBe('full');
    expect(normalizePonytailMode('ULTRA')).toBe('ultra');
    expect(normalizePonytailMode('unknown')).toBe('full');
    expect(getPonytailPolicy('off')).toBe('');
    expect(getPonytailPolicy('lite')).toContain('light bias');
  });

  it('builds native review shortcuts with the same policy', () => {
    const prompt = buildPonytailCommandPrompt('debt', 'packages/core');
    expect(prompt).toContain(PONYTAIL_MOTTO);
    expect(prompt).toContain('packages/core');
    expect(prompt).toContain('removed safely');
  });
});
