import {
  BACK_EDGE_GUTTER,
  NODE_HEIGHT,
  NODE_WIDTH,
  PARALLEL_LANE,
  SIDE_PORT_THRESHOLD,
} from './constants';
import { isOnPath } from './taken-path';
import type { LayoutEdge, LayoutEdgeKind, LayoutRoute, NodeState, Point, PortSide } from './types';

export function buildRoutes(input: {
  positions: Readonly<Record<string, Point>>;
  layers: Readonly<Record<string, number>>;
  backEdgeIds: ReadonlySet<string>;
  edges: readonly LayoutEdge[];
  states: Readonly<Record<string, NodeState>>;
}): LayoutRoute[] {
  const skipLaneByEdgeId = assignSkipLanes(input);
  const parallelOffsetByEdgeId = assignParallelOffsets(input);
  const routes: LayoutRoute[] = [];
  for (const edge of input.edges) {
    if (!(edge.source in input.positions) || !(edge.target in input.positions)) {
      continue;
    }
    const sourcePos = input.positions[edge.source];
    const targetPos = input.positions[edge.target];
    const geometry =
      edge.source === edge.target
        ? selfGeometry(sourcePos)
        : input.backEdgeIds.has(edge.id)
          ? backGeometry(sourcePos, targetPos)
          : forwardGeometry(
              sourcePos,
              targetPos,
              input.layers[edge.source],
              input.layers[edge.target],
              skipLaneByEdgeId.get(edge.id) ?? 0,
              parallelOffsetByEdgeId.get(edge.id) ?? 0
            );
    const kind: LayoutEdgeKind = edge.kind ?? 'dependency';
    const route: LayoutRoute = {
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      kind,
      sourcePort: geometry.sourcePort,
      targetPort: geometry.targetPort,
      path: geometry.path,
      labelPosition: geometry.labelPosition,
      backEdge: input.backEdgeIds.has(edge.id),
      taken: isOnPath(input.states[edge.target]),
    };
    if (edge.label !== undefined) {
      route.label = edge.label;
    }
    if (edge.outcome !== undefined) {
      route.outcome = edge.outcome;
    }
    routes.push(route);
  }
  return routes;
}

interface RouteGeometry {
  sourcePort: PortSide;
  targetPort: PortSide;
  path: string;
  labelPosition: Point;
}

interface RouteInput {
  positions: Readonly<Record<string, Point>>;
  layers: Readonly<Record<string, number>>;
  backEdgeIds: ReadonlySet<string>;
  edges: readonly LayoutEdge[];
}

const OUTCOME_ORDER: Record<string, number> = {
  positive: 0,
  negative: 1,
  exhausted: 2,
};

function cubicPath(start: Point, control1: Point, control2: Point, end: Point): string {
  return `M ${start.x} ${start.y} C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`;
}

function bottomCenter(position: Point): Point {
  return { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT };
}

function topCenter(position: Point): Point {
  return { x: position.x + NODE_WIDTH / 2, y: position.y };
}

function leftCenter(position: Point): Point {
  return { x: position.x, y: position.y + NODE_HEIGHT / 2 };
}

function rightCenter(position: Point): Point {
  return { x: position.x + NODE_WIDTH, y: position.y + NODE_HEIGHT / 2 };
}

function centerX(position: Point): number {
  return position.x + NODE_WIDTH / 2;
}

function isCollinearSkip(edge: LayoutEdge, input: RouteInput): boolean {
  if (edge.source === edge.target) return false;
  if (input.backEdgeIds.has(edge.id)) return false;
  const sourcePos = input.positions[edge.source];
  const targetPos = input.positions[edge.target];
  if (sourcePos === undefined || targetPos === undefined) return false;
  const sourceLayer = input.layers[edge.source];
  const targetLayer = input.layers[edge.target];
  if (sourceLayer === undefined || targetLayer === undefined) return false;
  if (Math.abs(targetLayer - sourceLayer) <= 1) return false;
  return Math.abs(centerX(targetPos) - centerX(sourcePos)) <= SIDE_PORT_THRESHOLD;
}

function assignSkipLanes(input: RouteInput): Map<string, number> {
  const lanes = new Map<string, number>();
  let next = 0;
  for (const edge of input.edges) {
    if (!isCollinearSkip(edge, input)) continue;
    lanes.set(edge.id, next);
    next += 1;
  }
  return lanes;
}

