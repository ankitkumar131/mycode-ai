import test from 'node:test';
import assert from 'node:assert';
import { get, stats } from './cache.js';

test('dedupes concurrent fetches', async () => {
  stats().reset();
  const results = await Promise.all([get('a'), get('a'), get('a')]);
  assert.deepStrictEqual(results, ['v:a', 'v:a', 'v:a']);
  assert.strictEqual(stats().fetchCount, 1);
});
