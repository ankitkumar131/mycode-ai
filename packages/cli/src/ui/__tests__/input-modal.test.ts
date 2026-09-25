import { describe, it, expect, afterEach } from 'vitest';
import { enterModal, exitModal, isModalActive, registerInputGuard } from '../input-modal.js';

/**
 * Modal UI must own the keyboard exclusively.
 *
 * Regression: the composer attaches `keypress`/`data` listeners in `ensureInput`
 * and only removes them in `close()`, so they stay live for the whole session -
 * including while a turn is running. The approval picker also listened, so every
 * arrow key and Enter went to both. The user's visible selection and the value
 * the picker resolved did not match, which is why "Always allow this command"
 * never took effect and the same command kept being asked for.
 */
describe('input modal guard', () => {
  afterEach(() => {
    // Leave the registry clean for the next test.
    while (isModalActive()) exitModal();
    registerInputGuard(null);
  });

  it('suspends the guard on enter and resumes on exit', () => {
    const events: string[] = [];
    registerInputGuard({
      suspend: () => events.push('suspend'),
      resume: () => events.push('resume'),
    });

    enterModal();
    expect(events).toEqual(['suspend']);
    expect(isModalActive()).toBe(true);

    exitModal();
    expect(events).toEqual(['suspend', 'resume']);
    expect(isModalActive()).toBe(false);
  });

  it('only suspends once for nested modals', () => {
    const events: string[] = [];
    registerInputGuard({
      suspend: () => events.push('suspend'),
      resume: () => events.push('resume'),
    });

    enterModal();
    enterModal();
    expect(events).toEqual(['suspend']);

    exitModal();
    expect(events).toEqual(['suspend']); // still held by the outer modal
    exitModal();
    expect(events).toEqual(['suspend', 'resume']);
  });

  it('tolerates exit without enter', () => {
    expect(() => exitModal()).not.toThrow();
    expect(isModalActive()).toBe(false);
  });

  it('a throwing guard does not break the modal', () => {
    registerInputGuard({
      suspend: () => {
        throw new Error('boom');
      },
      resume: () => {
        throw new Error('boom');
      },
    });
    expect(() => enterModal()).not.toThrow();
    expect(isModalActive()).toBe(true);
    expect(() => exitModal()).not.toThrow();
    expect(isModalActive()).toBe(false);
  });

  it('works with no guard registered at all', () => {
    registerInputGuard(null);
    expect(() => enterModal()).not.toThrow();
    expect(isModalActive()).toBe(true);
    expect(() => exitModal()).not.toThrow();
  });
});
