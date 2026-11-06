import test from 'node:test';
import assert from 'node:assert';
import { value } from './index.js';

test('value', () => assert.strictEqual(value, 'used'));
