import { describe, it, expect } from 'vitest';
import { createSpinner, createToolSpinner, createSetupSpinner } from '../spinner.js';

describe('spinner', () => {
  it('createSpinner returns an ora instance', () => {
    const s = createSpinner();
    expect(s).toBeDefined();
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
    expect(typeof s.succeed).toBe('function');
    expect(typeof s.fail).toBe('function');
  });

  it('createSpinner with provider label', () => {
    const s = createSpinner('gpt-4o');
    expect(s.text).toContain('gpt-4o');
  });

  it('createToolSpinner returns an ora instance', () => {
    const s = createToolSpinner('read_file');
    expect(s).toBeDefined();
    expect(s.text).toContain('read_file');
  });

  it('createSetupSpinner returns an ora instance', () => {
    const s = createSetupSpinner('Loading...');
    expect(s).toBeDefined();
    expect(typeof s.start).toBe('function');
  });
});
