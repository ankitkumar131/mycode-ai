import test from 'node:test';
import assert from 'node:assert';
import { load } from './config.js';

test('keeps defaults', () => {
  const c = load({ timeout: 5000 });
  assert.strictEqual(c.retries, 3);
  assert.strictEqual(c.timeout, 5000);
  assert.strictEqual(c.verbose, false);
});
