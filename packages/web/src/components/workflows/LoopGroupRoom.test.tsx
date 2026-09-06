import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { LoopGroupChrome } from './select-room-data';
import { LoopGroupRoom } from './LoopGroupRoom';

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const chrome: LoopGroupChrome = {
  body: [
    { id: 'body', qualifiedId: 'group.body', dependsOn: [] },
    { id: 'check', qualifiedId: 'group.check', dependsOn: ['body'] },
  ],
  iterations: [
    {
      iteration: 1,
      status: 'completed',
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
        {
          id: 'check',
          qualifiedId: 'group.check',
          dependsOn: ['body'],
          status: 'completed',
        },
      ],
    },
    {
      iteration: 2,
      status: 'failed',
      body: [
        { id: 'body', qualifiedId: 'group.body', dependsOn: [], status: 'completed' },
        {
          id: 'check',
          qualifiedId: 'group.check',
          dependsOn: ['body'],
          status: 'failed',
        },
      ],
    },
  ],
  selectedIteration: 2,
};

describe('LoopGroupRoom', () => {
  test('renders authored topology and opens only the selected iteration', () => {
    const markup = renderToStaticMarkup(<LoopGroupRoom nodeId="group" chrome={chrome} />);
    const text = visibleText(markup);
    expect(markup).toContain('aria-label="group room"');
    expect(text).toContain('Loop group');
    expect(text).toContain('Body nodes');
    expect(text).toContain('body');
    expect(text).toContain('check');
    expect(text).toContain('Start');
    expect(text).toContain('After body');
    expect(text).toContain('×1 completed');
    expect(text).toContain('×2 failed');
    expect(text).toContain('group.body');
    expect(text).toContain('group.check');
    expect(markup.match(/<details[^>]*open/g)?.length).toBe(1);
    const openBlock = /<details[^>]*open[\s\S]*?<\/details>/.exec(markup);
    expect(openBlock?.[0]).toContain('×2 failed');
    expect(markup).not.toContain('chat-markdown');
    expect(markup).not.toContain('<svg');
  });

  test('keeps authored topology and uses the shared no-output copy when iterations are empty', () => {
    const emptyChrome: LoopGroupChrome = {
      body: chrome.body,
      iterations: [],
      selectedIteration: null,
    };
    const markup = renderToStaticMarkup(<LoopGroupRoom nodeId="group" chrome={emptyChrome} />);
    const text = visibleText(markup);
    expect(markup).toContain('aria-label="group room"');
    expect(text).toContain('Loop group');
    expect(text).toContain('Body nodes');
    expect(text).toContain('body');
    expect(text).toContain('check');
    expect(text).toContain('Start');
    expect(text).toContain('After body');
    expect(text).toContain("Node hasn't produced output");
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('chat-markdown');
    expect(markup).not.toContain('<svg');
  });
});
