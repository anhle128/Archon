import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { LayoutRoute, RouteOutcome } from '@/lib/run-graph';

export type RunGraphFlowEdge = Edge<{ route: LayoutRoute }, 'runGraphRoute'>;

function takenRouteStroke(outcome: RouteOutcome | undefined): string {
  switch (outcome) {
    case 'positive':
      return 'var(--success)';
    case 'negative':
      return 'var(--accent)';
    case 'exhausted':
      return 'var(--error)';
    case undefined:
      return 'var(--accent-bright)';
  }
}

function strokeForRoute(route: LayoutRoute): string {
  if (!route.taken) {
    return 'var(--border)';
  }
  switch (route.kind) {
    case 'route':
      return takenRouteStroke(route.outcome);
    case 'dependency':
    case 'conditional':
      return 'var(--accent-bright)';
  }
}

function isDashed(route: LayoutRoute): boolean {
  return route.backEdge || route.kind === 'conditional';
}

export function RunGraphRouteEdge(props: EdgeProps<RunGraphFlowEdge>): React.ReactElement | null {
  const route = props.data?.route;
  if (!route?.path) {
    return null;
  }
  const style: CSSProperties = {
    stroke: strokeForRoute(route),
    strokeWidth: 1.5,
  };
  if (isDashed(route)) {
    style.strokeDasharray = '5 5';
  }
  return (
    <BaseEdge
      id={props.id}
      path={route.path}
      labelX={route.labelPosition.x}
      labelY={route.labelPosition.y}
      label={route.label}
      markerEnd={props.markerEnd}
      style={style}
    />
  );
}
