/**
 * Console-owned SVG/HTML graph renderer over shared `@/lib/run-graph` geometry.
 * No workflow fetching, event folding, or Dagre.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';

import type { LayoutRoute, RouteOutcome } from '@/lib/run-graph';
import { NODE_HEIGHT, NODE_WIDTH } from '@/lib/run-graph/constants';
import type { WorkflowNodeState } from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { buildRunGraphInput } from './graph/build-run-graph-input';
import { fitGraphScale, graphBounds } from './graph/graph-viewport';
import { inspectStatusLabel } from './inspect/inspect-status';
import { nodeBodyKind, type NodeBodyKind } from './inspect/resolve-room-kind';

export interface RunGraphPanelProps {
  nodes: readonly DagNode[];
  nodeStates: readonly WorkflowNodeState[];
  selectedNodeId: string | null;
  definitionPending: boolean;
  definitionError: string | null;
  onSelectNode: (nodeId: string) => void;
}

const ORIGIN_TRANSLATION = 64;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;
const ARROW_MARKER_ID = 'console-run-graph-arrow';

type InspectCardStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting';

function clampManualZoom(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  if (rounded < MIN_ZOOM) return MIN_ZOOM;
  if (rounded > MAX_ZOOM) return MAX_ZOOM;
  return rounded;
}

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

function typeGlyph(kind: NodeBodyKind): string {
  switch (kind) {
    case 'loop':
      return '↻';
    case 'route_loop':
      return '⇄';
    case 'approval':
      return '◈';
    case 'plannotator_gate':
      return '◇';
    case 'bash':
      return '$';
    case 'command':
      return '/';
    case 'script':
      return '⧉';
    case 'prompt':
      return '·';
    case 'workflow':
      return '⤷';
    case 'loop_group':
      return '⊞';
    case 'unknown':
      return '?';
  }
}

function cardStatus(value: string): InspectCardStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'awaiting'
  ) {
    return value;
  }
  return 'pending';
}

function statusFill(status: InspectCardStatus): string {
  switch (status) {
    case 'running':
      return 'color-mix(in oklch, var(--running), transparent 90%)';
    case 'awaiting':
      return 'color-mix(in oklch, var(--warning), transparent 90%)';
    case 'completed':
      return 'color-mix(in oklch, var(--success), transparent 95%)';
    case 'failed':
      return 'color-mix(in oklch, var(--error), transparent 92%)';
    case 'skipped':
      return 'var(--surface-elevated)';
    case 'pending':
      return 'var(--surface-elevated)';
  }
}

function statusBorder(status: InspectCardStatus): string {
  switch (status) {
    case 'running':
      return 'color-mix(in oklch, var(--running), transparent 40%)';
    case 'awaiting':
      return 'color-mix(in oklch, var(--warning), transparent 40%)';
    case 'completed':
      return 'color-mix(in oklch, var(--success), transparent 60%)';
    case 'failed':
      return 'color-mix(in oklch, var(--error), transparent 45%)';
    case 'skipped':
      return 'var(--border-bright)';
    case 'pending':
      return 'var(--border-bright)';
  }
}

function statusGlyphClass(status: InspectCardStatus): string {
  switch (status) {
    case 'running':
      return 'text-[color:var(--running)]';
    case 'awaiting':
      return 'text-warning';
    case 'completed':
      return 'text-success';
    case 'failed':
      return 'text-error';
    case 'skipped':
      return 'text-text-tertiary';
    case 'pending':
      return 'text-text-tertiary';
  }
}

function GraphMessage({ children }: { children: string }): ReactElement {
  return <div className="p-6 font-mono text-[12px] text-text-tertiary">{children}</div>;
}

export function RunGraphPanel({
  nodes,
  nodeStates,
  selectedNodeId,
  definitionPending,
  definitionError,
  onSelectNode,
}: RunGraphPanelProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const model = useMemo(() => buildRunGraphInput(nodes, nodeStates), [nodes, nodeStates]);
  const bounds = useMemo(() => graphBounds(model.positions), [model.positions]);
  const namesById = useMemo(() => {
    const names = new Map<string, string>();
    for (const state of nodeStates) {
      names.set(state.nodeId, state.name);
    }
    return names;
  }, [nodeStates]);

  const handleZoomIn = useCallback((): void => {
    setScale(current => clampManualZoom(current + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback((): void => {
    setScale(current => clampManualZoom(current - ZOOM_STEP));
  }, []);

  const handleFit = useCallback((): void => {
    const scroller = scrollRef.current;
    const viewportWidth = scroller?.clientWidth ?? 0;
    const viewportHeight = scroller?.clientHeight ?? 0;
    const next = fitGraphScale(viewportWidth, viewportHeight, bounds);
    setScale(next);
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node === null) return;
      node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2);
      node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) / 2);
    });
  }, [bounds]);

  if (definitionError !== null) {
    return (
      <div className="p-6 font-mono text-[12px] text-error">
        Could not load graph: {definitionError}
      </div>
    );
  }

  if (definitionPending) {
    return <GraphMessage>Loading graph…</GraphMessage>;
  }

  if (nodes.length === 0) {
    return <GraphMessage>No workflow nodes to display.</GraphMessage>;
  }

  const canvasStyle: CSSProperties = {
    width: bounds.width,
    height: bounds.height,
    transform: `translate(${String(ORIGIN_TRANSLATION)}px, ${String(ORIGIN_TRANSLATION)}px) scale(${String(scale)})`,
    transformOrigin: '0 0',
  };
  const scrollContentStyle: CSSProperties = {
    width: bounds.width * scale + ORIGIN_TRANSLATION,
    height: bounds.height * scale + ORIGIN_TRANSLATION,
  };

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-3 top-3 z-10 flex gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          className="rounded-[8px] border border-border bg-surface-elevated px-2 py-1 font-mono text-[12px] text-text-secondary"
          onClick={handleZoomOut}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          className="rounded-[8px] border border-border bg-surface-elevated px-2 py-1 font-mono text-[12px] text-text-secondary"
          onClick={handleZoomIn}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Fit"
          className="rounded-[8px] border border-border bg-surface-elevated px-2 py-1 font-mono text-[12px] text-text-secondary"
          onClick={handleFit}
        >
          Fit
        </button>
      </div>
      <div
        ref={scrollRef}
        data-testid="console-run-graph-scroller"
        className="h-full w-full overflow-auto"
        style={{
          background:
            'radial-gradient(circle at 1px 1px, color-mix(in oklch, white, transparent 95%) 1px, transparent 0) 0 0 / 26px 26px',
        }}
      >
        <div style={scrollContentStyle}>
          <div data-testid="console-run-graph-canvas" className="relative" style={canvasStyle}>
            <svg
              className="pointer-events-none absolute inset-0 overflow-visible"
              width={bounds.width}
              height={bounds.height}
              aria-hidden
            >
              <defs>
                <marker
                  id={ARROW_MARKER_ID}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
                </marker>
              </defs>
              {model.routes.map(route => {
                const dash = isDashed(route) ? '5 5' : undefined;
                return (
                  <g key={route.edgeId}>
                    <path
                      data-edge-id={route.edgeId}
                      d={route.path}
                      fill="none"
                      stroke={strokeForRoute(route)}
                      strokeWidth={1.5}
                      strokeDasharray={dash}
                      markerEnd={`url(#${ARROW_MARKER_ID})`}
                    />
                    {route.label !== undefined ? (
                      <text
                        x={route.labelPosition.x}
                        y={route.labelPosition.y}
                        className="fill-text-tertiary"
                        fontSize={11}
                      >
                        {route.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            {model.nodes.map(node => {
              const position = model.positions[node.definition.id];
              if (position === undefined) return null;
              const status = cardStatus(node.nodeState);
              const selected = selectedNodeId === node.definition.id;
              const label = namesById.get(node.definition.id) ?? node.definition.id;
              const dimmed = status === 'pending' || status === 'skipped';
              const style: CSSProperties = {
                left: position.x,
                top: position.y,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                backgroundColor: statusFill(status),
                borderColor: statusBorder(status),
                boxShadow: selected
                  ? '0 0 0 2px var(--accent-bright)'
                  : status === 'failed'
                    ? '0 0 0 3px color-mix(in oklch, var(--error), transparent 94%)'
                    : undefined,
              };
              return (
                <button
                  key={node.definition.id}
                  type="button"
                  data-node-id={node.definition.id}
                  aria-current={selected ? 'true' : undefined}
                  title={`${node.definition.id} · ${nodeBodyKind(node.definition)} · ${inspectStatusLabel(node.nodeState)}`}
                  className={`absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-[9px] border px-3 py-2 text-left transition-colors hover:brightness-110 ${
                    status === 'running'
                      ? 'animate-pulse'
                      : status === 'awaiting'
                        ? 'animate-[pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none'
                        : ''
                  } ${dimmed ? 'opacity-60' : ''}`}
                  style={style}
                  onClick={(): void => {
                    onSelectNode(node.definition.id);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`shrink-0 font-mono text-[15px] font-bold leading-none ${statusGlyphClass(status)}`}
                    >
                      {typeGlyph(nodeBodyKind(node.definition))}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate font-mono text-[13px] font-semibold ${
                        status === 'failed'
                          ? 'text-error'
                          : dimmed
                            ? 'text-text-secondary'
                            : 'text-text-primary'
                      }`}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-text-tertiary">
                    {node.definition.id}
                  </span>
                  <span className="truncate text-[11px] text-text-secondary">
                    {inspectStatusLabel(node.nodeState)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
