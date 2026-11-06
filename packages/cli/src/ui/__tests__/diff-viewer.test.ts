import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, renderDiff, renderDiffLine, diffStats } from '../diff-viewer.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export function a() {
 context line
-removed line
+added line
+another added
 tail
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -5,2 +5,2 @@
-old docs
+new docs
`;

describe('parseUnifiedDiff', () => {
  it('splits into files', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'README.md']);
  });

  it('splits into hunks with start lines', () => {
    const [a] = parseUnifiedDiff(SAMPLE);
    expect(a.hunks).toHaveLength(1);
    expect(a.hunks[0].startLine).toBe(1);
    expect(a.hunks[0].header).toContain('@@ -1,3 +1,4 @@');
  });

  it('counts additions and deletions per file', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(files[1]).toMatchObject({ additions: 1, deletions: 1 });
  });

  it('handles a multi-hunk file', () => {
    const multi = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,2 @@
-a
+b
@@ -50,2 +50,2 @@
-c
+d
`;
    const [f] = parseUnifiedDiff(multi);
    expect(f.hunks).toHaveLength(2);
    expect(f.hunks[1].startLine).toBe(50);
  });

  it('returns nothing for empty or junk input rather than throwing', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('just some text')).toEqual([]);
  });
});

describe('renderDiffLine', () => {
  it('colours additions, deletions, and hunk headers distinctly', () => {
    const add = renderDiffLine('+added');
    const del = renderDiffLine('-removed');
    const hunk = renderDiffLine('@@ -1 +1 @@');
    expect(add).not.toBe(del);
    expect(hunk).not.toBe(add);
    expect(strip(add)).toBe('+added');
  });

  it('leaves context lines uncoloured in content', () => {
    expect(strip(renderDiffLine(' plain'))).toBe(' plain');
  });
});

describe('renderDiff', () => {
  it('groups output by file with a stat line', () => {
    const out = strip(renderDiff(SAMPLE));
    expect(out).toContain('src/a.ts');
    expect(out).toContain('+2');
    expect(out).toContain('-1');
    expect(out).toContain('README.md');
  });

  it('says so when there is nothing to show', () => {
    expect(strip(renderDiff(''))).toContain('No changes');
  });

  it('bounds the number of lines in static mode', () => {
    const huge = `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -1,0 +1,500 @@\n` +
      Array.from({ length: 500 }, (_, i) => `+line ${i}`).join('\n');
    const out = strip(renderDiff(huge, { maxLines: 50 }));
    expect(out.split('\n').length).toBeLessThanOrEqual(52);
    expect(out).toContain('more lines');
    expect(out).toContain('pager');
  });
});

describe('diffStats', () => {
  it('totals across files', () => {
    expect(diffStats(SAMPLE)).toEqual({ files: 2, additions: 3, deletions: 2 });
  });

  it('is zero for no diff', () => {
    expect(diffStats('')).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});
