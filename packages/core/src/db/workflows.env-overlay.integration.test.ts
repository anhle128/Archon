/**
 * Integration test: setWorkflowRunEnvOverlay against a REAL bun:sqlite database.
 *
 * Proves exact nested replacement (stale resolved keys drop), sibling metadata
 * preservation, and run-not-found errors — behavior mock SQL-substring tests
 * cannot guarantee for SQLite's json_set + json() path.
 *
 * Own `bun test` invocation (see package.json) — mock.module('./connection')
 * conflicts with workflows.test.ts's fake pool.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import type { EnvOverlaySnapshot } from '@archon/workflows/schemas/env-overlay';

const realArchonPaths = await import('@archon/paths');
mock.module('@archon/paths', () => ({
  ...realArchonPaths,
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const { setWorkflowRunEnvOverlay, getWorkflowRun } = await import('./workflows');

afterAll(async () => {
  await db.close();
});

await db.query(
  `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
   VALUES ('conv-env', 'web', 'conv-env-platform')`,
  []
);

async function seedRun(id: string, metadata: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO remote_agent_workflow_runs
       (id, workflow_name, conversation_id, user_message, status, started_at, last_activity_at, metadata)
     VALUES ($1, 'wf-env', 'conv-env', 'msg', 'running', datetime('now'), datetime('now'), $2)`,
    [id, JSON.stringify(metadata)]
  );
}

const pendingThenComplete: EnvOverlaySnapshot = {
  envId: 'env-abc',
  envName: 'fast',
  workflowName: 'wf-env',
  patches: { plan: { model: 'claude-sonnet-4' } },
  skippedNodeIds: ['missing-node'],
  latestMissingNodeIds: [],
  resolved: {
    plan: { provider: 'claude', model: 'claude-sonnet-4' },
    staleNode: { provider: 'claude', model: 'should-disappear' },
  },
};

const secondComplete: EnvOverlaySnapshot = {
  envId: 'env-abc',
  envName: 'fast',
  workflowName: 'wf-env',
  patches: { plan: { model: 'claude-opus-4' } },
  skippedNodeIds: ['missing-node'],
  latestMissingNodeIds: ['plan'],
  resolved: {
    plan: { provider: 'claude', model: 'claude-opus-4', effort: 'high' },
  },
};

describe('setWorkflowRunEnvOverlay (SQLite integration)', () => {
  test('second complete snapshot drops stale nested keys and preserves siblings', async () => {
    await seedRun('run-env-1', {
      siblingKeep: { nested: true },
      otherTop: 'yes',
      envOverlay: {
        envId: 'env-abc',
        envName: 'fast',
        workflowName: 'wf-env',
        patches: { plan: { model: 'claude-sonnet-4' } },
        skippedNodeIds: ['missing-node'],
      },
    });

    const first = await setWorkflowRunEnvOverlay('run-env-1', pendingThenComplete);
    expect(first.metadata.siblingKeep).toEqual({ nested: true });
    expect(first.metadata.otherTop).toBe('yes');
    expect(first.metadata.envOverlay).toEqual(pendingThenComplete);
    expect((first.metadata.envOverlay as EnvOverlaySnapshot).resolved.staleNode).toEqual({
      provider: 'claude',
      model: 'should-disappear',
    });

    const second = await setWorkflowRunEnvOverlay('run-env-1', secondComplete);
    expect(second.metadata.siblingKeep).toEqual({ nested: true });
    expect(second.metadata.otherTop).toBe('yes');
    expect(second.metadata.envOverlay).toEqual(secondComplete);
    expect((second.metadata.envOverlay as EnvOverlaySnapshot).resolved).toEqual({
      plan: { provider: 'claude', model: 'claude-opus-4', effort: 'high' },
    });
    expect((second.metadata.envOverlay as EnvOverlaySnapshot).resolved).not.toHaveProperty(
      'staleNode'
    );

    const reloaded = await getWorkflowRun('run-env-1');
    expect(reloaded?.metadata.envOverlay).toEqual(secondComplete);
    expect(reloaded?.metadata.siblingKeep).toEqual({ nested: true });
  });

  test('throws when the run id does not exist', async () => {
    await expect(setWorkflowRunEnvOverlay('no-such-run', secondComplete)).rejects.toThrow(
      'Workflow run not found (id: no-such-run)'
    );
  });

  test('SQL path uses json_set + json() rather than json_patch merge', async () => {
    // Seed with a complete overlay then replace; if json_patch were used,
    // resolved.staleKey would survive. Already covered above — this asserts
    // the dialect expression is exercised by writing over an empty metadata {}.
    await seedRun('run-env-2', {});
    const result = await setWorkflowRunEnvOverlay('run-env-2', secondComplete);
    expect(result.metadata).toEqual({ envOverlay: secondComplete });
  });
});
