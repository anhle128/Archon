import { describe, expect, test } from 'bun:test';

import { HunkPageAccumulator, parseUnifiedDiffChunks } from './diff-page';

describe('incremental diff parsing', () => {
  test('preserves a multibyte line split across stream chunks', async () => {
    const raw = '@@ -1 +1 @@\n-old\n+🙂new\n';
    const bytes = Buffer.from(raw, 'utf8');
    const split = bytes.indexOf(0xf0) + 2;
    const hunks = await parseUnifiedDiffChunks([bytes.subarray(0, split), bytes.subarray(split)]);
    expect(hunks[0]?.changes).toEqual([
      { type: 'delete', content: 'old', oldLine: 1 },
      { type: 'insert', content: '🙂new', newLine: 1 },
    ]);
  });
});

describe('HunkPageAccumulator', () => {
  test('stops before a later hunk that would exceed 2000 changes', () => {
    const pager = new HunkPageAccumulator(0);
    for (let index = 0; index < 3; index += 1) {
      const decision = pager.push({
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldLines: 900,
        newStart: 1,
        newLines: 900,
        changes: Array.from({ length: 900 }, () => ({
          type: 'normal' as const,
          content: 'x',
          oldLine: 1,
          newLine: 1,
        })),
      });
      if (index < 2) expect(decision).toBe('continue');
      else expect(decision).toBe('page_full');
    }
    expect(pager.result()).toMatchObject({ nextIndex: 2, truncated: true });
    expect(pager.result().hunks).toHaveLength(2);
  });

  test('keeps one oversized first hunk whole', () => {
    const pager = new HunkPageAccumulator(0);
    const decision = pager.push({
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert', content: 'x'.repeat(300_000), newLine: 1 }],
    });
    expect(decision).toBe('continue');
    expect(pager.result().hunks).toHaveLength(1);
  });

  test('stops before a later hunk that would cross 262144 serialized bytes', () => {
    const pager = new HunkPageAccumulator(0);
    const hunk = {
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert' as const, content: 'x'.repeat(140_000), newLine: 1 }],
    };
    expect(pager.push(hunk)).toBe('continue');
    expect(pager.push({ ...hunk, newStart: 2 })).toBe('page_full');
    expect(pager.result().hunks).toHaveLength(1);
    expect(pager.result()).toMatchObject({ nextIndex: 1, truncated: true });
  });
});
