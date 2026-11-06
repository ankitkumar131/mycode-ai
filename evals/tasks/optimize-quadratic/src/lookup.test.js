import test from 'node:test';
import assert from 'node:assert';
import { attach } from './lookup.js';

test('attaches in record order', () => {
  const users = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
  const records = [{ userId: 2 }, { userId: 1 }, { userId: 2 }];
  assert.deepStrictEqual(attach(users, records).map(r => r.user), ['b', 'a', 'b']);
});
