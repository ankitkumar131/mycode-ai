import test from 'node:test';
import assert from 'node:assert';
import { slugify } from './slug.js';

test('basic', () => assert.strictEqual(slugify('Hello World'), 'hello-world'));
test('trims', () => assert.strictEqual(slugify('  A  B  '), 'a-b'));
test('collapses', () => assert.strictEqual(slugify('foo!!!bar'), 'foo-bar'));
