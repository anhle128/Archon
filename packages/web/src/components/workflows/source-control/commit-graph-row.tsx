import type { PointerEvent, ReactElement } from 'react';

import type { GitLogCommit } from '@/lib/api';

import type { LaneRow } from './commit-lanes';
import { formatCommitTime } from './format-commit-time';

export const COMMIT_ROW_HEIGHT = 32;
export const LANE_WIDTH = 12;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function edgePath(fromLane: number, fromY: number, toLane: number, toY: number): string {
  return `M ${String(laneX(fromLane))} ${String(fromY)} L ${String(laneX(toLane))} ${String(toY)}`;
}

export interface CommitGraphRowProps {
  commit: GitLogCommit;
  layout: LaneRow;
  laneCount: number;
  id: string;
  active: boolean;
  nowMs: number;
  expanded: boolean;
  onSelect: () => void;
}

export function CommitGraphRow(props: CommitGraphRowProps): ReactElement {
  const shortOid = props.commit.oid.slice(0, 7);
  const relativeTime = formatCommitTime(props.commit.authorDate, props.nowMs);
  const nodeX = laneX(props.layout.lane);
  const nodeY = COMMIT_ROW_HEIGHT / 2;
  const accessibleKind = props.layout.isMerge ? 'Merge commit' : 'Commit';

  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      id={props.id}
      aria-selected={props.active}
      aria-expanded={props.expanded}
      aria-label={`${accessibleKind} ${shortOid}: ${props.commit.subject}; ${props.commit.authorName}; ${relativeTime}`}
      data-active={props.active ? 'true' : 'false'}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>): void => {
        event.preventDefault();
      }}
      onClick={props.onSelect}
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 text-left ${
        props.active ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
      }`}
      style={{ height: COMMIT_ROW_HEIGHT }}
    >
      <svg
        aria-hidden="true"
        width={Math.max(LANE_WIDTH, props.laneCount * LANE_WIDTH)}
        height={COMMIT_ROW_HEIGHT}
        viewBox={`0 0 ${String(Math.max(LANE_WIDTH, props.laneCount * LANE_WIDTH))} ${String(COMMIT_ROW_HEIGHT)}`}
      >
        {props.layout.throughLanes.map(lane => (
          <line
            key={`through-${String(lane)}`}
            data-edge="through"
            x1={laneX(lane)}
            y1={0}
            x2={laneX(lane)}
            y2={COMMIT_ROW_HEIGHT}
            className="stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.incomingLanes.map(lane => (
          <path
            key={`incoming-${String(lane)}`}
            data-edge="incoming"
            d={edgePath(lane, 0, props.layout.lane, nodeY)}
            className="fill-none stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.parentLanes.map((lane, index) => (
          <path
            key={`parent-${String(index)}-${String(lane)}`}
            data-edge="parent"
            d={edgePath(props.layout.lane, nodeY, lane, COMMIT_ROW_HEIGHT)}
            className="fill-none stroke-text-secondary"
            strokeWidth="1.5"
          />
        ))}
        {props.layout.isMerge ? (
          <polygon
            points={`${String(nodeX)},${String(nodeY - 5)} ${String(nodeX + 5)},${String(nodeY)} ${String(nodeX)},${String(nodeY + 5)} ${String(nodeX - 5)},${String(nodeY)}`}
            className="fill-text-primary"
          />
        ) : (
          <circle cx={nodeX} cy={nodeY} r="4" className="fill-text-primary" />
        )}
      </svg>
      <span
        className="min-w-0 truncate text-[0.8125rem] text-text-primary"
        title={props.commit.subject}
      >
        {props.commit.subject}
      </span>
      <span className="shrink-0 text-[0.75rem] whitespace-nowrap text-text-secondary">
        {props.commit.authorName} · <time dateTime={props.commit.authorDate}>{relativeTime}</time>
      </span>
    </button>
  );
}
