import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { GitChangedFile, GitLogCommit } from '@/lib/api';

import { ChangedFilesList } from './changed-files-list';
import { assignCommitLanes } from './commit-lanes';
import { CommitGraphRow, COMMIT_ROW_HEIGHT, LANE_WIDTH } from './commit-graph-row';

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
  expandedOid?: string | null;
  commitFiles?: readonly GitChangedFile[];
  commitFilesLoadState?: 'idle' | 'loading' | 'error';
  selectedPath?: string | null;
  onToggleCommit?: (commit: GitLogCommit) => void;
  onOpenFile?: (file: GitChangedFile) => void;
}

function expandedExtraHeight(loadState: 'idle' | 'loading' | 'error', fileCount: number): number {
  if (loadState === 'loading' || fileCount === 0) return 36;
  return Math.min(240, fileCount * 32 + 8);
}

export function CommitHistoryGraph(props: CommitHistoryGraphProps): ReactElement {
  const idPrefix = props.idPrefix ?? 'sc-history-commit';
  const nowMs = props.nowMs ?? Date.now();
  const expandedOid = props.expandedOid ?? null;
  const commitFiles = props.commitFiles ?? [];
  const commitFilesLoadState = props.commitFilesLoadState ?? 'idle';
  const graph = useMemo(() => assignCommitLanes(props.commits), [props.commits]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commitFileActiveIndex, setCommitFileActiveIndex] = useState(0);
  const clampedActiveIndex =
    props.commits.length === 0 ? 0 : Math.min(props.commits.length - 1, activeIndex);
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  useEffect(() => {
    setCommitFileActiveIndex(0);
  }, [expandedOid]);

  useEffect(() => {
    setCommitFileActiveIndex(current =>
      commitFiles.length === 0 ? 0 : Math.min(commitFiles.length - 1, current)
    );
  }, [commitFiles.length]);

  const virtualizer = useVirtualizer({
    count: props.commits.length,
    getScrollElement: (): HTMLDivElement | null => parentRef.current,
    estimateSize: (index: number): number => {
      const commit = props.commits[index];
      if (commit?.oid !== expandedOid) return COMMIT_ROW_HEIGHT;
      return COMMIT_ROW_HEIGHT + expandedExtraHeight(commitFilesLoadState, commitFiles.length);
    },
    initialRect: { width: 0, height: 280 },
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const mountedIndexes = new Set(virtualItems.map(item => item.index));
  const activeDescendant = mountedIndexes.has(clampedActiveIndex)
    ? `${idPrefix}-${String(clampedActiveIndex)}`
    : undefined;

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [commitFiles.length, commitFilesLoadState, expandedOid, virtualizer]);

  const activate = (index: number): void => {
    const commit = props.commits[index];
    if (!commit) return;
    setActiveIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.currentTarget !== event.target) return;
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
      const commit = props.commits[clampedActiveIndex];
      if (commit) props.onToggleCommit?.(commit);
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
      className="min-h-0 flex-1 overflow-auto"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map(virtualItem => {
          const commit = props.commits[virtualItem.index];
          const layout = graph.rows[virtualItem.index];
          if (!commit || !layout) return null;
          const expanded = expandedOid === commit.oid;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
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
                expanded={expanded}
                onSelect={(): void => {
                  parentRef.current?.focus();
                  activate(virtualItem.index);
                  props.onToggleCommit?.(commit);
                }}
              />
              {expanded ? (
                commitFilesLoadState === 'loading' ? (
                  <p role="status" className="h-9 px-3 py-2 text-[0.8125rem] text-text-tertiary">
                    Loading files
                  </p>
                ) : commitFilesLoadState === 'error' && commitFiles.length === 0 ? (
                  <p role="status" className="h-9 px-3 py-2 text-[0.8125rem] text-text-tertiary">
                    Could not refresh files.
                  </p>
                ) : commitFiles.length === 0 ? (
                  <p role="status" className="h-9 px-3 py-2 text-[0.8125rem] text-text-tertiary">
                    No file changes
                  </p>
                ) : (
                  <div
                    className="flex min-h-0 flex-col"
                    style={{
                      height: Math.min(240, commitFiles.length * 32 + 8),
                      paddingLeft: Math.max(LANE_WIDTH, graph.laneCount * LANE_WIDTH) + 8,
                    }}
                  >
                    {commitFilesLoadState === 'error' ? (
                      <p role="status" className="px-3 pb-1 text-[0.75rem] text-text-tertiary">
                        Could not refresh files.
                      </p>
                    ) : null}
                    <ChangedFilesList
                      files={commitFiles}
                      activeIndex={commitFileActiveIndex}
                      onActiveIndexChange={setCommitFileActiveIndex}
                      selectedPath={props.selectedPath}
                      onOpenFile={props.onOpenFile}
                      ariaLabel="Commit files"
                      idPrefix={`sc-commit-${commit.oid}-file`}
                    />
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
