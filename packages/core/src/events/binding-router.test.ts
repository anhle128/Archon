import { beforeEach, describe, expect, mock, test } from 'bun:test';

const codebase = {
  id: 'cb-1',
  name: 'workflow-engine',
  repository_url: 'https://github.com/OceanLabs/workflow-engine',
  default_cwd: '/workspace/workflow-engine',
  default_branch: 'dev',
  ai_assistant_type: 'claude',
  kind: 'repo' as const,
  commands: {},
  created_at: new Date(),
  updated_at: new Date(),
};

const binding = {
  id: 'wpb-1',
  provider: 'archon',
  name: 'workflow-engine-primary',
  codebase_id: 'cb-1',
  event_route: 'https://hermes.example/events',
  event_types: [],
  signing_secret: 'test-secret',
  state: 'active' as const,
  binding_version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

let currentCodebase: typeof codebase | null = codebase;
let currentBindings: unknown[] = [binding];

mock.module('../db/codebases', () => ({
  getCodebase: mock(async () => currentCodebase),
}));

mock.module('../db/provider-bindings', () => ({
  getBindingByCodebase: mock(async () => currentBindings),
}));

const { resolveEventRoute } = await import('./binding-router');

describe('resolveEventRoute', () => {
  beforeEach(() => {
    currentCodebase = codebase;
    currentBindings = [binding];
  });

  test('routes active and rotated bindings without version comparison', async () => {
    await expect(resolveEventRoute('cb-1')).resolves.toMatchObject({
      routable: true,
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });

    currentBindings = [{ ...binding, state: 'rotated', binding_version: 99 }];
    await expect(resolveEventRoute('cb-1')).resolves.toMatchObject({
      routable: true,
      route: 'https://hermes.example/events',
      secret: 'test-secret',
    });
  });

  test.each([
    ['missing-codebase', null, [binding]],
    ['missing-binding', codebase, []],
    ['binding-disabled', codebase, [{ ...binding, state: 'disabled' }]],
    ['wrong-codebase', codebase, [{ ...binding, codebase_id: 'cb-2' }]],
    ['missing-route', codebase, [{ ...binding, event_route: '   ' }]],
    ['missing-secret', codebase, [{ ...binding, signing_secret: null }]],
    ['binding-conflicting', codebase, [binding, { ...binding, id: 'wpb-2', name: 'other' }]],
  ] as const)('returns %s as not routable', async (reason, testCodebase, bindings) => {
    currentCodebase = testCodebase;
    currentBindings = [...bindings];

    await expect(resolveEventRoute('cb-1')).resolves.toMatchObject({
      routable: false,
      reason,
    });
  });
});
