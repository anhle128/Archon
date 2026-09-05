import { describe, test, expect } from 'bun:test';
import { toRun, normalizeOrigin, runMessageConversationId, parseRunEnvOverlay } from './run';

type Raw = Parameters<typeof toRun>[0];

function raw(over: Partial<Raw> & { id: string; workflow_name: string; status: string }): Raw {
  return {
    codebase_id: null,
    started_at: '2026-06-05T10:00:00Z',
    ...over,
  };
}

describe('normalizeOrigin', () => {
  test('maps each known platform_type to its RunOrigin', () => {
    expect(normalizeOrigin('web')).toBe('web');
    expect(normalizeOrigin('cli')).toBe('cli');
    expect(normalizeOrigin('slack')).toBe('slack');
    expect(normalizeOrigin('telegram')).toBe('telegram');
    expect(normalizeOrigin('discord')).toBe('discord');
    expect(normalizeOrigin('github')).toBe('github');
  });

  test('is case-insensitive', () => {
    expect(normalizeOrigin('CLI')).toBe('cli');
    expect(normalizeOrigin('GitHub')).toBe('github');
  });

  test('null, undefined, and unknown strings fall back to "unknown"', () => {
    expect(normalizeOrigin(null)).toBe('unknown');
    expect(normalizeOrigin(undefined)).toBe('unknown');
    expect(normalizeOrigin('carrier-pigeon')).toBe('unknown');
  });
});

describe('toRun — provenance', () => {
  test('userMessage defaults to empty string when absent', () => {
    const r = toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'running' }));
    expect(r.userMessage).toBe('');
  });

  test('userMessage passes through when present', () => {
    const r = toRun(
      raw({ id: 'r1', workflow_name: 'plan', status: 'running', user_message: 'summarise PRs' })
    );
    expect(r.userMessage).toBe('summarise PRs');
  });

  test('origin is derived from platform_type', () => {
    const r = toRun(
      raw({ id: 'r1', workflow_name: 'plan', status: 'running', platform_type: 'web' })
    );
    expect(r.origin).toBe('web');
  });

  test('detail-sourced row still populates conversationPlatformId (unchanged behavior)', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        conversation_platform_id: 'cli-detail-789',
      })
    );
    expect(r.conversationPlatformId).toBe('cli-detail-789');
  });

  test('worker_platform_id maps through for chat-dispatched runs; absent → null', () => {
    const web = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        worker_platform_id: 'web-worker-123-abc',
      })
    );
    expect(web.workerPlatformId).toBe('web-worker-123-abc');
    expect(web.conversationPlatformId).toBeNull();

    const bare = toRun(raw({ id: 'r2', workflow_name: 'plan', status: 'completed' }));
    expect(bare.workerPlatformId).toBeNull();
  });

  test("normalizes the transient 'pending' status to running", () => {
    const r = toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'pending' }));
    expect(r.status).toBe('running');
  });

  test('an unrecognised status falls back to running', () => {
    const r = toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'banana' }));
    expect(r.status).toBe('running');
  });
});

describe('runMessageConversationId', () => {
  test('CLI run: uses conversationPlatformId (unchanged behavior)', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        conversation_platform_id: 'cli-1776237248436-q61o4h',
      })
    );
    expect(runMessageConversationId(r)).toBe('cli-1776237248436-q61o4h');
  });

  test('chat-dispatched run: falls back to the worker conversation (#2048)', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        conversation_platform_id: null,
        worker_platform_id: 'web-worker-1784559376043-8p44vw',
      })
    );
    expect(runMessageConversationId(r)).toBe('web-worker-1784559376043-8p44vw');
  });

  test('prefers conversationPlatformId when both are present', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        conversation_platform_id: 'cli-abc',
        worker_platform_id: 'web-worker-xyz',
      })
    );
    expect(runMessageConversationId(r)).toBe('cli-abc');
  });

  test('list-sourced row (neither field) → null, message fetching stays off', () => {
    const r = toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'running' }));
    expect(runMessageConversationId(r)).toBeNull();
  });

  test('not-yet-loaded run (undefined) → null', () => {
    expect(runMessageConversationId(undefined)).toBeNull();
  });
});

