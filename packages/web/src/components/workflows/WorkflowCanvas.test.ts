import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { dagNodesToReactFlow, reactFlowToDagNodes } from './WorkflowCanvas';
import type { DagNode } from '@/lib/api';
import type { DagFlowNode } from './DagNodeComponent';

describe('reactFlowToDagNodes route_loop serialization', () => {
  test('uses route_loop node data instead of stale route edges', () => {
    const nodes = [
      {
        id: 'review-router',
        type: 'dagNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'review-router',
          label: 'Route',
          nodeType: 'route_loop',
          depends_on: ['new-review'],
          route_loop: {
            condition: "$new-review.output.result == 'positive'",
            max_iterations: 3,
            routes: {
              positive: 'done-from-inspector',
              negative: 'fix',
              exhausted: 'escalate',
            },
          },
        },
      },
    ] as DagFlowNode[];
    const edges = [
      {
        id: 'old-review->review-router',
        source: 'old-review',
        target: 'review-router',
      },
      {
        id: 'review-router->stale-done:positive',
        source: 'review-router',
        sourceHandle: 'positive',
        target: 'stale-done',
      },
    ] satisfies Edge[];

    const [routeNode] = reactFlowToDagNodes(nodes, edges);

    expect(routeNode.depends_on).toEqual(['old-review']);
    expect('route_loop' in routeNode).toBe(true);
    if (!('route_loop' in routeNode)) throw new Error('expected route_loop node');
    expect(routeNode.route_loop).toMatchObject({
      routes: {
        positive: 'done-from-inspector',
        negative: 'fix',
        exhausted: 'escalate',
      },
    });
  });
});

describe('reactFlowToDagNodes read-only node passthrough', () => {
  test('preserves nested plannotator gate and cancel payloads', () => {
    const original: DagNode[] = [
      { id: 'prepare', prompt: 'Prepare the review.' },
      {
        id: 'review-gate',
        depends_on: ['prepare'],
        plannotator_gate: {
          prepare: {
            prompt: 'Build $prepare.output into review.html.',
            provider: 'claude',
            model: 'sonnet',
            effort: 'medium',
            allowed_tools: ['Read', 'Edit'],
          },
          message: 'Review the generated document.',
          capture_response: true,
          rework: {
            prompt: 'Apply $REVIEW_ANNOTATIONS to $REVIEW_DOCUMENT.',
            provider: 'codex',
            model: 'gpt-5.6-terra',
            effort: 'high',
          },
        },
      },
      {
        id: 'abort',
        depends_on: ['review-gate'],
        cancel: 'Reviewer rejected the workflow.',
      },
    ];

    const flow = dagNodesToReactFlow(original);
    const roundTripped = reactFlowToDagNodes(flow.nodes, flow.edges);

    expect(JSON.parse(JSON.stringify(roundTripped))).toEqual(original);
  });
});
