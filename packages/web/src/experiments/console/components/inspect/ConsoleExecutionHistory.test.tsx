process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { ConsoleLogEntry } from './build-console-log-entries';
import type { Run } from '../../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
} from '../../skills/runs';
import { installHappyDom, restoreHappyDom } from '../../test/install-happy-dom';
import { UNSCOPED_INTERACTION_LIMITATION } from './execution-interactions';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const historyModule = await import('./ConsoleExecutionHistory');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';
const OCC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OCC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTEMPT_A = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_B = '22222222-2222-4222-8222-222222222222';

function occurrenceEntry(
  id: string,
  occurrenceId: string,
  attemptId: string,
  order: number,
  unknownScope = false
): ConsoleLogEntry {
  return {
    row: {
      id,
      nodeId: 'review',
      label: 'Review',
      status: 'completed',
      order,
      sourceIndex: order,
      selection: { kind: 'occurrence', occurrenceId, attemptId },
      unknownScope,
    },
    displayStatus: 'completed',
    startedAt: CREATED_AT,
    durationMs: null,
    costUsd: null,
    numTurns: null,
    stopReason: null,
    skipReason: null,
    skipExpr: null,
    showNodeUsage: true,
  };
}

function run(): Run {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    projectName: 'demo',
    costUsd: null,
    conversationId: null,
    conversationPlatformId: null,
    workerPlatformId: null,
    workflow: 'inspect',
    origin: 'cli',
    status: 'completed',
    startedAt: CREATED_AT,
    finishedAt: CREATED_AT,
    workingPath: null,
    userMessage: 'inspect',
    envOverlay: null,
  };
}

function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-ask',
    kind: 'ask',
    status: 'pending',
    envelope: {
      questions: [
        {
          id: 'q1',
          prompt: 'Ship it?',
          selection: 'single',
          options: ['Ship', 'Hold'],
          allowOther: false,
        },
      ],
    },
    answer: null,
    provider_session_id: 'session-1',
    created_at: CREATED_AT,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('ConsoleExecutionHistory', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  const first = occurrenceEntry('row-a', OCC_A, ATTEMPT_A, 0);
  const second = occurrenceEntry('row-b', OCC_B, ATTEMPT_B, 1);
  const all = [first, second];

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(`${label}: ${host.textContent ?? ''}`);
  }

  function renderHistory(
    overrides: Partial<Parameters<typeof historyModule.ConsoleExecutionHistory>[0]> & {
      loadMessages: (
        runId: string,
        nodeId: string,
        options?: {
          afterSeq?: number;
          limit?: number;
          occurrenceId?: string;
          attemptId?: string;
          signal?: AbortSignal;
        }
      ) => Promise<WorkflowNodeMessagesResponse>;
    }
  ): void {
    act(() => {
      root.render(
        createElement(historyModule.ConsoleExecutionHistory, {
          entry: second,
          allEntries: all,
          run: run(),
          events: [],
          isLive: false,
          pendingInteractions: [],
          showToolCalls: true,
          showSystem: true,
          viewerIsStarter: true,
          starterDisplayName: 'Avery',
          actionStates: {},
          onSubmitAsk: async (_requestId: string, _body: AskAnswerBody): Promise<void> => undefined,
          ...overrides,
        })
      );
    });
  }

  test('loads occurrence B with limit 100 and AbortSignal, then renders only that history', async () => {
    const recorded: {
      occurrenceId?: string;
      attemptId?: string;
      limit?: number;
      afterSeq?: number;
      signal?: AbortSignal;
    }[] = [];
    renderHistory({
      loadMessages: async (_runId, _nodeId, options) => {
        recorded.push({
          occurrenceId: options?.occurrenceId,
          attemptId: options?.attemptId,
          limit: options?.limit,
          afterSeq: options?.afterSeq,
          signal: options?.signal,
        });
        return {
          messages: [
            {
              id: 't-b',
              seq: 1,
              kind: 'text',
              payload: { text: 'occ-b-assistant' },
              created_at: CREATED_AT,
            },
            {
              id: 'tool-b',
              seq: 2,
              kind: 'tool',
              payload: { name: 'Bash', id: 'tool-b', input: { cmd: 'ls' }, output: { ok: true } },
              created_at: CREATED_AT,
            },
          ],
        };
      },
    });
    await flushUntil('occ b', () => (host.textContent ?? '').includes('occ-b-assistant'));
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0]?.occurrenceId).toBe(OCC_B);
    expect(recorded[0]?.attemptId).toBe(ATTEMPT_B);
    expect(recorded[0]?.limit).toBe(100);
    expect(recorded[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(host.textContent).toContain('ASSISTANT');
    expect(host.textContent).toContain('Bash');
    expect(host.textContent).not.toContain('occ-a-assistant');
  });

  test('renders a matching Ask after recorded history', async () => {
    renderHistory({
      pendingInteractions: [
        ask({ execution_scope: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } }),
      ],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'occ-b-assistant' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('ask', () => (host.textContent ?? '').includes('Ship it?'));
    const text = host.textContent ?? '';
    expect(text.indexOf('occ-b-assistant')).toBeLessThan(text.indexOf('Ship it?'));
    expect(host.querySelector('form')).not.toBeNull();
  });

  test('shows the unscoped Ask limitation', async () => {
    renderHistory({
      pendingInteractions: [ask()],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'occ-b-assistant' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('limitation', () =>
      (host.textContent ?? '').includes(UNSCOPED_INTERACTION_LIMITATION)
    );
    expect(host.textContent).toContain('Ship it?');
  });

  test('keeps the Ask when Tool and System are hidden', async () => {
    renderHistory({
      showToolCalls: false,
      showSystem: false,
      pendingInteractions: [
        ask({ execution_scope: { occurrence_id: OCC_B, attempt_id: ATTEMPT_B } }),
      ],
      loadMessages: async (): Promise<WorkflowNodeMessagesResponse> => ({
        messages: [
          {
            id: 't-b',
            seq: 1,
            kind: 'text',
            payload: { text: 'keep-me' },
            created_at: CREATED_AT,
          },
          {
            id: 'tool-1',
            seq: 2,
            kind: 'tool',
            payload: { name: 'AskHuman', id: 'tool-ask', input: {} },
            created_at: CREATED_AT,
          },
          {
            id: 'st1',
            seq: 3,
            kind: 'status',
            payload: { state: 'iteration_started', detail: '1' },
            created_at: CREATED_AT,
          },
        ],
      }),
    });
    await flushUntil('ask remains', () => (host.textContent ?? '').includes('Ship it?'));
    expect(host.textContent).toContain('keep-me');
    expect(host.textContent).not.toContain('AskHuman');
    expect(host.textContent).not.toContain('iteration_started');
    expect(host.querySelector('form')).not.toBeNull();
  });

  test('retains page one and Retry when page two is rejected', async () => {
    const pageOne: WorkflowNodeMessage = {
      id: 'p1',
      seq: 1,
      kind: 'text',
      payload: { text: 'page-one' },
      created_at: CREATED_AT,
    };
    renderHistory({
      loadMessages: async (_runId, _nodeId, options): Promise<WorkflowNodeMessagesResponse> => {
        if ((options?.afterSeq ?? 0) === 0) {
          return {
            messages: [pageOne],
            hasMore: true,
            nextCursor: '1',
            highWatermark: 2,
          };
        }
        throw new Error('page two failed');
      },
    });
    await flushUntil('page one', () => (host.textContent ?? '').includes('page-one'));
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).toContain('Failed to load node transcript');
  });
});
