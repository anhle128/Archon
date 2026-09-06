import { BACK_EDGE_GUTTER, NODE_HEIGHT, NODE_WIDTH, SIDE_PORT_THRESHOLD } from './constants';
import { isOnPath } from './taken-path';
import type { LayoutEdge, LayoutEdgeKind, LayoutRoute, NodeState, Point, PortSide } from './types';

export function buildRoutes(input: {
  positions: Readonly<Record<string, Point>>;
  layers: Readonly<Record<string, number>>;
  backEdgeIds: ReadonlySet<string>;
  edges: readonly LayoutEdge[];
  states: Readonly<Record<string, NodeState>>;
}): LayoutRoute[] {
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
              input.layers[edge.target]
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

function forwardGeometry(
  sourcePos: Point,
  targetPos: Point,
  sourceLayer: number,
  targetLayer: number
): RouteGeometry {
  const start = bottomCenter(sourcePos);
  const sourceCenterX = centerX(sourcePos);
  const targetCenterX = centerX(targetPos);
  const dx = targetCenterX - sourceCenterX;
  const shortEdge = Math.abs(targetLayer - sourceLayer) <= 1 || Math.abs(dx) <= SIDE_PORT_THRESHOLD;
  if (shortEdge) {
    const end = topCenter(targetPos);
    const bend = Math.max(18, (end.y - start.y) * 0.45);
    return {
      sourcePort: 'bottom',
      targetPort: 'top',
      path: cubicPath(start, { x: start.x, y: start.y + bend }, { x: end.x, y: end.y - bend }, end),
      labelPosition: {
        x: (start.x + end.x) / 2 + 8,
        y: (start.y + end.y) / 2,
      },
    };
  }

  const direction = Math.sign(targetCenterX - sourceCenterX);
  const end = direction < 0 ? rightCenter(targetPos) : leftCenter(targetPos);
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