describe('toRun — cost', () => {
  test('reads a positive total_cost_usd from metadata', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        metadata: { total_cost_usd: 1.5 },
      })
    );
    expect(r.costUsd).toBe(1.5);
  });

  test('preserves authoritative reported zero from metadata', () => {
    const zero = toRun(
      raw({ id: 'r1', workflow_name: 'plan', status: 'completed', metadata: { total_cost_usd: 0 } })
    );
    expect(zero.costUsd).toBe(0);
  });

  test('rejects negative and non-finite total_cost_usd', () => {
    expect(
      toRun(
        raw({
          id: 'r1',
          workflow_name: 'plan',
          status: 'completed',
          metadata: { total_cost_usd: -0.01 },
        })
      ).costUsd
    ).toBeNull();
    expect(
      toRun(
        raw({
          id: 'r1',
          workflow_name: 'plan',
          status: 'completed',
          metadata: { total_cost_usd: Number.NaN },
        })
      ).costUsd
    ).toBeNull();
    expect(
      toRun(
        raw({
          id: 'r1',
          workflow_name: 'plan',
          status: 'completed',
          metadata: { total_cost_usd: Number.POSITIVE_INFINITY },
        })
      ).costUsd
    ).toBeNull();
  });

  test('cost is null when metadata is absent or non-numeric', () => {
    expect(toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'completed' })).costUsd).toBeNull();
    expect(
      toRun(
        raw({
          id: 'r1',
          workflow_name: 'plan',
          status: 'completed',
          metadata: { total_cost_usd: 'free' },
        })
      ).costUsd
    ).toBeNull();
  });
});

describe('toRun — approval parsing', () => {
  test('parses a well-formed approval from metadata', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate', message: 'Approve?' } },
      })
    );
    expect(r.approval).toEqual({ nodeId: 'gate', message: 'Approve?', completionSignaled: false });
  });

  test('surfaces completionSignaled on a signal-bearing interactive-loop gate (#2074)', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'validate',
        status: 'paused',
        metadata: {
          approval: {
            nodeId: 'refine',
            message: 'gate',
            type: 'interactive_loop',
            completionSignaled: true,
            signaledOutput: 'REPORT',
          },
        },
      })
    );
    expect(r.approval?.completionSignaled).toBe(true);
  });

  test('defaults message to empty string when only nodeId is present', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate' } },
      })
    );
    expect(r.approval).toEqual({ nodeId: 'gate', message: '', completionSignaled: false });
  });

  test('approval is null when absent or malformed (no string nodeId)', () => {
    expect(toRun(raw({ id: 'r1', workflow_name: 'review', status: 'paused' })).approval).toBeNull();
    expect(
      toRun(
        raw({
          id: 'r1',
          workflow_name: 'review',
          status: 'paused',
          metadata: { approval: { message: 'no node id' } },
        })
      ).approval
    ).toBeNull();
  });
});

describe('toRun — resolved gate (approved/rejected awaiting resume)', () => {
  test('resolved approval hides the pending gate and sets gateResolved', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate', message: 'Approve?', resolved: 'approved' } },
      })
    );
    // No stale approve/reject buttons for an already-resolved gate.
    expect(r.approval).toBeNull();
    expect(r.gateResolved).toBe('approved');
  });

  test('resolved rejection maps to gateResolved: rejected', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate', message: 'Approve?', resolved: 'rejected' } },
      })
    );
    expect(r.approval).toBeNull();
    expect(r.gateResolved).toBe('rejected');
  });

  test('explicit null resolved (fresh pause) keeps the gate pending', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate', message: 'Approve?', resolved: null } },
      })
    );
    expect(r.approval).toEqual({ nodeId: 'gate', message: 'Approve?', completionSignaled: false });
    expect(r.gateResolved).toBeNull();
  });

  test('unknown resolved values are treated as unresolved', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'review',
        status: 'paused',
        metadata: { approval: { nodeId: 'gate', message: 'Approve?', resolved: 'weird' } },
      })
    );
    expect(r.approval).toEqual({ nodeId: 'gate', message: 'Approve?', completionSignaled: false });
    expect(r.gateResolved).toBeNull();
  });
});

