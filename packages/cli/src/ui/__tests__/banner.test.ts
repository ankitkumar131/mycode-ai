import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderBanner } from '../banner.js';

/**
 * The rules that shape every answer must be findable before the first
 * question — a behaviour the user cannot see is a behaviour they cannot trust.
 */
describe('renderBanner', () => {
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const text = () => out.join('\n');

  it('announces the active ponytail mode and how to turn it off', () => {
    renderBanner({
      version: '3.2.0',
      model: 'gpt-4o',
      cwd: '/tmp',
      providerChain: ['test'],
      ponytail: 'ponytail: full (default)',
    });
    expect(text()).toContain('ponytail: full (default)');
    expect(text()).toContain('/ponytail off');
  });

  it('stays quiet when ponytail is off or unset', () => {
    renderBanner({
      version: '3.2.0',
      model: 'gpt-4o',
      cwd: '/tmp',
      providerChain: ['test'],
      ponytail: null,
    });
    expect(text()).not.toContain('ponytail');
    renderBanner({ version: '3.2.0', model: 'gpt-4o', cwd: '/tmp', providerChain: [] });
    expect(text()).not.toContain('ponytail');
  });

  it('reports an explicitly chosen level, not just the default', () => {
    renderBanner({
      version: '3.2.0',
      model: 'gpt-4o',
      cwd: '/tmp',
      providerChain: ['test'],
      ponytail: 'ponytail: ultra (set this session)',
    });
    expect(text()).toContain('ponytail: ultra (set this session)');
  });
});
