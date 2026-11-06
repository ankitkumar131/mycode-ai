import test from 'node:test';
import assert from 'node:assert';
import { add, multiply } from './calc.js';

test('add', () => assert.strictEqual(add(2, 3), 5));
test('multiply', () => assert.strictEqual(multiply(2, 3), 6));
