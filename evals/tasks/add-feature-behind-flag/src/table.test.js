import test from 'node:test';
import assert from 'node:assert';
import { render } from './table.js';

test('default text', () => assert.strictEqual(render([['a','b']]), 'a | b'));
