import test from 'node:test';
import assert from 'node:assert/strict';

import { isNewerVersion } from '../src/utils/update-check.js';

test('isNewerVersion compares semantic versions correctly', () => {
  assert.equal(isNewerVersion('0.2.2', '0.2.1'), true);
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true);
  assert.equal(isNewerVersion('0.2.1', '0.2.1'), false);
  assert.equal(isNewerVersion('0.2.0', '0.2.1'), false);
});

