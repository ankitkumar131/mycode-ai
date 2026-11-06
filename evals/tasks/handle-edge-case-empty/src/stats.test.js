import test from 'node:test';
import assert from 'node:assert';
import { mean, median, max } from './stats.js';

test('mean of two', () => assert.strictEqual(mean([1, 3]), 2));
test('median odd', () => assert.strictEqual(median([3, 1, 2]), 2));
test('max', () => assert.strictEqual(max([1, 9, 2]), 9));
