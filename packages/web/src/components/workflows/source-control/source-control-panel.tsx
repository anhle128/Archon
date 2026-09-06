import { useEffect, useState, type ReactElement, type Ref } from 'react';

import type { GitChangedFile } from '@/lib/api';

import { ChangedFilesList } from './changed-files-list';
import type { SourceControlSnapshot } from './source-control-state';

export { nextChangedFileIndex } from './changed-files-list';

export type SourceControlLoadState = 'idle' | 'loading' | 'error';

export interface SourceControlPanelProps {
  snapshot: SourceControlSnapshot | null;
  loadState: SourceControlLoadState;
  stale: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
  onOpenFile?: (file: GitChangedFile) => void;
  selectedPath?: string | null;
  ariaLabel?: string;
  idPrefix?: string;
  listRef?: Ref<HTMLDivElement | null>;
}

export function SourceControlPanel(props: SourceControlPanelProps): ReactElement {
  const files = props.snapshot?.files ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedActiveIndex = files.length === 0 ? 0 : Math.min(files.length - 1, activeIndex);

  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) setActiveIndex(clampedActiveIndex);
  }, [activeIndex, clampedActiveIndex]);

  if (props.snapshot?.emptyReason === 'container') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No files to show</h2>
        <p className="text-sm">
          This run executed inside a container — its working files aren't on the host to read.
        </p>
      </div>
    );
  }

  if (props.snapshot?.emptyReason === 'no_checkout') {
    return (
      <div role="status" className="flex h-full flex-col items-start gap-2 p-4 text-text-secondary">
        <h2 className="text-sm font-medium text-text-primary">No worktree available</h2>
        <p className="text-sm">
          This run's checkout isn't available or readable right now — it may not be ready yet, or it
          may have been cleaned up.
        </p>
        {props.loadState === 'error' ? <p className="text-xs">Could not refresh changes.</p> : null}
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
      <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
        <h2 className="text-sm font-medium text-text-primary">Changes</h2>
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
    </div>
  );
}
