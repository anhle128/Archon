import {
  layout,
  type LayoutEdge,
  type LayoutNode,
  type LayoutRoute,
  type NodeState,
  type Point,
} from '@/lib/run-graph';
import type { DagNode } from '../../skills/workflows';
import type { WorkflowNodeState } from '../../skills/runs';
import { inspectStatus } from '../inspect/inspect-status';

const ROUTE_LOOP_OUTCOMES = ['positive', 'negative', 'exhausted'] as const;

export interface ConsoleGraphNode {
  definition: DagNode;
  nodeState: NodeState;
}

export interface ConsoleGraphModel {
  nodes: ConsoleGraphNode[];
  edges: LayoutEdge[];
  positions: Record<string, Point>;
  routes: LayoutRoute[];
}

function toLayoutNodeState(status: WorkflowNodeState['status']): NodeState {
  return inspectStatus(status);
}

export function buildRunGraphInput(
  nodes: readonly DagNode[],
  nodeStates: readonly WorkflowNodeState[]
): ConsoleGraphModel {
  const statusById = new Map<string, WorkflowNodeState['status']>();
  for (const entry of nodeStates) {
    statusById.set(entry.nodeId, entry.status);
  }

  const graphNodes: ConsoleGraphNode[] = nodes.map(definition => {
    const status = statusById.get(definition.id);
    return {
      definition,
      nodeState: status === undefined ? 'pending' : toLayoutNodeState(status),
    };
  });

  const edges: LayoutEdge[] = [];
  const edgeIds = new Set<string>();
  const routeTargetsByController = new Map<string, Set<string>>();
  const pushEdge = (edge: LayoutEdge): void => {
    edges.push(edge);
    edgeIds.add(edge.id);
  };

  for (const node of nodes) {
    const routeLoop = node.route_loop;
    if (routeLoop === undefined) continue;
    const targets = new Set<string>();
    for (const outcome of ROUTE_LOOP_OUTCOMES) {
      const target = routeLoop.routes[outcome];
      if (target) targets.add(target);
    }
    routeTargetsByController.set(node.id, targets);
  }

  for (const node of nodes) {
    const when = node.when;
    const conditional = typeof when === 'string' && when.length > 0;
    for (const dependency of node.depends_on ?? []) {
      if (routeTargetsByController.get(dependency)?.has(node.id)) continue;
      if (conditional) {
        pushEdge({
          id: `${dependency}->${node.id}`,
          source: dependency,
          target: node.id,
          kind: 'conditional',
          label: when,
        });
      } else {
        pushEdge({
          id: `${dependency}->${node.id}`,
          source: dependency,
          target: node.id,
          kind: 'dependency',
        });
      }
    }

    const routeLoop = node.route_loop;
    if (routeLoop === undefined) continue;
    for (const outcome of [...ROUTE_LOOP_OUTCOMES].reverse()) {
      const target = routeLoop.routes[outcome];
      if (!target) continue;
      const baseId = `${node.id}->${target}`;
      pushEdge({
        id: edgeIds.has(baseId) ? `${baseId}:${outcome}` : baseId,
        source: node.id,
        target,
        kind: 'route',
        label: outcome,
        outcome,
      });
    }
  }

  const layoutNodes: LayoutNode[] = graphNodes.map(node => ({
    id: node.definition.id,
    nodeState: node.nodeState,
  }));
  const laidOut = layout({ nodes: layoutNodes, edges });

  return {
    nodes: graphNodes,
    edges,
    positions: laidOut.positions,
    routes: laidOut.routes,
  };
}
