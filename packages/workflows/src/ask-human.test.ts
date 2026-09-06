import { beforeEach, describe, expect, test, mock } from 'bun:test';
import { AskHumanAwaitingError } from '@archon/providers/types';
import type { IWorkflowStore } from './store';

const infoLogs: unknown[][] = [];
mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => infoLogs.push(args),
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { createAskHumanTool, ASK_HUMAN_INPUT_SCHEMA } = await import('./ask-human');

beforeEach(() => {
  infoLogs.length = 0;
});

const questions = [
  {
    id: 'q1',
    prompt: 'Ship it?',
    selection: 'single' as const,
    options: ['yes', 'no'],
    allowOther: false,
  },
];

function store(overrides: Partial<IWorkflowStore> = {}): IWorkflowStore {
  return {
    insertPendingInteraction: mock(async input => ({
      id: 'pending-1',
      status: 'pending' as const,
      answer: null,
      created_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      ...input,
    })),
    listPendingInteractions: mock(async () => []),
    ...overrides,
  } as IWorkflowStore;
}

describe('AskHuman tool', () => {
  test('persists envelope without answer then throws AskHumanAwaitingError', async () => {
    const s = store();
    const tool = createAskHumanTool({
      store: s,
      workflowRunId: 'run-1',
      nodeId: 'review',
    });
    expect(tool.name).toBe('AskHuman');
    expect(tool.inputSchema).toBe(ASK_HUMAN_INPUT_SCHEMA);
    await expect(
      tool.handler({ questions }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })
    ).rejects.toBeInstanceOf(AskHumanAwaitingError);
    expect(s.insertPendingInteraction).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      node_id: 'review',
      tool_use_id: 'toolu_1',
      kind: 'ask',
      envelope: { questions },
      provider_session_id: 'sess-1',
    });
    expect(JSON.stringify(infoLogs)).toContain('workflow.ask_pending');
    expect(JSON.stringify(infoLogs)).toContain('toolu_1');
    expect(JSON.stringify(infoLogs)).not.toContain('Ship it?');
  });

  test('does not stringify invalid questions as awaiting', async () => {
    const s = store();
    const tool = createAskHumanTool({ store: s, workflowRunId: 'run-1', nodeId: 'review' });
    await expect(
      tool.handler({ questions: 'nope' }, { toolUseId: 'toolu_1', sessionId: 'sess-1' })
    ).rejects.not.toBeInstanceOf(AskHumanAwaitingError);
    expect(s.insertPendingInteraction).not.toHaveBeenCalled();
  });

  test('requires the real tool-use id and provider session id', async () => {
    const s = store();
    const tool = createAskHumanTool({ store: s, workflowRunId: 'run-1', nodeId: 'review' });
    await expect(tool.handler({ questions }, { sessionId: 'sess-1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    await expect(tool.handler({ questions }, { toolUseId: 'toolu_1' })).rejects.not.toBeInstanceOf(
      AskHumanAwaitingError
    );
    expect(s.insertPendingInteraction).not.toHaveBeenCalled();
  });
});
