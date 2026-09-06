import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';

import { ChangedFileRow } from './changed-file-row';
import type { SourceControlSnapshot } from './source-control-state';

export type SourceControlLoadState = 'idle' | 'loading' | 'error';

export interface SourceControlPanelProps {
  snapshot: SourceControlSnapshot | null;
  loadState: SourceControlLoadState;
  stale: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
}

export function nextChangedFileIndex(key: string, currentIndex: number, fileCount: number): number {
  if (fileCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(fileCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return fileCount - 1;
  return Math.min(fileCount - 1, Math.max(0, currentIndex));
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
    }
    setActiveIndex(nextChangedFileIndex(event.key, clampedActiveIndex, files.length));
  };

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
        <div
          role="listbox"
          aria-label="Uncommitted changes"
          aria-activedescendant={`sc-file-${String(clampedActiveIndex)}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-auto p-2"
        >
          {files.map((file, index) => (
            <ChangedFileRow
              key={`${file.status}:${file.path}`}
              id={`sc-file-${String(index)}`}
              file={file}
              active={index === clampedActiveIndex}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
