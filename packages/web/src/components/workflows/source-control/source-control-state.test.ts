import { describe, expect, test } from 'bun:test';

import {
  INITIAL_GIT_LOG_STATE,
  INITIAL_SOURCE_CONTROL_STATE,
  gitLogSnapshotReducer,
  sourceControlSnapshotReducer,
  toGitLogSnapshot,
  toSourceControlSnapshot,
} from './source-control-state';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

describe('sourceControlSnapshotReducer', () => {
  test('displays the first successful snapshot', () => {
    const snapshot = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const state = sourceControlSnapshotReducer(INITIAL_SOURCE_CONTROL_STATE, {
      type: 'received',
      snapshot,
    });

    expect(state).toEqual({ displayed: snapshot, pending: null });
  });

  test('clears pending state when a refetch matches the displayed revision', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const pending = toSourceControlSnapshot({
      files: [{ path: 'new.ts', status: 'A' }],
      revision: REVISION_B,
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending },
      { type: 'received', snapshot: displayed }
    );

    expect(state).toEqual({ displayed, pending: null });
  });

  test('freezes the displayed list and stores a divergent ready snapshot as pending', () => {
    const displayed = toSourceControlSnapshot({
      files: [{ path: 'old.ts', status: 'M' }],
      revision: REVISION_A,
    });
    const next = toSourceControlSnapshot({
      files: [{ path: 'new.ts', status: 'A' }],
      revision: REVISION_B,
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: next }
    );

    expect(state).toEqual({ displayed, pending: next });
  });

  test('treats a ready-to-no_checkout transition as divergence', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const next = toSourceControlSnapshot({
      emptyReason: 'no_checkout',
      files: [],
      revision: '',
    });

    const state = sourceControlSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: next }
    );

    expect(state).toEqual({ displayed, pending: next });
  });

  test('applies the pending snapshot only after explicit acceptance', () => {
    const displayed = toSourceControlSnapshot({ files: [], revision: REVISION_A });
    const pending = toSourceControlSnapshot({
      emptyReason: 'no_checkout',
      files: [],
      revision: '',
    });

    const state = sourceControlSnapshotReducer({ displayed, pending }, { type: 'accept_pending' });

    expect(state).toEqual({ displayed: pending, pending: null });
  });
});

describe('gitLogSnapshotReducer', () => {
  test('displays the first ready History snapshot', () => {
    const snapshot = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });

    const state = gitLogSnapshotReducer(INITIAL_GIT_LOG_STATE, {
      type: 'received',
      snapshot,
    });

    expect(state).toEqual({ displayed: snapshot, pending: null });
  });

  test('freezes displayed commits and stores a divergent log revision as pending', () => {
    const displayed = toGitLogSnapshot({
      commits: [
        {
          oid: 'a'.repeat(40),
          parents: [],
          authorName: 'Ada',
          authorDate: '2026-09-06T18:09:18Z',
          subject: 'old subject',
        },
      ],
      revision: REVISION_A,
      truncated: false,
    });
    const pending = toGitLogSnapshot({
      commits: [
        {
          oid: 'b'.repeat(40),
          parents: ['a'.repeat(40)],
          authorName: 'Grace',
          authorDate: '2026-09-06T19:09:18Z',
          subject: 'new subject',
        },
      ],
      revision: REVISION_B,
      truncated: false,
    });

    const state = gitLogSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: pending }
    );

    expect(state).toEqual({ displayed, pending });
  });

  test('clears pending History when a refetch matches the displayed revision', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const pending = toGitLogSnapshot({ commits: [], revision: REVISION_B, truncated: false });

    const state = gitLogSnapshotReducer(
      { displayed, pending },
      { type: 'received', snapshot: displayed }
    );

    expect(state).toEqual({ displayed, pending: null });
  });

  test('distinguishes a ready empty History from CAP-6', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const unavailable = toGitLogSnapshot({
      emptyReason: 'no_checkout',
      commits: [],
      revision: '',
      truncated: false,
    });

    const state = gitLogSnapshotReducer(
      { displayed, pending: null },
      { type: 'received', snapshot: unavailable }
    );

    expect(state).toEqual({ displayed, pending: unavailable });
  });

  test('applies pending History only after explicit acceptance', () => {
    const displayed = toGitLogSnapshot({ commits: [], revision: REVISION_A, truncated: false });
    const pending = toGitLogSnapshot({
      emptyReason: 'container',
      commits: [],
      revision: '',
      truncated: false,
    });

    const state = gitLogSnapshotReducer({ displayed, pending }, { type: 'accept_pending' });

    expect(state).toEqual({ displayed: pending, pending: null });
  });
});
