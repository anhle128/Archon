import { MarkerType } from '@xyflow/react';
import type { DagNode } from '@/lib/api';
import { resolveExecutionNodeDisplay } from '@/lib/dag-layout';
import type { Point } from '@/lib/run-graph';
import type { DagNodeState } from '@/lib/types';
import { layoutRunGraph } from './build-run-graph-input';
import type { ExecutionFlowNode } from './ExecutionDagNode';
import type { RunGraphFlowEdge } from './RunGraphRouteEdge';

export interface WorkflowDagViewModel {
  nodes: ExecutionFlowNode[];
  edges: RunGraphFlowEdge[];
}

function requiredPosition(positions: Readonly<Record<string, Point>>, id: string): Point {
  const position = positions[id];
  if (position === undefined) {
    throw new Error(`Missing run-graph position for node "${id}"`);
  }
  return position;
}

export function buildWorkflowDagViewModel(input: {
  dagNodes: readonly DagNode[];
  liveStatus: readonly DagNodeState[];
  selectedNodeId: string | null;
}): WorkflowDagViewModel {
  const layout = layoutRunGraph(input.dagNodes, input.liveStatus);
  const statusMap = new Map<string, DagNodeState>();
  for (const node of input.liveStatus) {
    statusMap.set(node.nodeId, node);
  }

  const nodes: ExecutionFlowNode[] = input.dagNodes.map(dagNode => {
    const live = statusMap.get(dagNode.id);
    const display = resolveExecutionNodeDisplay(dagNode);
    const selected = dagNode.id === input.selectedNodeId;
    return {
      id: dagNode.id,
      type: 'executionNode',
      position: requiredPosition(layout.positions, dagNode.id),
      selected,
      data: {
        ...dagNode,
        ...display,
        status: live?.status,
        duration: live?.duration,
        error: live?.error,
        selected,
        currentIteration: live?.currentIteration,
        maxIterations: live?.maxIterations,
        expectedIterations: live?.expectedIterations,
        routeDecision: live?.routeDecision,
        provider: live?.provider,
        model: live?.model,
        tier: live?.tier,
        modelReasoningEffort: live?.modelReasoningEffort,
        effort: live?.effort,
        thinking: live?.thinking,
      },
    };
  });

  const edges: RunGraphFlowEdge[] = layout.routes.map(route => {
    const edge: RunGraphFlowEdge = {
      id: route.edgeId,
      source: route.source,
      target: route.target,
      type: 'runGraphRoute',
      animated: statusMap.get(route.target)?.status === 'running',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { route },
    };
    if (route.label !== undefined) {
      edge.label = route.label;
    }
    return edge;
  });

  return { nodes, edges };
}
