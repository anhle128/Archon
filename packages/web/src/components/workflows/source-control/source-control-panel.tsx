import { useEffect, useState, type ReactElement, type Ref } from 'react';

import type { GitChangedFile, GitEmptyReason } from '@/lib/api';

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
  stale: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
  onOpenFile?: (file: GitChangedFile) => void;
  selectedPath?: string | null;
  ariaLabel?: string;
  idPrefix?: string;
  listRef?: Ref<HTMLDivElement | null>;
}

function displayedEmptyReason(
  snapshot: SourceControlSnapshot | null,
  historySnapshot: GitLogSnapshot | null
): GitEmptyReason | undefined {
  const reasons = [snapshot?.emptyReason, historySnapshot?.emptyReason];
  if (reasons.includes('container')) return 'container';
  return reasons.find(reason => reason === 'no_checkout');
}

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  const files = props.snapshot?.files ?? [];
  const commits = props.historySnapshot?.commits ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex = files.length === 0 ? 0 : Math.min(files.length - 1, activeIndex);
  const emptyReason = displayedEmptyReason(props.snapshot, props.historySnapshot);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  if (emptyReason === 'container') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No files to show</h2>
        <p className="text-sm">
          This run executed inside a container — its working files aren't on the host to read.
        </p>
      </div>
    );
  }

  if (emptyReason === 'no_checkout') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No worktree available</h2>
        <p className="text-sm">
          This run's checkout isn't available or readable right now — it may not be ready yet, or it
          may have been cleaned up.
        </p>
        {props.loadState === 'error' || props.historyLoadState === 'error' ? (
          <p className="text-xs">Could not refresh source control.</p>
        ) : null}
        <button
          type="button"
          onClick={props.stale ? props.onAcceptPending : props.onReload}
          className="text-xs text-primary transition-colors hover:text-accent-bright"
        >
          {props.stale ? 'Changed on disk — Reload' : 'Reload'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        aria-labelledby="source-control-changes-heading"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
          <h2 id="source-control-changes-heading" className="text-sm font-medium text-text-primary">
            Changes
          </h2>
          <button
            type="button"
            onClick={props.onReload}
            className="text-xs text-primary transition-colors hover:text-accent-bright"
          >
            Reload
          </button>
        </div>

        {props.stale ? (
          <button
            type="button"
            onClick={props.onAcceptPending}
            className="mx-4 mt-2 self-start text-xs text-text-secondary hover:text-text-primary"
          >
            Changed on disk — Reload
          </button>
        ) : null}

        {props.loadState === 'loading' ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
            {props.snapshot ? 'Refreshing changes' : 'Loading changes'}
          </p>
        ) : null}

        {props.loadState === 'error' ? (
          <p role="status" className="px-4 py-2 text-xs text-text-secondary">
            Could not refresh changes.
          </p>
        ) : null}

        {props.snapshot && files.length === 0 ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
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
            selectedPath={props.selectedPath}
            onOpenFile={props.onOpenFile}
            ariaLabel={props.ariaLabel}
            idPrefix={props.idPrefix}
            listRef={props.listRef}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="source-control-history-heading"
        className="flex min-h-0 flex-1 flex-col border-t border-border"
      >
        <h2
          id="source-control-history-heading"
          className="border-b border-border px-4 py-1.5 text-sm font-medium text-text-primary"
        >
          History
        </h2>

        {props.historyLoadState === 'loading' ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
            {props.historySnapshot ? 'Refreshing history' : 'Loading history'}
          </p>
        ) : null}

        {props.historyLoadState === 'error' ? (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-2 text-xs text-text-secondary"
          >
            <span>Could not refresh history.</span>
            <button
              type="button"
              onClick={props.onReload}
              className="text-primary hover:text-accent-bright"
            >
              Reload
            </button>
          </div>
        ) : null}

        {props.historySnapshot?.truncated ? (
          <p role="status" className="px-4 py-1 text-xs text-text-secondary">
            Showing the newest 500 commits.
          </p>
        ) : null}

        {props.historySnapshot && commits.length === 0 ? (
          <p role="status" className="px-4 py-3 text-sm text-text-secondary">
            No commits yet
          </p>
        ) : null}

        {commits.length > 0 ? <CommitHistoryGraph commits={commits} /> : null}
      </section>
    </div>
  );
}
