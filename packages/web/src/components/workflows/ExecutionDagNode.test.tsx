import { describe, test, expect } from 'bun:test';
import React from 'react';
import { executionDagNode } from './ExecutionDagNode';
import type { ExecutionNodeData } from './ExecutionDagNode';

/** Concatenate every string/number descendant of a React element tree. */
function collectText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!React.isValidElement(node)) return '';
  const el = node as React.ReactElement<{ children?: unknown }>;
  return collectText(el.props?.children);
}

function render(data: ExecutionNodeData): React.ReactElement {
  const component = executionDagNode as unknown as {
    type: (props: { data: ExecutionNodeData }) => React.ReactElement;
  };
  return component.type({ data });
}

describe('ExecutionDagNode loop iteration display', () => {
  test('shows current/expected (max N) when expectedIterations is set', () => {
    const el = render({
      nodeType: 'loop',
      label: 'Ralph',
      currentIteration: 1,
      maxIterations: 100,
      expectedIterations: 20,
    } as ExecutionNodeData);
    expect(collectText(el)).toContain('1/20 (max 100)');
  });

  test('falls back to current/max iterations when expectedIterations is absent', () => {
    const el = render({
      nodeType: 'loop',
      label: 'Ralph',
      currentIteration: 1,
      maxIterations: 100,
    } as ExecutionNodeData);
    const text = collectText(el);
    expect(text).toContain('1/100 iterations');
    expect(text).not.toContain('(max');
  });
});
