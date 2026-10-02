import test from 'node:test';
import assert from 'node:assert';
import { signup } from './signup.js';

test('accepts valid', () => assert.strictEqual(signup({ email: 'a@b.co', password: 'longenough' }).ok, true));
