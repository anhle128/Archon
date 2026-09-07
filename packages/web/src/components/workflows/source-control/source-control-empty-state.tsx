import type { ReactElement } from 'react';

import type { GitEmptyReason } from '@/lib/api';

import type { GitLogSnapshot, SourceControlSnapshot } from './source-control-state';

export function displayedEmptyReason(
  snapshot: SourceControlSnapshot | null,
  historySnapshot: GitLogSnapshot | null,
  commitSnapshot: SourceControlSnapshot | null
): GitEmptyReason | undefined {
  const reasons = [
    snapshot?.emptyReason,
    historySnapshot?.emptyReason,
    commitSnapshot?.emptyReason,
  ];
  if (reasons.includes('container')) return 'container';
  return reasons.find(reason => reason === 'no_checkout');
}

export interface SourceControlEmptyStateProps {
  reason: GitEmptyReason;
  stale: boolean;
  refreshFailed: boolean;
  onReload: () => void;
  onAcceptPending: () => void;
}

export function SourceControlEmptyState(props: SourceControlEmptyStateProps): ReactElement {
  const retryable = props.reason === 'no_checkout';
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div role="status" className="max-w-[26rem] p-8 text-center">
        <h2 className="mb-1.5 text-[0.9375rem] font-semibold text-text-primary">
          No files to show
        </h2>
        <p className="text-[0.8125rem] leading-relaxed text-text-secondary">
          {props.reason === 'container'
            ? "This run executed inside a container — its working files aren't on the host to read."
            : "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up."}
        </p>
        {retryable && props.refreshFailed ? (
          <p className="mt-2 text-[0.75rem] text-text-tertiary">
            Could not refresh source control.
          </p>
        ) : null}
        {retryable ? (
          <button
            type="button"
            onClick={props.stale ? props.onAcceptPending : props.onReload}
            className="mt-3.5 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium text-text-primary transition-colors hover:bg-surface-hover"
          >
            {props.stale ? 'Changed on disk — Reload' : 'Reload'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
