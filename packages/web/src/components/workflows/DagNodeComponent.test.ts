import { describe, test, expect } from 'bun:test';
import React from 'react';
import { dagNodeComponent, getContentPreview } from './DagNodeComponent';
import type { DagNodeData } from './DagNodeComponent';

describe('getContentPreview', () => {
  test('loop node with multi-line prompt returns first line only', () => {
    const data: DagNodeData = {
      id: 'n1',
      label: 'Loop',
      nodeType: 'loop',
      promptText: 'first line\nsecond line\nthird line',
    };
    expect(getContentPreview(data)).toBe('first line');
  });

  test('approval node returns empty string', () => {
    const data: DagNodeData = {
      id: 'n2',
      label: 'Approval',
      nodeType: 'approval',
      approval: { message: 'Please approve' },
    };
    expect(getContentPreview(data)).toBe('');
  });

  test('plannotator gate and cancel previews use their actual content', () => {
    const gate: DagNodeData = {
      id: 'review',
      label: 'Plannotator Gate',
      nodeType: 'plannotator_gate',
      plannotator_gate: {
        document: 'review.html',
        message: 'Review this document.\nThen approve it.',
        rework: { prompt: 'Apply annotations.' },
      },
    };
    const cancel: DagNodeData = {
      id: 'abort',
      label: 'Cancel',
      nodeType: 'cancel',
      cancel: 'Stop this run.\nInvestigate first.',
    };

    expect(getContentPreview(gate)).toBe('Review this document.');
    expect(getContentPreview(cancel)).toBe('Stop this run.');
  });
});

interface ElementWithChildren {
  props?: {
    children?: unknown;
    type?: string;
    id?: string;
  };
}

function collectHandleProps(node: unknown): Array<{ type?: string; id?: string }> {
  if (Array.isArray(node)) {
    return node.flatMap(child => collectHandleProps(child));
  }

  if (!React.isValidElement(node)) {
    return [];
  }

  const element = node as React.ReactElement<ElementWithChildren['props']>;
  const ownHandle =
    element.props?.type === 'target' || element.props?.type === 'source'
      ? [{ type: element.props.type, id: element.props.id }]
      : [];

  return [...ownHandle, ...collectHandleProps(element.props?.children)];
}

function renderDagNode(data: DagNodeData): React.ReactElement {
  const component = dagNodeComponent as unknown as {
    type: (props: { data: DagNodeData; selected: boolean }) => React.ReactElement;
  };
  return component.type({ data, selected: false });
}

describe('dagNodeComponent route-loop handles', () => {
  test('renders one input handle and three labeled route output handles for route-loop nodes', () => {
    const data = {
      id: 'review-router',
      label: 'Review Router',
      nodeType: 'route_loop',
      route_loop: {
        condition: '$review.output.approved == true',
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalate',
        },
        max_iterations: 2,
      },
    } as unknown as DagNodeData;

    const handles = collectHandleProps(renderDagNode(data));

    expect(handles.filter(handle => handle.type === 'target')).toHaveLength(1);
    expect(
      handles
        .filter(handle => handle.type === 'source')
        .map(handle => handle.id)
        .sort()
    ).toEqual(['exhausted', 'negative', 'positive']);
  });
});
