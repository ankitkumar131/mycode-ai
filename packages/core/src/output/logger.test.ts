import { describe, it, expect, afterEach } from 'vitest';
import { logger, setLoggerWriteHooks } from './logger.js';

/**
 * Log lines must not collide with an in-place spinner.
 *
 * Regression: the CLI's thinking spinner (ora) redraws its line in place. A
 * plain `console.log` from the router's provider-switch path landed underneath
 * the spinner's current frame, so every switch came out prefixed by a stray
 * `✦`/`✧`/`◆` glyph followed by the spinner's own text — e.g.
 * `✦ ✦ pokee/pokee-isaac ↻ Switching pokee → openrouter/free (auth error)`.
 *
 * The logger now runs a caller-supplied guard around every write, so the CLI
 * can clear the spinner first and restore it afterwards.
 */
describe('logger write hooks', () => {
  afterEach(() => setLoggerWriteHooks(null));

  it('runs the before hook before the write and the after hook after it', () => {
    const order: string[] = [];
    setLoggerWriteHooks({
      before: () => order.push('before'),
      after: () => order.push('after'),
    });
    logger.info('hello');
    expect(order).toEqual(['before', 'after']);
  });

  it('still writes the line even when a hook throws', () => {
    setLoggerWriteHooks({
      before: () => {
        throw new Error('guard blew up');
      },
    });
    // Must not propagate, and must still emit.
    expect(() => logger.warn('still here')).not.toThrow();
  });

  it('clears the hooks when passed null', () => {
    const calls: string[] = [];
    setLoggerWriteHooks({ before: () => calls.push('b') });
    logger.info('one');
    expect(calls).toEqual(['b']);
    setLoggerWriteHooks(null);
    logger.info('two');
    expect(calls).toEqual(['b']);
  });

  it('covers every logger method, not just the provider ones', () => {
    const calls: string[] = [];
    setLoggerWriteHooks({ before: () => calls.push('x'), after: () => calls.push('y') });
    logger.info('a');
    logger.success('b');
    logger.warn('c');
    logger.provider('d');
    logger.tool('read_file', 'x.ts');
    logger.switchProviders('a', 'b', 'rate limit');
    logger.blank();
    logger.divider();
    logger.header('3.1.1', 'm');
    logger.tokens(1, 2);
    // 10 methods x (before, after).
    expect(calls).toHaveLength(20);
  });

  it('error() writes to stderr but still honours the hooks', () => {
    const calls: string[] = [];
    setLoggerWriteHooks({ before: () => calls.push('b') });
    logger.error('boom');
    expect(calls).toEqual(['b']);
  });
});
