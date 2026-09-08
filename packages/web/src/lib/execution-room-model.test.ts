import { describe, expect, test } from 'bun:test';

import type { components } from './api.generated';
import {
  applyRoomDeepLink,
  askCardId,
  buildExecutionHeader,
  chooseExecutionForNode,
  closeRoom,
  openRoom,
  rememberRoomScroll,
  resetRoomVisit,
  roomOpenerId,
  runtimeForSelection,
  type ExecutionRow,
} from './execution-room-model';

const RUN_STARTED_AT = '2026-09-08T00:00:00.000Z';
const NODE_ID = 'review';

type WorkflowEvent = components['schemas']['WorkflowEvent'];

function row(
  overrides: Partial<ExecutionRow> & Pick<ExecutionRow, 'id' | 'status' | 'order'>
): ExecutionRow {
  return {
    nodeId: NODE_ID,
    label: 'Review',
    selection: { kind: 'node' },
    unknownScope: true,
    ...overrides,
  };
}

function nodeStarted(args: {
  id: string;
  nodeId?: string;
  occurrenceId?: string;
  attemptId?: string;
  provider?: string;
  model?: string;
}): WorkflowEvent {
  const data: Record<string, unknown> = {};
  if (args.occurrenceId !== undefined) data.occurrence_id = args.occurrenceId;
  if (args.attemptId !== undefined) data.attempt_id = args.attemptId;
  if (args.provider !== undefined) data.provider = args.provider;
  if (args.model !== undefined) data.model = args.model;
  return {
    id: args.id,
    workflow_run_id: 'run-1',
    event_type: 'node_started',
    step_index: null,
    step_name: args.nodeId ?? NODE_ID,
    data,
    created_at: RUN_STARTED_AT,
  };
}

describe('chooseExecutionForNode', () => {
  const completedEarly = row({ id: 'completed-early', status: 'completed', order: 0 });
  const running = row({ id: 'running', status: 'running', order: 1 });
  const awaiting = row({ id: 'awaiting', status: 'awaiting', order: 2 });
  const completedLatest = row({ id: 'completed-latest', status: 'completed', order: 3 });
  const rows = [completedEarly, running, awaiting, completedLatest];

  test('a valid last-explicit row wins', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, 'completed-early')).toBe(completedEarly);
  });

  test('awaiting wins over running and completed', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, null)).toBe(awaiting);
  });

  test('running wins without awaiting', () => {
    expect(chooseExecutionForNode([completedEarly, running, completedLatest], NODE_ID, null)).toBe(
      running
    );
  });

  test('latest row by order wins without awaiting or running', () => {
    expect(chooseExecutionForNode([completedEarly, completedLatest], NODE_ID, null)).toBe(
      completedLatest
    );
  });

  test('a stale last-explicit id is ignored', () => {
    expect(chooseExecutionForNode(rows, NODE_ID, 'missing-row')).toBe(awaiting);
  });

  test('returns null for an unknown node', () => {
    expect(chooseExecutionForNode(rows, 'other', 'awaiting')).toBeNull();
  });
});

