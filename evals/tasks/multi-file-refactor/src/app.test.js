import test from 'node:test';
import assert from 'node:assert';
import { describe } from './app.js';
import { first } from './other.js';

test('describe', () => assert.strictEqual(describe(2), 'user2'));
test('first', () => assert.strictEqual(first(), 'user1'));
