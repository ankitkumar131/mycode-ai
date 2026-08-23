import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';
import { join } from 'path';
import { readDocumentTool } from './read-document.js';
import { readFileTool } from './read-file.js';

const TEST_DIR = join(process.cwd(), '.test-docs');

describe('readDocumentTool', () => {
  beforeEach(() => {
    try {
      mkdirSync(TEST_DIR, { recursive: true });
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      rmdirSync(TEST_DIR, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('reads plain text files cleanly', async () => {
    const filePath = join(TEST_DIR, 'sample.txt');
    writeFileSync(filePath, 'Hello world document text', 'utf-8');

    const result = await readDocumentTool.execute({ path: filePath }, process.cwd());
    expect(result).toContain('Hello world document text');
    expect(result).toContain('.txt text');

    try { unlinkSync(filePath); } catch {}
  });

  it('reads RTF files stripping formatting codes', async () => {
    const filePath = join(TEST_DIR, 'sample.rtf');
    const rtfContent = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Hello \\b bold\\b0 text!\\par Second paragraph.}';
    writeFileSync(filePath, rtfContent, 'utf-8');

    const result = await readDocumentTool.execute({ path: filePath }, process.cwd());
    expect(result).toContain('Hello boldtext!');
    expect(result).toContain('Second paragraph.');

    try { unlinkSync(filePath); } catch {}
  });

  it('reads HTML files stripping script and style tags', async () => {
    const filePath = join(TEST_DIR, 'sample.html');
    const htmlContent = '<html><head><style>body { color: red; }</style></head><body><h1>Document Title</h1><p>Document content paragraph.</p></body></html>';
    writeFileSync(filePath, htmlContent, 'utf-8');

    const result = await readDocumentTool.execute({ path: filePath }, process.cwd());
    expect(result).toContain('Document Title');
    expect(result).toContain('Document content paragraph.');
    expect(result).not.toContain('color: red');

    try { unlinkSync(filePath); } catch {}
  });

  it('readFile auto-delegates .rtf and .html to readDocument', async () => {
    const filePath = join(TEST_DIR, 'auto.rtf');
    writeFileSync(filePath, '{\\rtf1 Direct read RTF}', 'utf-8');

    const result = await readFileTool.execute({ path: filePath }, process.cwd());
    expect(result).toContain('Direct read RTF');

    try { unlinkSync(filePath); } catch {}
  });
});