describe('buildExecutionHeader', () => {
  test('labels iteration, attempt, and unknown executions from selection data', () => {
    expect(
      buildExecutionHeader({
        row: row({
          id: 'iter',
          status: 'completed',
          order: 0,
          selection: { kind: 'loop_iteration', iteration: 2 },
          unknownScope: true,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Iteration 2');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'attempt',
          status: 'completed',
          order: 0,
          selection: {
            kind: 'occurrence',
            occurrenceId: 'occ-1',
            attemptId: 'att-1',
            retryEpoch: 2,
          },
          unknownScope: false,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Attempt 3');

    expect(
      buildExecutionHeader({
        row: row({
          id: 'unknown',
          status: 'completed',
          order: 0,
          selection: { kind: 'node' },
          unknownScope: true,
        }),
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).executionLabel
    ).toBe('Execution unknown');
  });

  test('startedOffsetMs is measured from the run started_at', () => {
    const header = buildExecutionHeader({
      row: row({
        id: 'timed',
        status: 'completed',
        order: 0,
        startedAt: '2026-09-08T00:00:08.000Z',
        durationMs: 400,
      }),
      events: [],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.startedOffsetMs).toBe(8000);
  });

  test('duration is absent when the selected execution has no duration_ms', () => {
    const selected = row({
      id: 'selected',
      status: 'running',
      order: 1,
      startedAt: '2026-09-08T00:00:02.000Z',
    });
    const other = row({
      id: 'other',
      status: 'completed',
      order: 0,
      durationMs: 9_000,
    });
    expect(other.durationMs).toBe(9_000);
    expect(
      buildExecutionHeader({
        row: selected,
        events: [],
        runStartedAt: RUN_STARTED_AT,
      }).durationMs
    ).toBeNull();
  });

  test('provider and model come from the matching node_started event', () => {
    const selected = row({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      unknownScope: false,
    });
    const header = buildExecutionHeader({
      row: selected,
      events: [
        nodeStarted({
          id: 'start-later',
          occurrenceId: 'occ-2',
          attemptId: 'att-2',
          provider: 'codex',
          model: 'gpt-5',
        }),
        nodeStarted({
          id: 'start-match',
          occurrenceId: 'occ-1',
          attemptId: 'att-1',
          provider: 'claude',
          model: 'sonnet',
        }),
      ],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.provider).toBe('claude');
    expect(header.model).toBe('sonnet');
    expect(header.unknownScope).toBe(false);
  });

  test('a later execution event is not used for the selected row', () => {
    const selected = row({
      id: 'occ-1',
      status: 'completed',
      order: 0,
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      unknownScope: false,
    });
    const runtime = runtimeForSelection(
      [
        nodeStarted({
          id: 'start-later',
          occurrenceId: 'occ-2',
          attemptId: 'att-2',
          provider: 'codex',
          model: 'gpt-5',
        }),
      ],
      selected
    );
    expect(runtime).toBeNull();
  });

  test('an unscoped row uses the latest unscoped node_started and is unknownScope', () => {
    const selected = row({
      id: 'unscoped',
      status: 'completed',
      order: 1,
      selection: { kind: 'node' },
      unknownScope: true,
    });
    const header = buildExecutionHeader({
      row: selected,
      events: [
        nodeStarted({ id: 'start-early', provider: 'claude', model: 'haiku' }),
        nodeStarted({ id: 'start-late', provider: 'claude', model: 'sonnet' }),
        nodeStarted({
          id: 'start-scoped',
          occurrenceId: 'occ-9',
          attemptId: 'att-9',
          provider: 'codex',
          model: 'gpt-5',
        }),
      ],
      runStartedAt: RUN_STARTED_AT,
    });
    expect(header.provider).toBe('claude');
    expect(header.model).toBe('sonnet');
    expect(header.unknownScope).toBe(true);
  });
});

describe('roomOpenerId and askCardId', () => {
  test('encodes surface, kind, and key with a stable prefix', () => {
    expect(roomOpenerId('legacy', 'log', 'row/1')).toBe('legacy-log-row%2F1');
    expect(roomOpenerId('legacy', 'graph', 'review')).toBe('legacy-graph-review');
    expect(roomOpenerId('console', 'log', 'row 2')).toBe('console-log-row%202');
    expect(roomOpenerId('console', 'graph', 'setup')).toBe('console-graph-setup');
  });

  test('encodes Ask request ids with the run-ask-card- prefix', () => {
    expect(askCardId('tool/use 1')).toBe('run-ask-card-tool%2Fuse%201');
  });
});

describe('room visit transitions', () => {
  const awaiting = row({ id: 'awaiting', status: 'awaiting', order: 2 });
  const completed = row({ id: 'completed', status: 'completed', order: 0 });
  const rows = [completed, awaiting];
  const openerId = 'legacy-log-awaiting';

  test('opening stores the explicit row and opener', () => {
    const opened = openRoom(resetRoomVisit('run-1'), {
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    expect(opened.selection).toEqual({
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    expect(opened.lastExplicitRowByNode).toEqual({ [NODE_ID]: awaiting.id });
  });

  test('closing clears only selection', () => {
    const opened = openRoom(resetRoomVisit('run-1'), {
      nodeId: NODE_ID,
      rowId: awaiting.id,
      openerId,
    });
    const withScroll = rememberRoomScroll(opened, 'run-1:review', 120);
    const closed = closeRoom(withScroll);
    expect(closed.selection).toBeNull();
    expect(closed.lastExplicitRowByNode).toEqual({ [NODE_ID]: awaiting.id });
    expect(closed.scrollTopByScope).toEqual({ 'run-1:review': 120 });
    expect(closed.runId).toBe('run-1');
  });

  test('applyRoomDeepLink with a null query clears only the marker', () => {
    const opened = applyRoomDeepLink(resetRoomVisit('run-1'), NODE_ID, rows);
    const withScroll = rememberRoomScroll(opened, 'scope', 40);
    const cleared = applyRoomDeepLink(withScroll, null, rows);
    expect(cleared.appliedDeepLinkNode).toBeNull();
    expect(cleared.selection).toEqual(opened.selection);
    expect(cleared.lastExplicitRowByNode).toEqual(opened.lastExplicitRowByNode);
    expect(cleared.scrollTopByScope).toEqual({ scope: 40 });
  });

  test('a query value opens once, ignores manual close, and reopens after leaving', () => {
    let state = applyRoomDeepLink(resetRoomVisit('run-1'), NODE_ID, rows);
    expect(state.selection?.rowId).toBe(awaiting.id);
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);

    state = closeRoom(state);
    state = applyRoomDeepLink(state, NODE_ID, rows);
    expect(state.selection).toBeNull();
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);

    state = applyRoomDeepLink(state, null, rows);
    expect(state.appliedDeepLinkNode).toBeNull();

    state = applyRoomDeepLink(state, NODE_ID, rows);
    expect(state.selection?.rowId).toBe(awaiting.id);
    expect(state.appliedDeepLinkNode).toBe(NODE_ID);
  });

  test('an unknown query node leaves the room closed', () => {
    const state = applyRoomDeepLink(resetRoomVisit('run-1'), 'missing', rows);
    expect(state.selection).toBeNull();
    expect(state.appliedDeepLinkNode).toBe('missing');
  });

  test('a changed run id returns a fresh state with every map empty', () => {
    const previous = rememberRoomScroll(
      openRoom(resetRoomVisit('run-1'), {
        nodeId: NODE_ID,
        rowId: awaiting.id,
        openerId,
      }),
      'scope',
      80
    );
    const next = resetRoomVisit('run-2');
    expect(next.runId).toBe('run-2');
    expect(next.selection).toBeNull();
    expect(next.lastExplicitRowByNode).toEqual({});
    expect(next.scrollTopByScope).toEqual({});
    expect(next.appliedDeepLinkNode).toBeNull();
    expect(previous.runId).toBe('run-1');
  });
});
