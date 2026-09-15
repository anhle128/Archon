import { describe, test, expect } from 'bun:test';
import React from 'react';
import { roomOpenerId } from '@/lib/execution-room-model';
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

function classNameOf(el: React.ReactElement): string {
  const className = (el.props as { className?: unknown }).className;
  return typeof className === 'string' ? className : '';
}

function collectClassNames(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectClassNames);
  if (!React.isValidElement(node)) return [];
  const el = node as React.ReactElement<{ className?: unknown; children?: unknown }>;
  const own = typeof el.props.className === 'string' ? [el.props.className] : [];
  return [...own, ...collectClassNames(el.props.children)];
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

describe('ExecutionDagNode awaiting chrome', () => {
  test('renders awaiting warning border, waiting on you, and reduced-motion class', () => {
    const awaiting = render({
      nodeType: 'prompt',
      label: 'Review',
      status: 'awaiting',
    } as ExecutionNodeData);
    expect(classNameOf(awaiting)).toContain('border-warning');
    expect(classNameOf(awaiting)).toContain('bg-warning/5');
    expect(classNameOf(awaiting)).toContain('motion-reduce:animate-none');
    expect(collectText(awaiting)).toContain('waiting on you');

    const running = render({
      nodeType: 'prompt',
      label: 'Review',
      status: 'running',
    } as ExecutionNodeData);
    expect(classNameOf(running)).toContain('border-accent-bright');
    expect(collectText(running)).not.toContain('waiting on you');

    const failed = render({
      nodeType: 'prompt',
      label: 'Review',
      status: 'failed',
    } as ExecutionNodeData);
    expect(classNameOf(failed)).toContain('border-error');
    expect(collectText(failed)).not.toContain('waiting on you');
  });
});

describe('ExecutionDagNode graph opener', () => {
  test('roots the node with a legacy graph opener id, programmatic tabIndex, and token typography', () => {
    const openerId = roomOpenerId('legacy', 'graph', 'review/1');
    const el = render({
      nodeType: 'prompt',
      label: 'Review',
      openerId,
      duration: 1200,
    } as ExecutionNodeData);
    expect((el.props as { id?: string }).id).toBe(openerId);
    expect((el.props as { tabIndex?: number }).tabIndex).toBe(-1);
    const classes = collectClassNames(el).join(' ');
    expect(classes).toContain('text-[length:var(--rv-node-kind-size)]');
    expect(classes).toContain('text-[length:var(--rv-node-label-size)]');
    expect(classes).toContain('text-[length:var(--rv-node-meta-size)]');
  });
});
