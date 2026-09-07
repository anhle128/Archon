import { useEffect, useState, type ReactElement, type Ref } from 'react';

import type { GitChangedFile, GitLogCommit } from '@/lib/api';

import { ChangedFilesList } from './changed-files-list';
import { CommitHistoryGraph } from './commit-history-graph';
import type { GitLogSnapshot, SourceControlSnapshot } from './source-control-state';

export { nextChangedFileIndex } from './changed-files-list';

export type SourceControlLoadState = 'idle' | 'loading' | 'error';

export interface SourceControlPanelProps {
  snapshot: SourceControlSnapshot | null;
  historySnapshot: GitLogSnapshot | null;
  loadState: SourceControlLoadState;
  historyLoadState: SourceControlLoadState;
  onReload: () => void;
  onOpenFile?: (file: GitChangedFile) => void;
  selectedNowPath?: string | null;
  selectedCommitPath?: string | null;
  ariaLabel?: string;
  idPrefix?: string;
  listRef?: Ref<HTMLDivElement | null>;
  expandedCommit: GitLogCommit | null;
  commitSnapshot: SourceControlSnapshot | null;
  commitLoadState: SourceControlLoadState;
  onToggleCommit: (commit: GitLogCommit) => void;
  onOpenCommitFile: (file: GitChangedFile) => void;
}

const REGION_HEADER_CLASS =
  'px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-text-tertiary';
const REGION_EMPTY_CLASS = 'px-3 pt-0.5 pb-2 text-[0.8125rem] text-text-tertiary';
const REGION_ERROR_CLASS = 'px-3 py-1.5 text-[0.8125rem] text-text-secondary';
const REGION_RELOAD_CLASS =
  'ml-2 rounded-sm px-1.5 py-0.5 text-[0.75rem] font-medium text-text-primary transition-colors hover:bg-surface-hover';

function RegionSkeleton(props: { label: string }): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={props.label}
      className="flex flex-col gap-2 px-3 py-2"
    >
      <div className="h-3 w-3/4 animate-pulse rounded-sm bg-surface-elevated" />
      <div className="h-3 w-1/2 animate-pulse rounded-sm bg-surface-elevated" />
      <div className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-elevated" />
    </div>
  );
}

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  const files = props.snapshot?.files ?? [];
  const commits = props.historySnapshot?.commits ?? [];
  const commitFiles =
    props.commitSnapshot != null && props.commitSnapshot.emptyReason === undefined
      ? props.commitSnapshot.files
      : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex = files.length === 0 ? 0 : Math.min(files.length - 1, activeIndex);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        aria-labelledby="source-control-changes-heading"
        className="flex max-h-1/2 min-h-0 flex-shrink-0 flex-col pb-1.5"
      >
        <h2 id="source-control-changes-heading" className={REGION_HEADER_CLASS}>
          Changes
        </h2>

        {props.loadState === 'loading' ? (
          <RegionSkeleton label={props.snapshot ? 'Refreshing changes' : 'Loading changes'} />
        ) : null}

        {props.loadState === 'error' ? (
          <p role="status" className={REGION_ERROR_CLASS}>
            Could not refresh changes.
            <button type="button" onClick={props.onReload} className={REGION_RELOAD_CLASS}>
              Reload
            </button>
          </p>
        ) : null}

        {props.snapshot && files.length === 0 ? (
          <p role="status" className={REGION_EMPTY_CLASS}>
            No uncommitted changes
          </p>
        ) : null}

        {files.length > 0 ? (
          <ChangedFilesList
            files={files}
            activeIndex={clampedActiveIndex}
            onActiveIndexChange={(index: number): void => {
              setActiveIndex(index);
            }}
            selectedPath={props.selectedNowPath}
            onOpenFile={props.onOpenFile}
            ariaLabel={props.ariaLabel}
            idPrefix={props.idPrefix}
            listRef={props.listRef}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="source-control-history-heading"
        className="flex min-h-0 flex-1 flex-col border-t border-border pb-1.5"
      >
        <h2 id="source-control-history-heading" className={REGION_HEADER_CLASS}>
          History
        </h2>

        {props.historyLoadState === 'loading' ? (
          <RegionSkeleton
            label={props.historySnapshot ? 'Refreshing history' : 'Loading history'}
          />
        ) : null}

        {props.historyLoadState === 'error' ? (
          <p role="status" className={REGION_ERROR_CLASS}>
            Could not refresh history.
            <button type="button" onClick={props.onReload} className={REGION_RELOAD_CLASS}>
              Reload
            </button>
          </p>
        ) : null}

        {props.historySnapshot?.truncated ? (
          <p role="status" className="px-3 pb-1 text-[0.75rem] text-text-tertiary">
            Showing the newest 500 commits.
          </p>
        ) : null}

        {props.historySnapshot && commits.length === 0 ? (
          <p role="status" className={REGION_EMPTY_CLASS}>
            No commits yet
          </p>
        ) : null}

        {commits.length > 0 ? (
          <CommitHistoryGraph
            commits={commits}
            expandedOid={props.expandedCommit?.oid ?? null}
            commitFiles={commitFiles}
            commitFilesLoadState={props.commitLoadState}
            selectedPath={props.selectedCommitPath}
            onToggleCommit={props.onToggleCommit}
            onOpenFile={props.onOpenCommitFile}
          />
        ) : null}
      </section>
    </div>
  );
}
