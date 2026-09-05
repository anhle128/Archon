import { describe, expect, test } from 'bun:test';

import {
  INITIAL_SOURCE_CONTROL_STATE,
  sourceControlSnapshotReducer,
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
