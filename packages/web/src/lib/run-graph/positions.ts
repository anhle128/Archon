import { NODE_HEIGHT, NODE_SEP, NODE_WIDTH, RANK_SEP } from './constants';
import type { LayoutEdge, Point } from './types';

export interface PositionResult {
  positions: Record<string, Point>;
  layers: Record<string, number>;
  backEdgeIds: ReadonlySet<string>;
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

const HORIZONTAL_GAP = NODE_WIDTH + NODE_SEP;
const VERTICAL_GAP = NODE_HEIGHT + RANK_SEP;

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error('Missing layout map entry');
  }
  return value;
}

export function computePositions(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[]
): PositionResult {
  const ids: string[] = [];
  const firstSeenIndex = new Map<string, number>();
  for (const id of nodeIds) {
    if (!firstSeenIndex.has(id)) {
      firstSeenIndex.set(id, ids.length);
      ids.push(id);
    }
  }

  const backEdgeIds = new Set<string>();
  if (ids.length === 0) {
    return { positions: {}, layers: {}, backEdgeIds };
  }

  const idSet: ReadonlySet<string> = new Set(ids);
  const validEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    if (idSet.has(edge.source) && idSet.has(edge.target)) {
      validEdges.push(edge);
    }
  }

  const adjacency = new Map<string, LayoutEdge[]>();
  for (const id of ids) {
    adjacency.set(id, []);
  }
  for (const edge of validEdges) {
    requiredMapValue(adjacency, edge.source).push(edge);
  }

  const color = new Map<string, number>();
  for (const id of ids) {
    color.set(id, WHITE);
  }

  const dfs = (u: string): void => {
    color.set(u, GRAY);
    for (const edge of requiredMapValue(adjacency, u)) {
      if (edge.source === edge.target) {
        backEdgeIds.add(edge.id);
        continue;
      }
      const targetColor = requiredMapValue(color, edge.target);
      if (targetColor === GRAY) {
        backEdgeIds.add(edge.id);
      } else if (targetColor === WHITE) {
        dfs(edge.target);
      }
    }
    color.set(u, BLACK);
  };

  for (const id of ids) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  const forwardEdges: LayoutEdge[] = [];
  for (const edge of validEdges) {
    if (!backEdgeIds.has(edge.id)) {
      forwardEdges.push(edge);
    }
  }

  const layer = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const forwardAdjacency = new Map<string, LayoutEdge[]>();
  for (const id of ids) {
    layer.set(id, 0);
    inDegree.set(id, 0);
    forwardAdjacency.set(id, []);
  }
  for (const edge of forwardEdges) {
    requiredMapValue(forwardAdjacency, edge.source).push(edge);
    inDegree.set(edge.target, requiredMapValue(inDegree, edge.target) + 1);
  }

  const queue: string[] = [];
  for (const id of ids) {
    if (inDegree.get(id) === 0) {
      queue.push(id);
    }
  }

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const source = queue[queueIndex];
    queueIndex += 1;
    const sourceLayer = requiredMapValue(layer, source);
    for (const edge of requiredMapValue(forwardAdjacency, source)) {
      const nextLayer = Math.max(requiredMapValue(layer, edge.target), sourceLayer + 1);
      layer.set(edge.target, nextLayer);
      const remaining = requiredMapValue(inDegree, edge.target) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) {
        queue.push(edge.target);
      }
    }
  }

  let maxLayer = 0;
  for (const id of ids) {
    maxLayer = Math.max(maxLayer, requiredMapValue(layer, id));
  }

  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i += 1) {
    layers.push([]);
  }
  for (const id of ids) {
    layers[requiredMapValue(layer, id)].push(id);
  }

  const positionInLayer = new Map<string, number>();
  const assignPositions = (): void => {
    for (const layerNodes of layers) {
      for (let index = 0; index < layerNodes.length; index += 1) {
        positionInLayer.set(layerNodes[index], index);
      }
    }
  };
  assignPositions();

  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const id of ids) {
    predecessors.set(id, []);
    successors.set(id, []);
  }
  for (const edge of forwardEdges) {
    requiredMapValue(predecessors, edge.target).push(edge.source);
    requiredMapValue(successors, edge.source).push(edge.target);
  }

  const barycenter = (id: string, neighbors: readonly string[]): number => {
    if (neighbors.length === 0) {
      return requiredMapValue(positionInLayer, id);
    }
    let sum = 0;
    for (const neighbor of neighbors) {
      sum += requiredMapValue(positionInLayer, neighbor);
    }
    return sum / neighbors.length;
  };

  const sortLayer = (
    layerNodes: string[],
    neighborsOf: (id: string) => readonly string[]
  ): void => {
    layerNodes.sort((left: string, right: string) => {
      const delta = barycenter(left, neighborsOf(left)) - barycenter(right, neighborsOf(right));
      if (delta !== 0) {
        return delta;
      }
      return requiredMapValue(firstSeenIndex, left) - requiredMapValue(firstSeenIndex, right);
    });
  };

  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let i = 1; i < layers.length; i += 1) {
      const sorted = layers[i];
      sortLayer(sorted, (id: string) => requiredMapValue(predecessors, id));
      for (let index = 0; index < sorted.length; index += 1) {
        positionInLayer.set(sorted[index], index);
      }
    }
    for (let i = layers.length - 2; i >= 0; i -= 1) {
      const sorted = layers[i];
      sortLayer(sorted, (id: string) => requiredMapValue(successors, id));
      for (let index = 0; index < sorted.length; index += 1) {
        positionInLayer.set(sorted[index], index);
      }
    }
  }

  let maxWidth = 0;
  for (const layerNodes of layers) {
    maxWidth = Math.max(maxWidth, layerNodes.length);
  }
  const fullWidth = maxWidth * HORIZONTAL_GAP - NODE_SEP;

  const positions: Record<string, Point> = {};
  const layersOut: Record<string, number> = {};
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layerNodes = layers[layerIndex];
    const layerWidth = layerNodes.length * HORIZONTAL_GAP - NODE_SEP;
    const originX = (fullWidth - layerWidth) / 2;
    for (let index = 0; index < layerNodes.length; index += 1) {
      const id = layerNodes[index];
      positions[id] = {
        x: originX + index * HORIZONTAL_GAP,
        y: layerIndex * VERTICAL_GAP,
      };
      layersOut[id] = layerIndex;
    }
  }

  return { positions, layers: layersOut, backEdgeIds };
}
