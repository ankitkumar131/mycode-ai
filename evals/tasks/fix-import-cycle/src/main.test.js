import test from 'node:test';
import assert from 'node:assert';
import { combined } from './a.js';

test('combined', () => assert.strictEqual(combined(), 'ab1'));
