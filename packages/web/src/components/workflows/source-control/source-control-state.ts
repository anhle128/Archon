import type {
  GitChangedFile,
  GitChangesResponse,
  GitEmptyReason,
  GitLogCommit,
  GitLogResponse,
} from '@/lib/api';

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
  if ('emptyReason' in response) {
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

export type GitLogSnapshot =
  | {
      emptyReason?: never;
      commits: readonly GitLogCommit[];
      revision: string;
      truncated: boolean;
    }
  | {
      emptyReason: GitEmptyReason;
      commits: readonly [];
      revision: '';
      truncated: false;
    };

export interface GitLogSnapshotState {
  displayed: GitLogSnapshot | null;
  pending: GitLogSnapshot | null;
}

export type GitLogSnapshotAction =
  | { type: 'received'; snapshot: GitLogSnapshot }
  | { type: 'accept_pending' }
  | { type: 'reset' };

export const INITIAL_GIT_LOG_STATE: GitLogSnapshotState = {
  displayed: null,
  pending: null,
};

export function toGitLogSnapshot(response: GitLogResponse): GitLogSnapshot {
  if ('emptyReason' in response) {
    return {
      emptyReason: response.emptyReason,
      commits: [],
      revision: '',
      truncated: false,
    };
  }
  return {
    commits: response.commits,
    revision: response.revision,
    truncated: response.truncated,
  };
}

function gitLogFingerprint(snapshot: GitLogSnapshot): string {
  return snapshot.emptyReason === undefined
    ? `ready:${snapshot.revision}`
    : `empty:${snapshot.emptyReason}`;
}

export function gitLogSnapshotReducer(
  state: GitLogSnapshotState,
  action: GitLogSnapshotAction
): GitLogSnapshotState {
  if (action.type === 'reset') return INITIAL_GIT_LOG_STATE;

  if (action.type === 'accept_pending') {
    return state.pending ? { displayed: state.pending, pending: null } : state;
  }

  if (!state.displayed) {
    return { displayed: action.snapshot, pending: null };
  }

  if (gitLogFingerprint(state.displayed) === gitLogFingerprint(action.snapshot)) {
    return { displayed: state.displayed, pending: null };
  }

  return { displayed: state.displayed, pending: action.snapshot };
}
