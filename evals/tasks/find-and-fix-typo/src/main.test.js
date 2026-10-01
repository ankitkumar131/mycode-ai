import test from 'node:test';
import assert from 'node:assert';
import { price } from './main.js';

test('price', () => assert.strictEqual(price(1234), '$12.34'));
