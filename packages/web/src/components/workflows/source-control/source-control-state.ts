import type { GitChangedFile, GitChangesResponse, GitEmptyReason } from '@/lib/api';

export type SourceControlSnapshot =
  | {
      emptyReason?: never;
      files: readonly GitChangedFile[];
      revision: string;
    }
  | {
      emptyReason: GitEmptyReason;
      files: readonly [];
      revision: '';
    };

export interface SourceControlSnapshotState {
  displayed: SourceControlSnapshot | null;
  pending: SourceControlSnapshot | null;
}

export type SourceControlSnapshotAction =
  | { type: 'received'; snapshot: SourceControlSnapshot }
  | { type: 'accept_pending' }
  | { type: 'reset' };

export const INITIAL_SOURCE_CONTROL_STATE: SourceControlSnapshotState = {
  displayed: null,
  pending: null,
};

export function toSourceControlSnapshot(response: GitChangesResponse): SourceControlSnapshot {
  if (response.emptyReason !== undefined) {
    return {
      emptyReason: response.emptyReason,
      files: [],
      revision: '',
    };
  }

  return {
    files: response.files,
    revision: response.revision,
  };
}

function fingerprint(snapshot: SourceControlSnapshot): string {
  return snapshot.emptyReason === undefined
    ? `ready:${snapshot.revision}`
    : `empty:${snapshot.emptyReason}`;
}

export function sourceControlSnapshotReducer(
  state: SourceControlSnapshotState,
  action: SourceControlSnapshotAction
): SourceControlSnapshotState {
  if (action.type === 'reset') return INITIAL_SOURCE_CONTROL_STATE;

  if (action.type === 'accept_pending') {
    return state.pending ? { displayed: state.pending, pending: null } : state;
  }

  if (!state.displayed) {
    return { displayed: action.snapshot, pending: null };
  }

  if (fingerprint(state.displayed) === fingerprint(action.snapshot)) {
    return { displayed: state.displayed, pending: null };
  }

  return { displayed: state.displayed, pending: action.snapshot };
}
