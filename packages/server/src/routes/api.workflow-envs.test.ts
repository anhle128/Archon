/**
 * Route tests for Workflow ENV CRUD + preview (US-007).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ConversationLockManager } from '@archon/core';
import type { WebAdapter } from '../adapters/web';
import { clearRegistry, registerBuiltinProviders } from '@archon/providers';
import { validationErrorHook } from './openapi-defaults';
import { makeTestWorkflow, makeTestWorkflowWithSource } from '@archon/workflows/test-utils';

beforeAll(() => {
  clearRegistry();
  registerBuiltinProviders();
});

afterAll(() => {
  clearRegistry();
});
function createTestApp(): OpenAPIHono {
  return new OpenAPIHono({ defaultHook: validationErrorHook });
}

const mockListCodebases = mock(async () => [{ default_cwd: '/tmp/project' }]);
const mockDiscoverWorkflows = mock(async (_cwd: string | null) => ({
  workflows: [
    makeTestWorkflowWithSource(
      {
        name: 'feature',
        description: 'Feature workflow',
        nodes: [
          { id: 'research', prompt: 'research it' },
          { id: 'ship', bash: 'echo ship' },
          {
            id: 'group',
            loop_group: {
              nodes: [{ id: 'inner', prompt: 'nested' }],
              until: 'DONE',
              max_iterations: 2,
            },
          },
        ],
      },
      'project'
    ),
  ],
  errors: [],
}));

const mockListEnvSummaries = mock(async (_workflowName: string) => [
  {
    id: 'env-1',
    workflow_name: 'feature',
    name: 'baseline',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    created_by_user_id: null,
  },
]);

const mockGetEnvById = mock(async (envId: string) => {
  if (envId === 'env-1') {
    return {
      id: 'env-1',
      workflow_name: 'feature',
      name: 'baseline',
      patches: { research: { model: 'haiku' } },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      created_by_user_id: 'user-1',
    };
  }
  if (envId === 'env-other') {
    return {
      id: 'env-other',
      workflow_name: 'other-workflow',
      name: 'x',
      patches: { research: { model: 'haiku' } },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      created_by_user_id: null,
    };
  }
  if (envId === 'env-corrupt') {
    throw Object.assign(new Error('Workflow ENV row corrupt: env-corrupt'), {
      name: 'WorkflowEnvCorruptRowError',
      envId: 'env-corrupt',
    });
  }
  return null;
});

const mockCreateEnv = mock(
  async (input: {
    workflow_name: string;
    name: string;
    patches: Record<string, unknown>;
    created_by_user_id: string | null;
  }) => {
    if (input.name === 'dup') {
      const err = Object.assign(
        new Error(`Workflow ENV 'dup' already exists for workflow '${input.workflow_name}'`),
        {
          name: 'WorkflowEnvNameConflictError',
          workflowName: input.workflow_name,
          envName: input.name,
        }
      );
      throw err;
    }
    return {
      id: 'env-new',
      workflow_name: input.workflow_name,
      name: input.name,
      patches: input.patches,
      created_at: '2026-01-03T00:00:00.000Z',
      updated_at: '2026-01-03T00:00:00.000Z',
      created_by_user_id: input.created_by_user_id,
    };
  }
);

const mockUpdateEnv = mock(
  async (
    workflowName: string,
    envId: string,
    patch: { name?: string; patches?: Record<string, unknown> }
  ) => {
    if (envId === 'missing') return null;
    if (patch.name === 'dup') {
      throw Object.assign(new Error(`Workflow ENV 'dup' already exists`), {
        name: 'WorkflowEnvNameConflictError',
        workflowName,
        envName: 'dup',
      });
    }
    return {
      id: envId,
      workflow_name: workflowName,
      name: patch.name ?? 'baseline',
      patches: patch.patches ?? {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-04T00:00:00.000Z',
      created_by_user_id: null,
    };
  }
);

const mockDeleteEnv = mock(async (workflowName: string, envId: string) => {
  return workflowName === 'feature' && envId === 'env-1';
});

class WorkflowEnvNameConflictError extends Error {
  readonly workflowName: string;
  readonly envName: string;
  constructor(workflowName: string, envName: string) {
    super(`Workflow ENV '${envName}' already exists for workflow '${workflowName}'`);
    this.name = 'WorkflowEnvNameConflictError';
    this.workflowName = workflowName;
    this.envName = envName;
  }
}

class WorkflowEnvCorruptRowError extends Error {
  readonly envId: string;
  constructor(envId: string) {
    super(`Workflow ENV row corrupt: ${envId}`);
    this.name = 'WorkflowEnvCorruptRowError';
    this.envId = envId;
  }
}

mock.module('@archon/core/db/workflow-envs', () => ({
  listWorkflowEnvSummaries: mockListEnvSummaries,
  getWorkflowEnvById: async (envId: string) => {
    if (envId === 'env-corrupt') {
      throw new WorkflowEnvCorruptRowError('env-corrupt');
    }
    return mockGetEnvById(envId);
  },
  createWorkflowEnv: async (input: {
    workflow_name: string;
    name: string;
    patches: Record<string, unknown>;
    created_by_user_id: string | null;
  }) => {
    if (input.name === 'dup') {
      throw new WorkflowEnvNameConflictError(input.workflow_name, input.name);
    }
    return mockCreateEnv(input);
  },
  updateWorkflowEnv: async (
    workflowName: string,
    envId: string,
    patch: { name?: string; patches?: Record<string, unknown> }
  ) => {
    if (patch.name === 'dup') {
      throw new WorkflowEnvNameConflictError(workflowName, 'dup');
    }
    return mockUpdateEnv(workflowName, envId, patch);
  },
  deleteWorkflowEnv: mockDeleteEnv,
  WorkflowEnvNameConflictError,
  WorkflowEnvCorruptRowError,
  isWorkflowEnvNameConflict: () => false,
}));

mock.module('@archon/core/db/codebases', () => ({
  listCodebases: mockListCodebases,
}));

mock.module('@archon/core/db/conversations', () => ({}));
mock.module('@archon/core/db/isolation-environments', () => ({}));
mock.module('@archon/core/db/workflows', () => ({}));
mock.module('@archon/core/db/users', () => ({
  findOrCreateUserByPlatformIdentity: mock(async (_platform: string, platformUserId: string) => ({
    id: platformUserId,
    role: 'admin',
  })),
  findOrCreateUser: mock(async () => ({ id: 'user-1', role: 'admin' })),
}));

const mockGetUserAiPrefs = mock(async (_userId: string) => ({}));
const mockLoadConfig = mock(async (_cwd?: string) => ({
  assistant: 'claude',
  assistants: { claude: { model: 'sonnet' } },
  tiers: undefined,
  aliases: undefined,
}));

mock.module('@archon/core', () => ({
  handleMessage: mock(async () => {}),
  getDatabaseType: () => 'sqlite',
  loadConfig: mockLoadConfig,
  loadRepoConfig: mock(async () => ({})),
  getUserAiPrefs: mockGetUserAiPrefs,
  ConversationNotFoundError: class extends Error {},
  createLogger: () => ({
    fatal: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    child: mock(function (this: unknown) {
      return this;
    }),
    bindings: mock(() => ({ module: 'test' })),
    isLevelEnabled: mock(() => true),
    level: 'info',
  }),
}));

mock.module('@archon/workflows/workflow-discovery', () => ({
  discoverWorkflowsWithConfig: mockDiscoverWorkflows,
  isValidWorkflowFolderSegment: (name: string) =>
    !name.includes('/') && !!name && !name.startsWith('.'),
}));

mock.module('@archon/workflows/command-validation', () => {
  const isValidCommandName = (name: string) =>
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !!name &&
    !name.startsWith('.');
  return {
    isValidCommandName: mock(isValidCommandName),
    isValidWorkflowName: mock((name: string) => {
      if (!name) return false;
      const segments = name.split('/');
      if (segments.length > 2) return false;
      return segments.every(isValidCommandName);
    }),
  };
});

mock.module('@archon/workflows/defaults', () => ({
  BUNDLED_WORKFLOWS: {},
  BUNDLED_COMMANDS: {},
  isBinaryBuild: mock(() => false),
}));

mock.module('@archon/workflows/loader', () => ({
  parseWorkflow: mock(() => ({ workflow: makeTestWorkflow({ name: 'x' }), error: null })),
}));

let apiGateEnabled = false;
mock.module('../auth', () => ({
  getAuth: () => null,
  isWebAuthEnabled: () => false,
  getSignupMode: () => 'disabled',
  isApiGateEnabled: () => apiGateEnabled,
}));

import { registerApiRoutes } from './api';

function makeApp(): OpenAPIHono {
  const app = createTestApp();
  registerApiRoutes(app, {} as WebAdapter, {} as ConversationLockManager);
  return app;
}

describe('Workflow ENV CRUD', () => {
  beforeEach(() => {
    apiGateEnabled = false;
    mockListEnvSummaries.mockClear();
    mockGetEnvById.mockClear();
    mockCreateEnv.mockClear();
    mockUpdateEnv.mockClear();
    mockDeleteEnv.mockClear();
    mockListCodebases.mockClear();
  });

  test('GET list returns summaries without patches', async () => {
    const res = await makeApp().request('/api/workflows/feature/envs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.envs).toHaveLength(1);
    expect(body.envs[0]).toEqual({
      id: 'env-1',
      workflowName: 'feature',
      name: 'baseline',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(body.envs[0].patches).toBeUndefined();
    expect(mockListEnvSummaries).toHaveBeenCalledWith('feature');
  });

  test('GET detail returns full camelCase row; mismatch is 404 env_not_found', async () => {
    const ok = await makeApp().request('/api/workflows/feature/envs/env-1');
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.env).toEqual({
      id: 'env-1',
      workflowName: 'feature',
      name: 'baseline',
      updatedAt: '2026-01-02T00:00:00.000Z',
      patches: { research: { model: 'haiku' } },
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: 'user-1',
    });

    const mismatch = await makeApp().request('/api/workflows/feature/envs/env-other');
    expect(mismatch.status).toBe(404);
    expect(await mismatch.json()).toEqual({ error: 'env_not_found' });

    const missing = await makeApp().request('/api/workflows/feature/envs/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'env_not_found' });
  });

  test('POST create returns 201 with server provenance; conflict is 409', async () => {
    const created = await makeApp().request('/api/workflows/feature/envs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Archon-User': 'alice' },
      body: JSON.stringify({
        name: 'variant-a',
        patches: { research: { provider: 'claude', model: 'haiku' } },
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.env.id).toBe('env-new');
    expect(body.env.name).toBe('variant-a');
    expect(body.env.createdByUserId).toBe('alice');
    expect(mockCreateEnv.mock.calls[0]?.[0]?.created_by_user_id).toBe('alice');
    // never accepts createdByUserId from body — provenance is server-resolved only
    expect(body.env.patches.research.model).toBe('haiku');

    const conflict = await makeApp().request('/api/workflows/feature/envs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup', patches: { research: { model: 'x' } } }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'env_name_conflict' });
  });

  test('POST without identity stores null creator', async () => {
    const created = await makeApp().request('/api/workflows/feature/envs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'solo', patches: {} }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.env.createdByUserId).toBeNull();
    expect(mockCreateEnv.mock.calls[0]?.[0]?.created_by_user_id).toBeNull();
  });

  test('PATCH full replace and scoped miss; DELETE returns deleted boolean', async () => {
    const patched = await makeApp().request('/api/workflows/feature/envs/env-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patches: {} }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json();
    expect(patchedBody.env.patches).toEqual({});
    expect(mockUpdateEnv).toHaveBeenCalledWith('feature', 'env-1', { patches: {} });

    const miss = await makeApp().request('/api/workflows/feature/envs/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ error: 'env_not_found' });

    const conflict = await makeApp().request('/api/workflows/feature/envs/env-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dup' }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'env_name_conflict' });

    const delOk = await makeApp().request('/api/workflows/feature/envs/env-1', {
      method: 'DELETE',
    });
    expect(delOk.status).toBe(200);
    expect(await delOk.json()).toEqual({ deleted: true });

    const delMiss = await makeApp().request('/api/workflows/feature/envs/nope', {
      method: 'DELETE',
    });
    expect(delMiss.status).toBe(200);
    expect(await delMiss.json()).toEqual({ deleted: false });
  });

  test('invalid workflow path name is 400; CRUD does not require cwd', async () => {
    const res = await makeApp().request('/api/workflows/bad..name/envs');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_workflow_name');
    expect(mockListCodebases).not.toHaveBeenCalled();
  });

  test('auth gate covers ENV routes without per-resource ACL', async () => {
    apiGateEnabled = true;
    const denied = await makeApp().request('/api/workflows/feature/envs');
    expect(denied.status).toBe(401);

    const allowed = await makeApp().request('/api/workflows/feature/envs', {
      headers: { 'X-Archon-User': 'alice' },
    });
    expect(allowed.status).toBe(200);
  });
});

describe('Workflow ENV preview', () => {
  beforeEach(() => {
    apiGateEnabled = false;
    mockDiscoverWorkflows.mockClear();
    mockListCodebases.mockClear();
    mockGetEnvById.mockClear();
    mockLoadConfig.mockClear();
    mockGetUserAiPrefs.mockClear();
    mockListCodebases.mockResolvedValue([{ default_cwd: '/tmp/project' }]);
  });

  test('baseline preview with root cwd returns targets including bash and nested resolved', async () => {
    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.authoritative).toBe(false);
    expect(body.workflowName).toBe('feature');
    expect(body.envId).toBeNull();
    expect(body.envName).toBeNull();
    expect(body.skippedNodeIds).toEqual([]);
    const ids = body.targets.map((t: { id: string }) => t.id);
    expect(ids).toContain('research');
    expect(ids).toContain('ship');
    expect(ids).toContain('group');
    expect(ids).not.toContain('inner');
    expect(body.targets.find((t: { id: string }) => t.id === 'ship')?.allowedFields).toEqual([
      'bash',
    ]);
    const resolvedIds = body.resolved.map((r: { nodeId: string }) => r.nodeId);
    expect(resolvedIds).toContain('research');
    expect(resolvedIds).toContain('group.inner');
    expect(resolvedIds).not.toContain('ship');
  });

  test('empty envId query returns YAML baseline without ENV lookup', async () => {
    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project') + '&envId='
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.authoritative).toBe(false);
    expect(body.workflowName).toBe('feature');
    expect(body.envId).toBeNull();
    expect(body.envName).toBeNull();
    expect(mockGetEnvById).not.toHaveBeenCalled();
  });

  test('descendant cwd accepted; unrelated cwd rejected', async () => {
    const ok = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project/packages/web')
    );
    expect(ok.status).toBe(200);

    const bad = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/other')
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_cwd');
  });

  test('ENV identity: missing 400 env_not_found; mismatch 400 env_workflow_mismatch', async () => {
    const missing = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project') + '&envId=nope'
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'env_not_found' });

    const mismatch = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' +
        encodeURIComponent('/tmp/project') +
        '&envId=env-other'
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: 'env_workflow_mismatch' });
  });

  test('ENV preview applies patches and reports skipped ids without echoing bodies', async () => {
    mockGetEnvById.mockImplementationOnce(async () => ({
      id: 'env-1',
      workflow_name: 'feature',
      name: 'baseline',
      patches: {
        research: { model: 'haiku', prompt: 'SECRET_PROMPT_BODY' },
        vanished: { model: 'opus' },
      },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      created_by_user_id: null,
    }));

    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' +
        encodeURIComponent('/tmp/project') +
        '&envId=env-1'
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.envId).toBe('env-1');
    expect(body.envName).toBe('baseline');
    expect(body.skippedNodeIds).toEqual(['vanished']);
    const text = JSON.stringify(body);
    expect(text).not.toContain('SECRET_PROMPT_BODY');
  });

  test('corrupt ENV row on preview is 500 env_store_corrupt', async () => {
    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' +
        encodeURIComponent('/tmp/project') +
        '&envId=env-corrupt'
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'env_store_corrupt' });
  });

  test('unknown workflow is 404', async () => {
    mockDiscoverWorkflows.mockResolvedValueOnce({ workflows: [], errors: [] });
    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project')
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('workflow_not_found');
  });

  test('preview resolved matches runtime request metadata with assistant effort + workflow thinking', async () => {
    // US-013: Preview must pass the same complete ResolveNodeExecutionOptions as
    // executor snapshot / node_started (assistants + workflow thinking), not { aiProfile }.
    mockLoadConfig.mockImplementationOnce(async () => ({
      assistant: 'claude',
      assistants: {
        claude: { model: 'sonnet', modelReasoningEffort: 'xhigh' },
      },
      tiers: undefined,
      aliases: undefined,
    }));
    mockDiscoverWorkflows.mockResolvedValueOnce({
      workflows: [
        makeTestWorkflowWithSource(
          {
            name: 'feature',
            description: 'Feature workflow',
            thinking: { type: 'enabled', budgetTokens: 2048 },
            nodes: [
              { id: 'research', prompt: 'research it' },
              { id: 'ship', bash: 'echo ship' },
              {
                id: 'group',
                loop_group: {
                  nodes: [{ id: 'inner', prompt: 'nested' }],
                  until: 'DONE',
                  max_iterations: 2,
                },
              },
            ],
          },
          'project'
        ),
      ],
      errors: [],
    });

    const res = await makeApp().request(
      '/api/workflows/feature/env-preview?cwd=' + encodeURIComponent('/tmp/project')
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resolved: Array<{
        nodeId: string;
        provider: string;
        model?: string;
        modelReasoningEffort?: string;
        effort?: string;
        thinking?: { type: string; budgetTokens?: number };
      }>;
    };

    const byId = Object.fromEntries(body.resolved.map(row => [row.nodeId, row]));
    expect(byId.research).toMatchObject({
      provider: 'claude',
      model: 'sonnet',
      modelReasoningEffort: 'xhigh',
      thinking: { type: 'enabled', budgetTokens: 2048 },
    });
    expect(byId.research.effort).toBeUndefined();
    expect(byId['group.inner']).toMatchObject({
      provider: 'claude',
      model: 'sonnet',
      modelReasoningEffort: 'xhigh',
      thinking: { type: 'enabled', budgetTokens: 2048 },
    });
    expect(byId['group.inner'].effort).toBeUndefined();
    expect(byId.ship).toBeUndefined();
    expect(byId.group).toBeUndefined();
  });
});

describe('OpenAPI generation for ENV routes', () => {
  test('CRUD and preview appear in OpenAPI; Start retains multipart exception path', async () => {
    const res = await makeApp().request('/api/openapi.json');
    expect(res.status).toBe(200);
    const spec = await res.json();
    const paths = spec.paths ?? {};
    expect(paths['/api/workflows/{name}/envs']).toBeDefined();
    expect(paths['/api/workflows/{name}/envs/{envId}']).toBeDefined();
    expect(paths['/api/workflows/{name}/env-preview']).toBeDefined();
    expect(paths['/api/workflows/{name}/envs'].get).toBeDefined();
    expect(paths['/api/workflows/{name}/envs'].post).toBeDefined();
    expect(paths['/api/workflows/{name}/envs/{envId}'].get).toBeDefined();
    expect(paths['/api/workflows/{name}/envs/{envId}'].patch).toBeDefined();
    expect(paths['/api/workflows/{name}/envs/{envId}'].delete).toBeDefined();
    expect(paths['/api/workflows/{name}/env-preview'].get).toBeDefined();
    // Start route remains registered (multipart exception lives in handler, not schema body).
    expect(paths['/api/workflows/{name}/run']?.post).toBeDefined();
  });
});