function assignParallelOffsets(input: RouteInput): Map<string, number> {
  const groups = new Map<string, LayoutEdge[]>();
  for (const edge of input.edges) {
    if (edge.source === edge.target) continue;
    if (input.backEdgeIds.has(edge.id)) continue;
    if (!(edge.source in input.positions) || !(edge.target in input.positions)) continue;
    if (isCollinearSkip(edge, input)) continue;
    const key = `${edge.source}\0${edge.target}`;
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => {
      const outcomeDelta =
        (OUTCOME_ORDER[left.outcome ?? ''] ?? 3) - (OUTCOME_ORDER[right.outcome ?? ''] ?? 3);
      if (outcomeDelta !== 0) return outcomeDelta;
      return left.id.localeCompare(right.id);
    });
    const mid = (group.length - 1) / 2;
    for (let index = 0; index < group.length; index += 1) {
      offsets.set(group[index].id, (index - mid) * PARALLEL_LANE);
    }
  }
  return offsets;
}

function adjacentGeometry(
  sourcePos: Point,
  targetPos: Point,
  parallelOffset: number
): RouteGeometry {
  const start = bottomCenter(sourcePos);
  const end = topCenter(targetPos);
  const bend = Math.max(18, (end.y - start.y) * 0.45);
  return {
    sourcePort: 'bottom',
    targetPort: 'top',
    path: cubicPath(
      start,
      { x: start.x + parallelOffset, y: start.y + bend },
      { x: end.x + parallelOffset, y: end.y - bend },
      end
    ),
    labelPosition: {
      x: (start.x + end.x) / 2 + 8 + parallelOffset,
      y: (start.y + end.y) / 2,
    },
  };
}

function skipGeometry(sourcePos: Point, targetPos: Point, laneIndex: number): RouteGeometry {
  const start = bottomCenter(sourcePos);
  const end = rightCenter(targetPos);
  const lane = sourcePos.x + NODE_WIDTH + BACK_EDGE_GUTTER + laneIndex * BACK_EDGE_GUTTER;
  return {
    sourcePort: 'bottom',
    targetPort: 'right',
    path: cubicPath(start, { x: lane, y: start.y }, { x: lane, y: end.y }, end),
    labelPosition: { x: lane + 4, y: (start.y + end.y) / 2 },
  };
}

function forwardGeometry(
  sourcePos: Point,
  targetPos: Point,
  sourceLayer: number,
  targetLayer: number,
  skipLane: number,
  parallelOffset: number
): RouteGeometry {
  const dx = centerX(targetPos) - centerX(sourcePos);
  if (Math.abs(targetLayer - sourceLayer) <= 1) {
    return adjacentGeometry(sourcePos, targetPos, parallelOffset);
  }
  if (Math.abs(dx) > SIDE_PORT_THRESHOLD) {
    const direction = Math.sign(dx);
    const end = direction < 0 ? rightCenter(targetPos) : leftCenter(targetPos);
    const start = bottomCenter(sourcePos);
    const sourceBend = Math.max(24, (end.y - start.y) * 0.5);
    const targetBend = Math.max(40, Math.abs(dx) * 0.35);
    return {
      sourcePort: 'bottom',
      targetPort: direction < 0 ? 'right' : 'left',
      path: cubicPath(
        start,
        { x: start.x, y: start.y + sourceBend },
        { x: end.x - direction * targetBend, y: end.y },
        end
      ),
      labelPosition: {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - 8,
      },
    };
  }
  return skipGeometry(sourcePos, targetPos, skipLane);
}

function backGeometry(sourcePos: Point, targetPos: Point): RouteGeometry {
  const start = leftCenter(sourcePos);
  const end = leftCenter(targetPos);
  const lane = Math.min(sourcePos.x, targetPos.x) - BACK_EDGE_GUTTER;
  return {
    sourcePort: 'left',
    targetPort: 'left',
    path: cubicPath(start, { x: lane, y: start.y }, { x: lane, y: end.y }, end),
    labelPosition: { x: lane + 4, y: (start.y + end.y) / 2 },
  };
}

function selfGeometry(sourcePos: Point): RouteGeometry {
  const start = leftCenter(sourcePos);
  const end = topCenter(sourcePos);
  const lane = sourcePos.x - BACK_EDGE_GUTTER;
  const topLane = sourcePos.y - BACK_EDGE_GUTTER;
  return {
    sourcePort: 'left',
    targetPort: 'top',
    path: cubicPath(start, { x: lane, y: start.y }, { x: lane, y: topLane }, end),
    labelPosition: { x: lane, y: topLane },
  };
}
