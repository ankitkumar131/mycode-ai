import test from 'node:test';
import assert from 'node:assert';
import { sliceLast, takeFirst } from './list.js';

test('sliceLast two', () => assert.deepStrictEqual(sliceLast([1, 2, 3], 2), [2, 3]));
test('takeFirst two', () => assert.deepStrictEqual(takeFirst([1, 2, 3], 2), [1, 2]));
