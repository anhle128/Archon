import { describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HunkData, TokenNode } from 'react-diff-view';

import { highlightedHtml, highlightDiffTokens, renderHighlightedToken } from './syntax-highlight';

const ATTACKER = '<img src=x onerror=alert(1)>';
const TYPESCRIPT_SOURCE = 'function greet(name: string): string {\n  return name;\n}';

function renderTokenHtml(
  token: TokenNode,
  renderDefault: (token: TokenNode, index: number) => ReactNode
): string {
  return renderToStaticMarkup(<>{renderHighlightedToken(token, renderDefault, 0)}</>);
}

describe('highlightedHtml', () => {
  test('produces highlight.js tokens for ordinary TypeScript', () => {
    expect(highlightedHtml(TYPESCRIPT_SOURCE)).toContain('hljs-');
  });

  test('escapes attacker-controlled img markup as text with no image element', () => {
    const html = highlightedHtml(ATTACKER);
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<img');
  });
});

describe('highlightDiffTokens', () => {
  test('indexes old and new arrays from actual line numbers', () => {
    const hunks: readonly HunkData[] = [
      {
        content: '@@ -3,2 +4,3 @@',
        oldStart: 3,
        oldLines: 2,
        newStart: 4,
        newLines: 3,
        changes: [
          { type: 'delete', content: 'gone', lineNumber: 3, isDelete: true },
          { type: 'insert', content: 'added', lineNumber: 4, isInsert: true },
          {
            type: 'normal',
            content: 'same',
            oldLineNumber: 4,
            newLineNumber: 5,
            isNormal: true,
          },
        ],
      },
    ];

    const tokens = highlightDiffTokens(hunks);
    expect(tokens.old[2]?.[0]).toEqual({ type: 'highlighted', value: highlightedHtml('gone') });
    expect(tokens.new[3]?.[0]).toEqual({ type: 'highlighted', value: highlightedHtml('added') });
    expect(tokens.old[3]?.[0]).toEqual({ type: 'highlighted', value: highlightedHtml('same') });
    expect(tokens.new[4]?.[0]).toEqual({ type: 'highlighted', value: highlightedHtml('same') });
  });
});

describe('renderHighlightedToken', () => {
  test('renders library-produced highlighted tokens without creating an image element', () => {
    const html = renderTokenHtml({ type: 'highlighted', value: highlightedHtml(ATTACKER) }, () => (
      <span>default</span>
    ));
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<img');
  });

  test('delegates every non-highlighted token to the dependency renderer', () => {
    const html = renderTokenHtml({ type: 'text', value: 'plain' }, (token, index) => (
      <span data-default={String(index)}>{String(token.value ?? token.type)}</span>
    ));
    expect(html).toContain('data-default="0"');
    expect(html).toContain('plain');
  });
});
