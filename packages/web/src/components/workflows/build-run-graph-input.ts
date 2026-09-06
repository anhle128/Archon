import { ROUTE_LOOP_OUTCOMES, type DagNode, type RouteLoopConfig } from '@/lib/api';
import { layout, type LayoutEdge, type LayoutNode, type LayoutResult } from '@/lib/run-graph';
import type { WorkflowStepStatus } from '@/lib/types';

export interface RunGraphInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRouteLoopConfig(node: DagNode): RouteLoopConfig | null {
  const routeLoop = node.route_loop;
  if (!isRecord(routeLoop) || !isRecord(routeLoop.routes)) return null;
  if (typeof routeLoop.condition !== 'string' || typeof routeLoop.max_iterations !== 'number') {
    return null;
  }
  const { positive, negative, exhausted } = routeLoop.routes;
  if (
    typeof positive !== 'string' ||
    typeof negative !== 'string' ||
    typeof exhausted !== 'string'
  ) {
    return null;
  }
  return {
    condition: routeLoop.condition,
    max_iterations: routeLoop.max_iterations,
    routes: { positive, negative, exhausted },
  };
}

function toNodeState(status: WorkflowStepStatus): LayoutNode['nodeState'] {
  switch (status) {
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
    case 'skipped':
    case 'awaiting':
      return status;
  }
}

export function buildRunGraphInput(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): RunGraphInput {
  const statusById = new Map<string, WorkflowStepStatus>();
  for (const entry of liveStatus) {
    statusById.set(entry.nodeId, entry.status);
  }

  const nodes: LayoutNode[] = dagNodes.map(node => {
    const status = statusById.get(node.id);
    return {
      id: node.id,
      nodeState: status === undefined ? 'pending' : toNodeState(status),
    };
  });

  const edges: LayoutEdge[] = [];
  const edgeIds = new Set<string>();
  const routeTargetsByController = new Map<string, Set<string>>();
  const pushEdge = (edge: LayoutEdge): void => {
    edges.push(edge);
    edgeIds.add(edge.id);
  };

  for (const node of dagNodes) {
    const routeLoop = getRouteLoopConfig(node);
    if (!routeLoop) continue;
    const targets = new Set<string>();
    for (const outcome of ROUTE_LOOP_OUTCOMES) {
      const target = routeLoop.routes[outcome];
      if (target) targets.add(target);
    }
    routeTargetsByController.set(node.id, targets);
  }

  for (const node of dagNodes) {
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

    const routeLoop = getRouteLoopConfig(node);
    if (!routeLoop) continue;
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

  return { nodes, edges };
}

export function layoutRunGraph(
  dagNodes: readonly DagNode[],
  liveStatus: readonly { nodeId: string; status: WorkflowStepStatus }[]
): LayoutResult {
  return layout(buildRunGraphInput(dagNodes, liveStatus));
}
