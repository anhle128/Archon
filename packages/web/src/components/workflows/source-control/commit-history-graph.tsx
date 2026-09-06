import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { GitLogCommit } from '@/lib/api';

import { assignCommitLanes } from './commit-lanes';
import { CommitGraphRow, COMMIT_ROW_HEIGHT } from './commit-graph-row';

export function nextCommitIndex(key: string, currentIndex: number, commitCount: number): number {
  if (commitCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(commitCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return commitCount - 1;
  return Math.min(commitCount - 1, Math.max(0, currentIndex));
}

export interface CommitHistoryGraphProps {
  commits: readonly GitLogCommit[];
  nowMs?: number;
  idPrefix?: string;
}

export function CommitHistoryGraph(props: CommitHistoryGraphProps): ReactElement {
  const idPrefix = props.idPrefix ?? 'sc-history-commit';
  const nowMs = props.nowMs ?? Date.now();
  const graph = useMemo(() => assignCommitLanes(props.commits), [props.commits]);
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex =
    props.commits.length === 0 ? 0 : Math.min(props.commits.length - 1, activeIndex);
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  const virtualizer = useVirtualizer({
    count: props.commits.length,
    getScrollElement: (): HTMLDivElement | null => parentRef.current,
    estimateSize: (): number => COMMIT_ROW_HEIGHT,
    initialRect: { width: 0, height: 280 },
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const mountedIndexes = new Set(virtualItems.map(item => item.index));
  const activeDescendant = mountedIndexes.has(clampedActiveIndex)
    ? `${idPrefix}-${String(clampedActiveIndex)}`
    : undefined;

  const activate = (index: number): void => {
    const commit = props.commits[index];
    if (!commit) return;
    setActiveIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const nextIndex = nextCommitIndex(event.key, clampedActiveIndex, props.commits.length);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      activate(nextIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(clampedActiveIndex);
    }
  };

  return (
    <div
      ref={parentRef}
      role="listbox"
      aria-label="Commit history"
      aria-activedescendant={activeDescendant}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto p-2"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map(virtualItem => {
          const commit = props.commits[virtualItem.index];
          const layout = graph.rows[virtualItem.index];
          if (!commit || !layout) return null;
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${String(virtualItem.start)}px)`,
              }}
            >
              <CommitGraphRow
                commit={commit}
                layout={layout}
                laneCount={graph.laneCount}
                id={`${idPrefix}-${String(virtualItem.index)}`}
                active={virtualItem.index === clampedActiveIndex}
                nowMs={nowMs}
                onSelect={(): void => {
                  parentRef.current?.focus();
                  activate(virtualItem.index);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
