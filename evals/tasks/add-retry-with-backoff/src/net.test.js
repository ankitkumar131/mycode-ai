import test from 'node:test';
import assert from 'node:assert';
import { request } from './net.js';

test('returns on first success', async () => {
  assert.strictEqual(await request(async () => 'ok'), 'ok');
});
