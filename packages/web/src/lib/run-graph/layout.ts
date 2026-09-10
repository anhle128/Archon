import { withElseSiblings } from './else-edges';
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
  const edges = withElseSiblings(input.edges);
  const { positions, layers, backEdgeIds } = computePositions(nodeIds, edges);
  return {
    positions,
    routes: buildRoutes({
      positions,
      layers,
      backEdgeIds,
      edges,
      states,
    }),
  };
}
