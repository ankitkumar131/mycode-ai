import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { editFileTool } from '../src/tools/edit-file.js';

test('editFile applies edits to CRLF files using LF search text', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mycode-edit-'));
  const filePath = join(tempDir, 'sample.js');

  try {
    writeFileSync(filePath, 'const value = 1;\r\nconsole.log(value);\r\n', 'utf-8');

    const result = await editFileTool.execute(
      {
        path: 'sample.js',
        edits: [
          {
            search: 'const value = 1;\nconsole.log(value);\n',
            replace: 'const value = 2;\nconsole.log(value);\n',
          },
        ],
      },
      tempDir
    );

    assert.match(result, /Applied 1 edit/);
    assert.equal(
      readFileSync(filePath, 'utf-8'),
      'const value = 2;\r\nconsole.log(value);\r\n'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

