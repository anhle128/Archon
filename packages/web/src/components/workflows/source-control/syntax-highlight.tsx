import hljs from 'highlight.js/lib/common';
import type { HunkData, HunkTokens, RenderToken, TokenNode } from 'react-diff-view';

export function highlightedHtml(raw: string): string {
  return hljs.highlightAuto(raw).value;
}

function highlightedToken(content: string): TokenNode[] {
  return [{ type: 'highlighted', value: highlightedHtml(content) }];
}

export function highlightDiffTokens(hunks: readonly HunkData[]): HunkTokens {
  const old: TokenNode[][] = [];
  const next: TokenNode[][] = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'insert') {
        next[change.lineNumber - 1] = highlightedToken(change.content);
      } else if (change.type === 'delete') {
        old[change.lineNumber - 1] = highlightedToken(change.content);
      } else {
        old[change.oldLineNumber - 1] = highlightedToken(change.content);
        next[change.newLineNumber - 1] = highlightedToken(change.content);
      }
    }
  }
  return { old, new: next };
}

export const renderHighlightedToken: RenderToken = (token, renderDefault, index) => {
  if (token.type !== 'highlighted' || typeof token.value !== 'string') {
    return renderDefault(token, index);
  }
  return <span key={index} dangerouslySetInnerHTML={{ __html: token.value }} />;
};
