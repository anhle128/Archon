import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { HttpError } from '../lib/http';
import { K } from '../store/keys';
import {
  getNodeMessage,
  getNodeMessages,
  getRun,
  listNodeMessages,
  type RunDetailResponse,
} from './runs';
import type { components } from '@/lib/api.generated';

type FetchSpy = ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

let fetchSpy: FetchSpy | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): FetchSpy {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as typeof fetch);
  return fetchSpy;
}

function ensureWindow(): void {
  if (typeof (globalThis as { window?: { location: { origin: string } } }).window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'http://localhost', hostname: 'localhost' } },
    });
  }
}

function detailRun(id: string): RunDetailResponse['run'] {
  return {
    id,
    workflow_name: 'inspect',
    conversation_id: 'c1',
    parent_conversation_id: null,
    codebase_id: 'proj-1',
    status: 'completed',
    user_message: 'inspect this run',
    metadata: {},
    started_at: '2026-09-07T00:00:00.000Z',
    completed_at: '2026-09-07T00:01:00.000Z',
    last_activity_at: '2026-09-07T00:01:00.000Z',
    working_path: '/repo',
    user_id: null,
    parent_run_id: null,
    output_root: null,
    conversation_platform_id: 'cli-1',
  };
}

describe('getRun inspect boundary', () => {
  test('encodes the run id and returns untouched rawEvents, nodeStates, and approval', async () => {
    const approval = { nodeId: 'gate', prompt: 'ship it?', resolved: undefined };
    const rawEvent: components['schemas']['WorkflowEvent'] = {
      id: 'evt-run-1',
      workflow_run_id: 'run/1',
      event_type: 'node_started',
      step_index: 0,
      step_name: 'build',
      data: { keep: 'raw' },
      created_at: '2026-09-07T00:00:01.000Z',
    };
    const nodeStates: components['schemas']['WorkflowNodeState'][] = [
      { nodeId: 'build', name: 'build', status: 'completed', retryEpoch: 0 },
    ];
    const usage: RunDetailResponse['usage'] = null;
    const run = { ...detailRun('run/1'), metadata: { approval } };

    stubFetch(url => {
      expect(url).toBe('/api/workflows/runs/run%2F1');
      return jsonResponse({
        run,
        events: [rawEvent],
        nodeStates,
        pending_interactions: [],
        usage,
        viewer_is_starter: false,
        starter_display_name: null,
      } satisfies RunDetailResponse);
    });

    const result = await getRun('run/1');

    expect(fetchSpy?.mock.calls[0]?.[0]).toBe('/api/workflows/runs/run%2F1');
    expect(result.rawEvents).toEqual([rawEvent]);
    expect(result.nodeStates).toEqual(nodeStates);
    expect(result.approval).toEqual(approval);
    expect(result.run.id).toBe('run/1');
    expect(result.run.workflow).toBe('inspect');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe('evt-run-1');
    expect(result.rawEvents[0]).toMatchObject({
      event_type: 'node_started',
      data: { keep: 'raw' },
    });
    expect(result.usage).toBeNull();
  });

  test('keeps pending interactions, viewer presentation, and string metadata error', async () => {
    const pending: components['schemas']['PendingInteraction'] = {
      id: 'pi-1',
      workflow_run_id: 'run/1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      status: 'pending',
      envelope: {
        questions: [
          { id: 'q1', prompt: 'Ship?', selection: 'single', options: ['yes'], allowOther: false },
        ],
      },
      answer: null,
      provider_session_id: 'sess-1',
      created_at: '2026-09-07T00:00:00.000Z',
      resolved_at: null,
      resolved_by: null,
    };
    stubFetch(() =>
      jsonResponse({
        run: {
          ...detailRun('run/1'),
          user_id: 'user-1',
          metadata: { error: 'AskHuman is not supported by provider: grok' },
        },
        events: [],
        nodeStates: [],
        pending_interactions: [pending],
        usage: null,
        viewer_is_starter: true,
        starter_display_name: 'Avery',
      } satisfies RunDetailResponse)
    );
    const result = await getRun('run/1');
    expect(result.pendingInteractions).toEqual([pending]);
    expect(result.viewerIsStarter).toBe(true);
    expect(result.starterDisplayName).toBe('Avery');
    expect(result.runError).toBe('AskHuman is not supported by provider: grok');

    fetchSpy?.mockRestore();
    stubFetch(() =>
      jsonResponse({
        run: { ...detailRun('run/1'), metadata: { error: { unsafe: true } } },
        events: [],
        nodeStates: [],
        pending_interactions: [],
        usage: null,
        viewer_is_starter: false,
        starter_display_name: null,
      } satisfies RunDetailResponse)
    );
    const nonStringError = await getRun('run/1');
    expect(nonStringError.pendingInteractions).toEqual([]);
    expect(nonStringError.viewerIsStarter).toBe(false);
    expect(nonStringError.starterDisplayName).toBeNull();
    expect(nonStringError.runError).toBeNull();
  });

  test('rejects a non-2xx getRun response through requestJson', async () => {
    ensureWindow();
    stubFetch(url => {
      expect(url).toBe('/api/workflows/runs/run%2Ferr-get');
      return jsonResponse({ error: 'nope' }, 404);
    });

    await expect(getRun('run/err-get')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('listNodeMessages inspect boundary', () => {
  test('encodes run and node ids and returns text, tool, and status entries unchanged', async () => {
    const text: components['schemas']['WorkflowNodeMessage'] = {
      kind: 'text',
      payload: { text: 'hello' },
      id: 'm-text',
      seq: 1,
      created_at: '2026-09-07T00:00:02.000Z',
    };
    const tool: components['schemas']['WorkflowNodeMessage'] = {
      kind: 'tool',
      payload: { name: 'bash', id: 'tool-1', input: { cmd: 'ls' }, output: { ok: true } },
      id: 'm-tool',
      seq: 2,
      created_at: '2026-09-07T00:00:03.000Z',
    };
    const status: components['schemas']['WorkflowNodeMessage'] = {
      kind: 'status',
      payload: { state: 'completed', detail: 'done' },
      id: 'm-status',
      seq: 3,
      created_at: '2026-09-07T00:00:04.000Z',
    };

    stubFetch(url => {
      expect(url).toBe('/api/workflows/runs/run%2F1/nodes/node%20a/messages');
      return jsonResponse({ messages: [text, tool, status] });
    });

    const result = await listNodeMessages('run/1', 'node a');

    expect(fetchSpy?.mock.calls[0]?.[0]).toBe(
      '/api/workflows/runs/run%2F1/nodes/node%20a/messages'
    );
    expect(result.messages).toEqual([text, tool, status]);
    expect(result.messages.map(m => m.kind)).toEqual(['text', 'tool', 'status']);
  });

  test('rejects a non-2xx listNodeMessages response through requestJson', async () => {
    ensureWindow();
    stubFetch(url => {
      expect(url).toBe('/api/workflows/runs/run%2Ferr-msg/nodes/node%2Ferr/messages');
      return jsonResponse({ error: 'boom' }, 500);
    });

    await expect(listNodeMessages('run/err-msg', 'node/err')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('K.nodeMessages', () => {
  test('encodes each segment independently so ids cannot collide', () => {
    expect(K.nodeMessages('run/1', 'node a')).toBe('run-node-messages:run%2F1:node%20a');
    expect(K.nodeMessages('run:1', 'a')).not.toBe(K.nodeMessages('run', '1:a'));
  });
});

describe('getNodeMessages inspect boundary', () => {
  test('forwards AbortSignal through requestJson and keeps cursor query params', async () => {
    // Omitting RequestInit.signal from requestJson must fail this test.
    const controller = new AbortController();
    stubFetch((url, init) => {
      expect(url).toBe(
        '/api/workflows/runs/run%2F1/nodes/node%20a/messages?afterSeq=4&limit=10&occurrenceId=11111111-1111-4111-8111-111111111111&attemptId=22222222-2222-4222-8222-222222222222'
      );
      expect(url).not.toContain('signal');
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse({ messages: [], hasMore: false, highWatermark: 0 });
    });

    await getNodeMessages('run/1', 'node a', {
      afterSeq: 4,
      limit: 10,
      occurrenceId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      signal: controller.signal,
    });

    expect(fetchSpy?.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('getNodeMessage inspect boundary', () => {
  test('encodes slash and space ids, returns the row, and forwards AbortSignal', async () => {
    // Omitting RequestInit.signal from requestJson must fail this test.
    const message: components['schemas']['WorkflowNodeMessage'] = {
      kind: 'text',
      payload: { text: 'full' },
      id: 'message/one',
      seq: 1,
      created_at: '2026-09-07T00:00:02.000Z',
    };
    const controller = new AbortController();
    stubFetch((url, init) => {
      expect(url).toBe('/api/workflows/runs/run%2Fone/nodes/node%20one/messages/message%2Fone');
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse(message);
    });

    const result = await getNodeMessage('run/one', 'node one', 'message/one', {
      signal: controller.signal,
    });

    expect(fetchSpy?.mock.calls[0]?.[0]).toBe(
      '/api/workflows/runs/run%2Fone/nodes/node%20one/messages/message%2Fone'
    );
    expect(result).toEqual(message);
    expect(fetchSpy?.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