describe('toRun / parseRunEnvOverlay — ENV overlay metadata', () => {
  test('absent metadata yields null envOverlay', () => {
    const r = toRun(raw({ id: 'r1', workflow_name: 'plan', status: 'running' }));
    expect(r.envOverlay).toBeNull();
  });

  test('pending applied form parses identity + skipped without resolved', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'running',
        metadata: {
          envOverlay: {
            envId: 'e1',
            envName: 'fast',
            workflowName: 'plan',
            patches: { plan: { model: 'haiku', prompt: 'SECRET_BODY' } },
            skippedNodeIds: ['missing'],
          },
        },
      })
    );
    expect(r.envOverlay).toEqual({
      envId: 'e1',
      envName: 'fast',
      workflowName: 'plan',
      complete: false,
      skippedNodeIds: ['missing'],
      latestMissingNodeIds: [],
      resolved: null,
    });
    // Prompt/bash never surface on the Run primitive.
    expect(JSON.stringify(r.envOverlay)).not.toContain('SECRET_BODY');
    expect(JSON.stringify(r.envOverlay)).not.toContain('prompt');
  });

  test('complete snapshot sorts resolved rows and keeps warnings', () => {
    const r = toRun(
      raw({
        id: 'r1',
        workflow_name: 'plan',
        status: 'completed',
        metadata: {
          envOverlay: {
            envId: 'e1',
            envName: 'fast',
            workflowName: 'plan',
            patches: {},
            skippedNodeIds: ['gone'],
            latestMissingNodeIds: ['plan'],
            resolved: {
              zeta: { provider: 'claude', model: 'sonnet', effort: 'high' },
              alpha: {
                provider: 'codex',
                tier: 'large',
                thinking: { type: 'enabled', budgetTokens: 2048 },
              },
            },
          },
        },
      })
    );
    expect(r.envOverlay?.complete).toBe(true);
    expect(r.envOverlay?.skippedNodeIds).toEqual(['gone']);
    expect(r.envOverlay?.latestMissingNodeIds).toEqual(['plan']);
    expect(r.envOverlay?.resolved?.map(row => row.nodeId)).toEqual(['alpha', 'zeta']);
    expect(r.envOverlay?.resolved?.[0]).toMatchObject({
      nodeId: 'alpha',
      provider: 'codex',
      tier: 'large',
      thinking: { type: 'enabled', budgetTokens: 2048 },
    });
  });

  test('malformed and legacy hybrids return null — never false audit state', () => {
    expect(parseRunEnvOverlay(undefined)).toBeNull();
    expect(parseRunEnvOverlay({})).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: null })).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: 'legacy-string' })).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: ['array'] })).toBeNull();
    expect(parseRunEnvOverlay({ envOverlay: { envName: 'only-name' } })).toBeNull();

    const identity = {
      envId: 'e1',
      envName: 'fast',
      workflowName: 'plan',
    };

    // Missing or non-object patches.
    expect(
      parseRunEnvOverlay({
        envOverlay: { ...identity, skippedNodeIds: [] },
      })
    ).toBeNull();
    expect(
      parseRunEnvOverlay({
        envOverlay: { ...identity, patches: null, skippedNodeIds: [] },
      })
    ).toBeNull();
    expect(
      parseRunEnvOverlay({
        envOverlay: { ...identity, patches: ['not-object'], skippedNodeIds: [] },
      })
    ).toBeNull();

    // Non-array skippedNodeIds / latestMissingNodeIds.
    expect(
      parseRunEnvOverlay({
        envOverlay: { ...identity, patches: {}, skippedNodeIds: 'not-array' },
      })
    ).toBeNull();
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: 'not-array',
          resolved: {},
        },
      })
    ).toBeNull();

    // Non-object resolved (array or scalar).
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: 'not-object',
        },
      })
    ).toBeNull();
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: [{ provider: 'claude' }],
        },
      })
    ).toBeNull();

    // Invalid resolved row (missing provider) — whole overlay null, not partial complete.
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: {
            good: { provider: 'claude', model: 'sonnet' },
            bad: { model: 'no-provider' },
          },
        },
      })
    ).toBeNull();

    // Hybrid: resolved without latestMissingNodeIds (or vice versa).
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          resolved: { plan: { provider: 'claude' } },
        },
      })
    ).toBeNull();
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
        },
      })
    ).toBeNull();

    // Corrupt non-array fields must not manufacture complete:true with empty resolved.
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: { plan: { prompt: 'SECRET_BODY' } },
          skippedNodeIds: 'not-array',
          resolved: 'not-object',
        },
      })
    ).toBeNull();
  });

  test('present invalid resolved-row fields and unexpected keys return null', () => {
    const identity = {
      envId: 'e1',
      envName: 'fast',
      workflowName: 'plan',
    };
    const completeBase = {
      ...identity,
      patches: {},
      skippedNodeIds: [] as string[],
      latestMissingNodeIds: [] as string[],
    };

    const parseResolved = (row: Record<string, unknown>) =>
      parseRunEnvOverlay({
        envOverlay: {
          ...completeBase,
          resolved: { plan: row },
        },
      });

    // Present non-string / empty model.
    expect(parseResolved({ provider: 'claude', model: 42 })).toBeNull();
    expect(parseResolved({ provider: 'claude', model: '' })).toBeNull();
    expect(parseResolved({ provider: 'claude', model: null as unknown as string })).toBeNull();

    // Invalid tier (present but not small|medium|large).
    expect(parseResolved({ provider: 'claude', tier: 'xlarge' })).toBeNull();
    expect(parseResolved({ provider: 'claude', tier: '' })).toBeNull();
    expect(parseResolved({ provider: 'claude', tier: 1 as unknown as string })).toBeNull();

    // Invalid effort / modelReasoningEffort (present non-empty-string required).
    expect(parseResolved({ provider: 'claude', effort: '' })).toBeNull();
    expect(parseResolved({ provider: 'claude', effort: 3 as unknown as string })).toBeNull();
    expect(parseResolved({ provider: 'claude', modelReasoningEffort: '' })).toBeNull();
    expect(
      parseResolved({ provider: 'claude', modelReasoningEffort: false as unknown as string })
    ).toBeNull();

    // Malformed / unsupported thinking.
    expect(parseResolved({ provider: 'claude', thinking: 'nope' })).toBeNull();
    expect(parseResolved({ provider: 'claude', thinking: { type: 'turbo' } })).toBeNull();
    expect(
      parseResolved({ provider: 'claude', thinking: { type: 'enabled', budgetTokens: 0 } })
    ).toBeNull();
    expect(
      parseResolved({ provider: 'claude', thinking: { type: 'enabled', budgetTokens: 1.5 } })
    ).toBeNull();
    expect(
      parseResolved({
        provider: 'claude',
        thinking: { type: 'adaptive', extra: true },
      })
    ).toBeNull();
    expect(parseResolved({ provider: 'claude', thinking: null as unknown as object })).toBeNull();

    // Unexpected resolved-row key.
    expect(parseResolved({ provider: 'claude', prompt: 'SECRET' })).toBeNull();
    expect(parseResolved({ provider: 'claude', unknownField: 'x' })).toBeNull();

    // Valid optional fields still parse (control).
    expect(
      parseResolved({
        provider: 'claude',
        model: 'sonnet',
        tier: 'medium',
        effort: 'high',
        thinking: { type: 'enabled', budgetTokens: 1024 },
      })
    ).not.toBeNull();
    expect(
      parseResolved({ provider: 'claude', thinking: 'adaptive' })?.resolved?.[0]
    ).toMatchObject({
      nodeId: 'plan',
      provider: 'claude',
      thinking: { type: 'adaptive' },
    });
  });

  test('complete overlay with unexpected top-level key returns null', () => {
    const identity = {
      envId: 'e1',
      envName: 'fast',
      workflowName: 'plan',
    };

    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: { plan: { provider: 'claude' } },
          extraTop: true,
        },
      })
    ).toBeNull();

    // Pending form also rejects unexpected top-level keys.
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          legacyNote: 'nope',
        },
      })
    ).toBeNull();

    // Valid complete/pending unchanged.
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: [],
          latestMissingNodeIds: [],
          resolved: { plan: { provider: 'claude', model: 'sonnet' } },
        },
      })
    ).toMatchObject({
      complete: true,
      envName: 'fast',
      resolved: [{ nodeId: 'plan', provider: 'claude', model: 'sonnet' }],
    });
    expect(
      parseRunEnvOverlay({
        envOverlay: {
          ...identity,
          patches: {},
          skippedNodeIds: ['gone'],
        },
      })
    ).toMatchObject({
      complete: false,
      skippedNodeIds: ['gone'],
      resolved: null,
    });
  });
});
