import { describe, expect, test } from 'bun:test';
import { withElseSiblings } from './else-edges';
import type { LayoutEdge } from './types';

describe('withElseSiblings', () => {
  test('tags a dependency sibling of a conditional as else', () => {
    const edges: LayoutEdge[] = [
      {
        id: 'check->respond',
        source: 'check',
        target: 'respond',
        kind: 'conditional',
        label: "$check.output == 'HAS_QUESTIONS'",
      },
      { id: 'check->red', source: 'check', target: 'red', kind: 'dependency' },
      { id: 'respond->red', source: 'respond', target: 'red', kind: 'dependency' },
    ];
    const tagged = withElseSiblings(edges);
    expect(tagged[1]).toMatchObject({
      id: 'check->red',
      label: 'else',
      outcome: 'negative',
    });
    expect(tagged[2]).toEqual(edges[2]);
    expect(tagged[0]).toEqual(edges[0]);
  });

  test('does not mutate the input edges', () => {
    const edges: LayoutEdge[] = [
      { id: 'a->b', source: 'a', target: 'b', kind: 'conditional', label: 'when' },
      { id: 'a->c', source: 'a', target: 'c', kind: 'dependency' },
    ];
    withElseSiblings(edges);
    expect(edges[1].label).toBeUndefined();
    expect(edges[1].outcome).toBeUndefined();
  });

  test('keeps an existing label on the skip edge', () => {
    const edges: LayoutEdge[] = [
      { id: 'a->b', source: 'a', target: 'b', kind: 'conditional', label: 'when' },
      { id: 'a->c', source: 'a', target: 'c', kind: 'dependency', label: 'NO_QUESTIONS' },
    ];
    expect(withElseSiblings(edges)[1]).toMatchObject({
      label: 'NO_QUESTIONS',
      outcome: 'negative',
    });
  });
});
