import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { FileGlyph, splitGitPath } from './file-glyph';

describe('splitGitPath', () => {
  test('splits a nested path into name and directory', () => {
    expect(splitGitPath('src/from-commit.ts')).toEqual({
      name: 'from-commit.ts',
      directory: 'src',
    });
  });

  test('keeps a basename-only path as the name', () => {
    expect(splitGitPath('README.md')).toEqual({ name: 'README.md', directory: null });
  });
});

describe('FileGlyph', () => {
  test('colors TypeScript, YAML, JSON, and Markdown from existing tokens', () => {
    expect(renderToStaticMarkup(<FileGlyph path="a.ts" />)).toContain('text-node-command');
    expect(renderToStaticMarkup(<FileGlyph path="a.yaml" />)).toContain('text-node-prompt');
    expect(renderToStaticMarkup(<FileGlyph path="a.json" />)).toContain('text-node-bash');
    expect(renderToStaticMarkup(<FileGlyph path="a.md" />)).toContain('text-node-command');
  });
});
