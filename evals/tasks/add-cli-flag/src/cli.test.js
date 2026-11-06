import test from 'node:test';
import assert from 'node:assert';
import { parseArgs } from './cli.js';

test('parses files', () => {
  assert.deepStrictEqual(parseArgs(['a.txt']).files, ['a.txt']);
});
test('parses out', () => {
  assert.strictEqual(parseArgs(['--out=x']).out, 'x');
});
test('rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--nope']));
});
