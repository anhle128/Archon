import type { LayoutEdge } from './types';

export function withElseSiblings(edges: readonly LayoutEdge[]): readonly LayoutEdge[] {
  const sourcesWithConditional = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'conditional') {
      sourcesWithConditional.add(edge.source);
    }
  }
  if (sourcesWithConditional.size === 0) {
    return edges;
  }
  return edges.map(edge => {
    if (edge.kind !== 'dependency') return edge;
    if (!sourcesWithConditional.has(edge.source)) return edge;
    const tagged: LayoutEdge = { ...edge };
    if (tagged.label === undefined) {
      tagged.label = 'else';
    }
    if (tagged.outcome === undefined) {
      tagged.outcome = 'negative';
    }
    return tagged;
  });
}
