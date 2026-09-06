export type NodeState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting';

export type RouteOutcome = 'positive' | 'negative' | 'exhausted';

export type LayoutEdgeKind = 'dependency' | 'conditional' | 'route';

export interface LayoutNode {
  id: string;
  nodeState: NodeState;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  kind?: LayoutEdgeKind;
  label?: string;
  outcome?: RouteOutcome;
}

export interface Point {
  x: number;
  y: number;
}

export type PortSide = 'top' | 'bottom' | 'left' | 'right';

export interface LayoutRoute {
  edgeId: string;
  source: string;
  target: string;
  kind: LayoutEdgeKind;
  label?: string;
  outcome?: RouteOutcome;
  sourcePort: PortSide;
  targetPort: PortSide;
  path: string;
  labelPosition: Point;
  backEdge: boolean;
  taken: boolean;
}

export interface LayoutResult {
  positions: Record<string, Point>;
  routes: LayoutRoute[];
}

export interface LayoutInput {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
}
