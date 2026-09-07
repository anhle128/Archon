import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GitLogCommit } from '@/lib/api';

import { CommitHistoryGraph, nextCommitIndex } from './commit-history-graph';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const NOW = Date.parse('2026-09-06T20:00:00Z');

const COMMITS: readonly GitLogCommit[] = [
  {
    oid: D,
    parents: [C, B],
    authorName: 'Ada',
    authorDate: '2026-09-06T19:00:00Z',
    subject: 'merge feature',
  },
  {
    oid: C,
    parents: [A],
    authorName: 'Grace',
    authorDate: '2026-09-06T18:00:00Z',
    subject: 'run work',
  },
  {
    oid: B,
    parents: [A],
    authorName: 'Linus',
    authorDate: '2026-09-06T17:00:00Z',
    subject: 'feature work',
  },
  {
    oid: A,
    parents: [],
    authorName: 'Margaret',
    authorDate: '2026-09-06T16:00:00Z',
    subject: 'base',
  },
];

describe('CommitHistoryGraph', () => {
  test('renders accessible commit copy and merge topology rather than a flat subject list', () => {
    const html = renderToStaticMarkup(<CommitHistoryGraph commits={COMMITS} nowMs={NOW} />);

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Commit history"');
    expect(html).toContain('aria-activedescendant="sc-history-commit-0"');
    expect(html).toContain('merge feature');
    expect(html).toContain('Ada');
    expect(html).toContain('1 hour ago');
    expect(html).toContain(D.slice(0, 7));
    expect(html).toContain('<svg');
    expect(html).toContain('<polygon');
    expect(html).toContain('<circle');
    expect(html).toContain('data-edge="incoming"');
    expect(html).toContain('data-edge="through"');
    expect(html).toContain('data-edge="parent"');
    expect(html).toContain('stroke-text-secondary');
    expect(html).toContain('fill-text-primary');
    expect(html).not.toContain('opacity');
    expect(html).not.toContain('<ol');
  });

  test('marks ordinary and merge rows in their accessible names', () => {
    const html = renderToStaticMarkup(<CommitHistoryGraph commits={COMMITS} nowMs={NOW} />);

    expect(html).toContain(
      `aria-label="Merge commit ${D.slice(0, 7)}: merge feature; Ada; 1 hour ago"`
    );
    expect(html).toContain(`aria-label="Commit ${C.slice(0, 7)}: run work; Grace; 2 hours ago"`);
  });

  test('virtualizes a large already-laid-out page', () => {
    const commits: GitLogCommit[] = Array.from({ length: 200 }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      const parent = (index + 1).toString(16).padStart(40, '0');
      return {
        oid,
        parents: index === 199 ? [] : [parent],
        authorName: 'Ada',
        authorDate: '2026-09-06T19:00:00Z',
        subject: `commit-${String(index)}`,
      };
    });

    const html = renderToStaticMarkup(<CommitHistoryGraph commits={commits} nowMs={NOW} />);
    const renderedOptions = html.match(/role="option"/g) ?? [];

    expect(renderedOptions.length).toBeGreaterThan(0);
    expect(renderedOptions.length).toBeLessThan(commits.length);
    expect(html).toContain('height:6400px');
    expect(html).not.toContain('commit-199');
  });

  test('renders expanded commit files inline with a distinct list prefix and no Back copy', () => {
    const html = renderToStaticMarkup(
      <CommitHistoryGraph
        commits={COMMITS}
        nowMs={NOW}
        expandedOid={D}
        commitFiles={[{ path: 'src/from-commit.ts', status: 'M' }]}
        commitFilesLoadState="idle"
        onToggleCommit={(): void => undefined}
      />
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Commit files"');
    expect(html).toContain('src/from-commit.ts');
    expect(html).toContain('from-commit.ts');
    expect(html).toContain('data-lane-continuation');
    expect(html).toContain('sc-commit-' + D + '-file-0');
    expect(html).toContain('>M<');
    expect(html).not.toContain('Back');
  });

  test('renders bounded loading and refresh-error copy inside the expanded row', () => {
    const loading = renderToStaticMarkup(
      <CommitHistoryGraph
        commits={COMMITS}
        nowMs={NOW}
        expandedOid={D}
        commitFiles={[]}
        commitFilesLoadState="loading"
      />
    );
    expect(loading).toContain('Loading files');
    expect(loading).toContain('data-lane-continuation');
    expect(loading).toContain('height:164px');
    const failed = renderToStaticMarkup(
      <CommitHistoryGraph
        commits={COMMITS}
        nowMs={NOW}
        expandedOid={D}
        commitFiles={[]}
        commitFilesLoadState="error"
      />
    );
    expect(failed).toContain('Could not refresh files.');
    expect(failed).not.toContain('No file changes');
  });

  test('reserves expanded-row height while the nested file list remains virtualized', () => {
    const files = Array.from({ length: 200 }, (_unused, index) => ({
      path: `commit-file-${String(index)}.ts`,
      status: 'M' as const,
    }));
    const html = renderToStaticMarkup(
      <CommitHistoryGraph
        commits={COMMITS}
        nowMs={NOW}
        expandedOid={D}
        commitFiles={files}
        commitFilesLoadState="idle"
        onToggleCommit={(): void => undefined}
      />
    );
    expect(html).toContain('height:368px');
    expect(html).toContain('height:6400px');
    expect(html).not.toContain('commit-file-199.ts');
  });
});

describe('nextCommitIndex', () => {
  test('supports Arrow, Home, and End without moving for activation keys', () => {
    expect(nextCommitIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextCommitIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextCommitIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextCommitIndex('Home', 2, 3)).toBe(0);
    expect(nextCommitIndex('End', 0, 3)).toBe(2);
    expect(nextCommitIndex('Enter', 1, 3)).toBe(1);
  });
});
