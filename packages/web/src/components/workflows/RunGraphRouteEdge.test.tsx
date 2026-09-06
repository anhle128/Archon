import { describe, expect, test } from 'bun:test';
import { Position, type EdgeProps } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LayoutRoute } from '@/lib/run-graph';
import { RunGraphRouteEdge, type RunGraphFlowEdge } from './RunGraphRouteEdge';

const SHARED_PATH = 'M 90 80 C 90 116 90 124 90 160';

function route(overrides: Partial<LayoutRoute> = {}): LayoutRoute {
  return {
    edgeId: 'a->b',
    source: 'a',
    target: 'b',
    kind: 'dependency',
    sourcePort: 'bottom',
    targetPort: 'top',
    path: SHARED_PATH,
    labelPosition: { x: 98, y: 120 },
    backEdge: false,
    taken: false,
    ...overrides,
  };
}

function props(layoutRoute: LayoutRoute): EdgeProps<RunGraphFlowEdge> {
  return {
    id: layoutRoute.edgeId,
    source: layoutRoute.source,
    target: layoutRoute.target,
    type: 'runGraphRoute',
    data: { route: layoutRoute },
    sourceX: 90,
    sourceY: 80,
    targetX: 90,
    targetY: 160,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    markerEnd: 'url(#marker)',
    label: layoutRoute.label,
  };
}

function render(layoutRoute: LayoutRoute): string {
  return renderToStaticMarkup(<RunGraphRouteEdge {...props(layoutRoute)} />);
}

describe('RunGraphRouteEdge', () => {
  test('untaken edge renders the shared path with border stroke', () => {
    const markup = render(route());
    expect(markup).toContain(`d="${SHARED_PATH}"`);
    expect(markup).toContain('stroke:var(--border)');
    expect(markup).not.toContain('stroke-dasharray');
  });

  test('taken dependency uses accent-bright', () => {
    const markup = render(route({ taken: true, kind: 'dependency' }));
    expect(markup).toContain(`d="${SHARED_PATH}"`);
    expect(markup).toContain('stroke:var(--accent-bright)');
  });

  test('taken positive route uses success', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'positive', label: 'positive' })
    );
    expect(markup).toContain('stroke:var(--success)');
  });

  test('taken negative route uses accent', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'negative', label: 'negative' })
    );
    expect(markup).toContain('stroke:var(--accent)');
  });

  test('taken exhausted route uses error', () => {
    const markup = render(
      route({ taken: true, kind: 'route', outcome: 'exhausted', label: 'exhausted' })
    );
    expect(markup).toContain('stroke:var(--error)');
  });

  test('conditional and back-edge routes are dashed', () => {
    expect(render(route({ kind: 'conditional', label: '$a.ok' }))).toContain('stroke-dasharray');
    expect(render(route({ backEdge: true }))).toContain('stroke-dasharray');
  });

  test('empty path renders an empty string', () => {
    expect(render(route({ path: '' }))).toBe('');
  });
});
