import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { WorkflowNodeMessageResponse } from '@/lib/api';

import type { LogRowSelection } from './build-log-rows';
import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const ITERATION_TWO_STARTED: WorkflowNodeMessageResponse = {
  id: 'm5',
  seq: 5,
  kind: 'status',
  payload: { state: 'iteration_started', detail: '2' },
  created_at: CREATED_AT,
};

const TOOL_READ: WorkflowNodeMessageResponse = {
  id: 'm6',
  seq: 6,
  kind: 'tool',
  payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
  created_at: CREATED_AT,
};

const FIXTURE: readonly WorkflowNodeMessageResponse[] = [
  { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
  {
    id: 'm2',
    seq: 2,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '1' },
    created_at: CREATED_AT,
  },
  { id: 'm3', seq: 3, kind: 'text', payload: { text: 'first' }, created_at: CREATED_AT },
  {
    id: 'm4',
    seq: 4,
    kind: 'status',
    payload: { state: 'iteration_completed', detail: '1' },
    created_at: CREATED_AT,
  },
  ITERATION_TWO_STARTED,
  TOOL_READ,
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  { id: 'm8', seq: 8, kind: 'status', payload: { state: 'failed' }, created_at: CREATED_AT },
];

function ids(messages: readonly WorkflowNodeMessageResponse[]): string[] {
  return messages.map(message => message.id);
}

function renderRoom(
  overrides: {
    nodeId?: string | null;
    selection?: LogRowSelection | null;
    messages?: readonly WorkflowNodeMessageResponse[] | undefined;
    isPending?: boolean;
    error?: unknown;
  } = {}
): string {
  return renderToStaticMarkup(
    <NodeRoom
      nodeId={overrides.nodeId === undefined ? 'review' : overrides.nodeId}
      selection={overrides.selection === undefined ? { kind: 'node' } : overrides.selection}
      messages={overrides.messages === undefined ? FIXTURE : overrides.messages}
      isPending={overrides.isPending ?? false}
      error={overrides.error ?? null}
      onRetry={(): void => {
        return;
      }}
    />
  );
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('selectNodeRoomMessages', () => {
  test('sorts a copy by seq and returns all rows for non-loop selections', () => {
    const reversed = [...FIXTURE].reverse();
    const nodeRows = selectNodeRoomMessages(reversed, { kind: 'node' });
    const routeRows = selectNodeRoomMessages(reversed, {
      kind: 'route_iteration',
      executionSeq: 4,
    });

    expect(ids(nodeRows)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(ids(routeRows)).toEqual(ids(nodeRows));
    expect(ids(reversed)).toEqual(['m8', 'm7', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1']);
  });

  test('selecting iteration 2 returns only the marker-bounded rows', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm7']);
  });

  test('a missing iteration start marker returns the full sorted transcript', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 9 });
    expect(ids(sliced)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  });

  test('without a terminal marker, the slice stops before the next iteration start', () => {
    const openIteration: readonly WorkflowNodeMessageResponse[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm9',
        seq: 9,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '3' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openIteration, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6']);
  });

  test('without a terminal or next start marker, the slice continues to the end', () => {
    const openEnd: readonly WorkflowNodeMessageResponse[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm10',
        seq: 10,
        kind: 'text',
        payload: { text: 'still going' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openEnd, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm10']);
  });
});

describe('NodeRoom', () => {
  test('renders every room state, ordered kinds, iteration slice, region, and no prohibited chrome', () => {
    const unselected = renderRoom({ nodeId: null, selection: null });
    expect(visibleText(unselected)).toBe('Select a node');
    expect(unselected).not.toContain('role="region"');

    const loading = renderRoom({ isPending: true, messages: undefined });
    expect(visibleText(loading)).toBe('Loading node transcript');
    expect(loading).toContain('role="region"');
    expect(loading).toContain('aria-label="review room"');
    expect(loading.split('role="region"').length - 1).toBe(1);

    const errorMarkup = renderRoom({ error: new Error('boom'), messages: undefined });
    expect(errorMarkup).toContain('Failed to load node transcript');
    expect(errorMarkup).toContain('type="button"');
    expect(errorMarkup).toContain('Retry');
    expect(errorMarkup).toContain('role="region"');
    expect(errorMarkup).toContain('aria-label="review room"');
    expect(errorMarkup.split('role="region"').length - 1).toBe(1);

    const empty = renderRoom({ messages: [] });
    expect(visibleText(empty)).toBe("Node hasn't produced output");
    expect(empty).toContain('role="region"');
    expect(empty).toContain('aria-label="review room"');
    expect(empty.split('role="region"').length - 1).toBe(1);

    const loaded = renderRoom();
    expect(loaded).toContain('role="region"');
    expect(loaded).toContain('aria-label="review room"');
    expect(loaded.split('role="region"').length - 1).toBe(1);
    expect(loaded).toContain('first');
    expect(loaded).toContain('Read');
    expect(visibleText(loaded)).toContain('"path": "a.ts"');
    expect(loaded).toContain('started');
    expect(loaded).toContain('iteration_started');
    expect(loaded).toContain('failed');

    const textIndex = loaded.indexOf('first');
    const toolIndex = loaded.indexOf('Read');
    const failedIndex = loaded.lastIndexOf('failed');
    expect(textIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(textIndex);
    expect(failedIndex).toBeGreaterThan(toolIndex);

    const iterationTwo = renderRoom({ selection: { kind: 'loop_iteration', iteration: 2 } });
    expect(iterationTwo).toContain('Read');
    expect(visibleText(iterationTwo)).toContain('"path": "a.ts"');
    expect(iterationTwo).toContain('iteration_started');
    expect(iterationTwo).toContain('iteration_failed');
    expect(iterationTwo).not.toContain('first');
    expect(iterationTwo).toContain('role="region"');
    expect(iterationTwo).toContain('aria-label="review room"');

    const missingMarker = renderRoom({ selection: { kind: 'loop_iteration', iteration: 9 } });
    expect(missingMarker).toContain('first');
    expect(missingMarker).toContain('Read');
    expect(missingMarker).toContain('failed');

    const prohibited = `${loaded} ${iterationTwo} ${missingMarker} ${errorMarkup}`.toLowerCase();
    expect(prohibited.includes('ask')).toBe(false);
    expect(prohibited.includes('waiting')).toBe(false);
    expect(prohibited.includes('awaiting')).toBe(false);
    expect(prohibited.includes('pending-interaction')).toBe(false);
    expect(prohibited.includes('pending_interaction')).toBe(false);
  });
});
