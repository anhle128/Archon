import { computePositions } from './positions';
import { buildRoutes } from './routes';
import type { LayoutInput, LayoutResult, NodeState } from './types';

export function layout(input: LayoutInput): LayoutResult {
  const nodeIds: string[] = [];
  const states: Record<string, NodeState> = {};
  for (const node of input.nodes) {
    nodeIds.push(node.id);
    states[node.id] = node.nodeState;
  }
  const { positions, layers, backEdgeIds } = computePositions(nodeIds, input.edges);
  return {
    positions,
    routes: buildRoutes({
      positions,
      layers,
      backEdgeIds,
      edges: input.edges,
      states,
    }),
  };
}
