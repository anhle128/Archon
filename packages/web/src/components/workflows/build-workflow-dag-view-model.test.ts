import { describe, expect, test } from 'bun:test';
import { MarkerType } from '@xyflow/react';
import type { DagNode } from '@/lib/api';
import { roomOpenerId } from '@/lib/execution-room-model';
import type { DagNodeState } from '@/lib/types';
import { layoutRunGraph } from './build-run-graph-input';
import { buildWorkflowDagViewModel } from './build-workflow-dag-view-model';

function live(
  nodeId: string,
  status: DagNodeState['status'],
  extra: Partial<DagNodeState> = {}
): DagNodeState {
  return { nodeId, name: nodeId, status, ...extra };
}

describe('buildWorkflowDagViewModel', () => {
  test('every definition node receives the pure layout position', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
    ];
    const liveStatus = [live('a', 'completed'), live('b', 'running')];
    const layout = layoutRunGraph(dagNodes, liveStatus);
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus,
      selectedNodeId: null,
    });
    expect(model.nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(model.nodes[0].position).toEqual(layout.positions.a);
    expect(model.nodes[1].position).toEqual(layout.positions.b);
  });

  test('each node data receives a legacy graph opener id', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'review/1', prompt: 'n' },
    ];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [],
      selectedNodeId: null,
    });
    expect(model.nodes.map(node => node.data.openerId)).toEqual([
      roomOpenerId('legacy', 'graph', 'a'),
      roomOpenerId('legacy', 'graph', 'review/1'),
    ]);
  });

  test('missing live status remains pending without changing the definition label', () => {
    const dagNodes: DagNode[] = [{ id: 'prompt-node', prompt: 'Write the spec.' }];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [],
      selectedNodeId: null,
    });
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].data.label).toBe('prompt-node');
    expect(model.nodes[0].data.status).toBeUndefined();
    expect(model.nodes[0].data.nodeType).toBe('prompt');
  });

  test('live status metadata is preserved exactly as the current viewer preserves it', () => {
    const dagNodes: DagNode[] = [{ id: 'work', prompt: 'Do work.' }];
    const liveStatus = [
      live('work', 'failed', {
        duration: 1200,
        error: 'boom',
        currentIteration: 2,
        maxIterations: 5,
        expectedIterations: 3,
        routeDecision: { outcome: 'negative', to: 'fix' },
        provider: 'claude',
        model: 'opus',
        tier: 'large',
        modelReasoningEffort: 'high',
        effort: 'high',
        thinking: { type: 'enabled', budgetTokens: 8000 },
      }),
    ];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus,
      selectedNodeId: 'work',
    });
    const data = model.nodes[0].data;
    expect(data.status).toBe('failed');
    expect(data.duration).toBe(1200);
    expect(data.error).toBe('boom');
    expect(data.currentIteration).toBe(2);
    expect(data.maxIterations).toBe(5);
    expect(data.expectedIterations).toBe(3);
    expect(data.routeDecision).toEqual({ outcome: 'negative', to: 'fix' });
    expect(data.provider).toBe('claude');
    expect(data.model).toBe('opus');
    expect(data.tier).toBe('large');
    expect(data.modelReasoningEffort).toBe('high');
    expect(data.effort).toBe('high');
    expect(data.thinking).toEqual({ type: 'enabled', budgetTokens: 8000 });
    expect(data.selected).toBe(true);
    expect(model.nodes[0].selected).toBe(true);
  });

  test('changing only statuses changes taken and animation without changing positions', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
    ];
    const pending = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [live('a', 'pending'), live('b', 'pending')],
      selectedNodeId: null,
    });
    const running = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [live('a', 'completed'), live('b', 'running')],
      selectedNodeId: null,
    });
    expect(pending.nodes.map(node => node.position)).toEqual(
      running.nodes.map(node => node.position)
    );
    expect(pending.edges[0].data?.route.taken).toBe(false);
    expect(pending.edges[0].animated).toBe(false);
    expect(running.edges[0].data?.route.taken).toBe(true);
    expect(running.edges[0].animated).toBe(true);
  });

  test('skipped target is not taken and is not animated', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], prompt: 'n' },
    ];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [live('a', 'completed'), live('b', 'skipped')],
      selectedNodeId: null,
    });
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].data?.route.taken).toBe(false);
    expect(model.edges[0].animated).toBe(false);
  });

  test('every edge uses runGraphRoute type, route data, label, and an arrow marker', () => {
    const dagNodes: DagNode[] = [
      { id: 'a', prompt: 'n' },
      { id: 'b', depends_on: ['a'], when: '$a.output.ok', prompt: 'n' },
    ];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [],
      selectedNodeId: null,
    });
    expect(model.edges).toHaveLength(1);
    const edge = model.edges[0];
    expect(edge.type).toBe('runGraphRoute');
    expect(edge.data?.route).toEqual(
      expect.objectContaining({
        edgeId: 'a->b',
        source: 'a',
        target: 'b',
        kind: 'conditional',
        label: '$a.output.ok',
      })
    );
    expect(edge.label).toBe('$a.output.ok');
    expect(edge.markerEnd).toEqual({ type: MarkerType.ArrowClosed });
  });

  test('retry cycle produces progressive y coordinates and one back edge', () => {
    const dagNodes: DagNode[] = [
      { id: 'start', prompt: 'n' },
      { id: 'work', depends_on: ['start', 'review'], prompt: 'n' },
      { id: 'review', depends_on: ['work'], prompt: 'n' },
    ];
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus: [live('start', 'completed'), live('work', 'running'), live('review', 'pending')],
      selectedNodeId: null,
    });
    const byId = Object.fromEntries(model.nodes.map(node => [node.id, node]));
    expect(byId.work.position.y).toBeGreaterThan(byId.start.position.y);
    expect(byId.review.position.y).toBeGreaterThan(byId.work.position.y);
    const back = model.edges.filter(edge => edge.data?.route.backEdge);
    expect(back).toHaveLength(1);
    expect(back[0].source).toBe('review');
    expect(back[0].target).toBe('work');
  });
});
