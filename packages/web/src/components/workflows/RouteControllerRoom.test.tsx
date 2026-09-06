import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { RouteDecisionView } from './select-room-data';
import { RouteControllerRoom } from './RouteControllerRoom';

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('RouteControllerRoom', () => {
  test('renders the selected routing decision without an agent timeline', () => {
    const decision: RouteDecisionView = {
      outcome: 'negative',
      to: 'fix',
      condition: '$review.output.approved == true',
      conditionResult: 'false',
      attempt: '2',
      executionSeq: '4',
      negativeCount: '1',
      maxIterations: '3',
    };
    const markup = renderToStaticMarkup(
      <RouteControllerRoom nodeId="router" decision={decision} />
    );
    const text = visibleText(markup);
    expect(markup).toContain('aria-label="router room"');
    expect(text).toContain('Routing decision');
    expect(text).toContain('negative');
    expect(text).toContain('fix');
    expect(text).toContain('$review.output.approved == true');
    expect(text).toContain('false');
    expect(text).toContain('2');
    expect(text).toContain('4');
    expect(text).toContain('1');
    expect(text).toContain('3');
    expect(markup).not.toContain('chat-markdown');
  });

  test('uses the shared no-output copy for a missing routing decision', () => {
    const markup = renderToStaticMarkup(<RouteControllerRoom nodeId="router" decision={null} />);
    expect(visibleText(markup)).toContain("Node hasn't produced output");
    expect(markup).toContain('aria-label="router room"');
  });

  test('omits undefined and null optional fields', () => {
    const decision: RouteDecisionView = {
      outcome: 'positive',
      to: null,
      condition: null,
      conditionResult: 'true',
      attempt: null,
      executionSeq: '1',
      negativeCount: null,
      maxIterations: null,
    };
    const markup = renderToStaticMarkup(
      <RouteControllerRoom nodeId="router" decision={decision} />
    );
    const text = visibleText(markup);
    expect(text).toContain('Outcome');
    expect(text).toContain('positive');
    expect(text).toContain('Condition result');
    expect(text).toContain('true');
    expect(text).toContain('Execution');
    expect(text).toContain('1');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).not.toContain('object Object');
    expect(text).not.toContain('Target');
    expect(text).not.toContain('Attempt');
    expect(text).not.toContain('Negative count');
    expect(text).not.toContain('Maximum iterations');
  });
});
