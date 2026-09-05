/**
 * Pure node execution resolution — shared by node_started, ENV preview, ENV snapshot.
 */
import { describe, expect, test, beforeAll } from 'bun:test';
import {
  clearRegistry,
  registerBuiltinProviders,
  registerOpencodeProvider,
} from '@archon/providers';
import { buildAiProfile } from './model-validation';
import {
  assistantModelDefaults,
  buildResolvedRequestMetadata,
  resolveGroupModelScope,
  resolveNodeExecutionRequest,
  resolveWorkflowModelScope,
  type WorkflowModelScope,
} from './node-model-resolution';
import type { DagNode, LoopGroupNode, WorkflowDefinition } from './schemas';

beforeAll(() => {
  clearRegistry();
  registerBuiltinProviders();
  registerOpencodeProvider();
});

const assistantModels = { claude: 'claude-sonnet-4', codex: 'gpt-5.1' };

function baseScope(overrides: Partial<WorkflowModelScope> = {}): WorkflowModelScope {
  return {
    provider: 'claude',
    model: 'claude-sonnet-4',
    preset: undefined,
    tier: undefined,
    effort: undefined,
    providerOrigin: 'default assistant',
    ...overrides,
  };
}

const aiProfile = buildAiProfile('claude', {
  globalTiers: {
    small: { provider: 'claude', model: 'haiku' },
    medium: { provider: 'claude', model: 'sonnet' },
    large: { provider: 'claude', model: 'opus', effort: 'high' },
  },
});

describe('resolveNodeExecutionRequest', () => {
  test('node model beats workflow model; metadata matches resolution', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', model: 'claude-opus-4' };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ model: 'claude-sonnet-4' }),
      assistantModels,
      { aiProfile }
    );
    expect(request.metadata).toEqual({
      provider: 'claude',
      model: 'claude-opus-4',
    });
    expect(request.resolution.modelOrigin).toBe('node');
  });

  test('tier keyword surfaces on metadata and inherits from workflow when node has no model', () => {
    const node: DagNode = { id: 'n', prompt: 'hi' };
    const scope = baseScope({
      model: 'opus',
      tier: 'large',
      preset: { provider: 'claude', model: 'opus', effort: 'high' },
    });
    const request = resolveNodeExecutionRequest(node, scope, assistantModels, { aiProfile });
    expect(request.metadata.tier).toBe('large');
    expect(request.metadata.model).toBe('opus');
    expect(request.metadata.effort).toBe('high');
  });

  test('node tier beats workflow tier', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', model: 'small' };
    const scope = baseScope({
      model: 'opus',
      tier: 'large',
      preset: { provider: 'claude', model: 'opus' },
    });
    const request = resolveNodeExecutionRequest(node, scope, assistantModels, { aiProfile });
    expect(request.metadata.tier).toBe('small');
    expect(request.metadata.model).toBe('haiku');
  });

  test('explicit portable effort fails on provider without effortControl', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', provider: 'opencode', effort: 'high' };
    expect(() =>
      resolveNodeExecutionRequest(node, baseScope({ provider: 'opencode' }), assistantModels, {
        aiProfile,
      })
    ).toThrow(/does not support effortControl/);
  });

  test('thinking is preserved in metadata even when unsupported; flag is set', () => {
    const node: DagNode = {
      id: 'n',
      prompt: 'hi',
      provider: 'codex',
      thinking: 'enabled',
    };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ provider: 'codex', model: 'gpt-5.1' }),
      assistantModels,
      { aiProfile }
    );
    expect(request.thinkingUnsupported).toBe(true);
    expect(request.metadata.thinking).toEqual({ type: 'enabled' });
    expect(request.metadata.provider).toBe('codex');
  });

  test('assistant modelReasoningEffort becomes metadata.modelReasoningEffort when no portable effort', () => {
    const node: DagNode = { id: 'n', prompt: 'hi' };
    const request = resolveNodeExecutionRequest(node, baseScope(), assistantModels, {
      aiProfile,
      assistants: { claude: { modelReasoningEffort: 'medium' } },
    });
    expect(request.metadata.effort).toBeUndefined();
    expect(request.metadata.modelReasoningEffort).toBe('medium');
  });

  test('portable effort wins over assistant modelReasoningEffort', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', effort: 'low' };
    const request = resolveNodeExecutionRequest(node, baseScope(), assistantModels, {
      aiProfile,
      assistants: { claude: { modelReasoningEffort: 'medium' } },
    });
    expect(request.metadata.effort).toBe('low');
    expect(request.metadata.modelReasoningEffort).toBeUndefined();
  });

  test('unknown provider fails closed', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', provider: 'not-a-real-provider' };
    expect(() => resolveNodeExecutionRequest(node, baseScope(), assistantModels)).toThrow(
      /unknown provider/
    );
  });
});

describe('resolveGroupModelScope', () => {
  test('forwards group provider/model and preserves outer effort', () => {
    const group: LoopGroupNode = {
      id: 'grp',
      provider: 'codex',
      model: 'gpt-5.1',
      loop_group: {
        until: 'DONE',
        max_iterations: 2,
        nodes: [{ id: 'body', prompt: 'x' }],
      },
    };
    const outer = baseScope({ effort: 'high', model: 'claude-sonnet-4' });
    const groupScope = resolveGroupModelScope(group, outer, assistantModels, aiProfile);
    expect(groupScope.provider).toBe('codex');
    expect(groupScope.model).toBe('gpt-5.1');
    expect(groupScope.effort).toBe('high');
  });

  test('group tier preset supplies body defaults without stealing outer effort', () => {
    const group: LoopGroupNode = {
      id: 'grp',
      model: 'large',
      loop_group: {
        until: 'DONE',
        max_iterations: 1,
        nodes: [{ id: 'body', prompt: 'x' }],
      },
    };
    const outer = baseScope({ effort: 'low' });
    const groupScope = resolveGroupModelScope(group, outer, assistantModels, aiProfile);
    expect(groupScope.provider).toBe('claude');
    expect(groupScope.model).toBe('opus');
    expect(groupScope.tier).toBe('large');
    expect(groupScope.preset?.effort).toBe('high');
    expect(groupScope.effort).toBe('low');
  });
});

describe('buildResolvedRequestMetadata', () => {
  test('includes prompt/command/loop and nested group bodies; excludes group containers and bash', () => {
    const nodes: DagNode[] = [
      { id: 'setup', bash: 'echo hi' },
      { id: 'plan', prompt: 'plan it', model: 'small' },
      {
        id: 'grp',
        model: 'large',
        loop_group: {
          until: 'DONE',
          max_iterations: 2,
          nodes: [
            { id: 'child', prompt: 'work' },
            { id: 'check', bash: 'test 1' },
            {
              id: 'inner',
              provider: 'codex',
              loop_group: {
                until: 'OK',
                max_iterations: 1,
                nodes: [{ id: 'deep', prompt: 'deep' }],
              },
            },
          ],
        },
      },
      {
        id: 'loop',
        loop: { prompt: 'iterate', until: 'DONE', max_iterations: 2 },
        effort: 'medium',
      },
    ];

    const resolved = buildResolvedRequestMetadata(nodes, baseScope(), assistantModels, {
      aiProfile,
    });

    expect(Object.keys(resolved).sort()).toEqual(
      ['grp.child', 'grp.inner.deep', 'loop', 'plan'].sort()
    );
    expect(resolved['setup']).toBeUndefined();
    expect(resolved['grp']).toBeUndefined();
    expect(resolved['grp.check']).toBeUndefined();
    expect(resolved['grp.inner']).toBeUndefined();

    expect(resolved.plan).toMatchObject({
      provider: 'claude',
      model: 'haiku',
      tier: 'small',
    });
    expect(resolved['grp.child']).toMatchObject({
      provider: 'claude',
      model: 'opus',
      tier: 'large',
      effort: 'high',
    });
    expect(resolved['grp.inner.deep']).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.1',
    });
    expect(resolved.loop).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-4',
      effort: 'medium',
    });
  });

  test('workflow scope + assistant fallback produce stable rows', () => {
    const workflow: WorkflowDefinition = {
      name: 'demo',
      model: 'medium',
      nodes: [{ id: 'a', command: 'cmd' }],
    };
    const scope = resolveWorkflowModelScope(workflow, 'claude', assistantModels, aiProfile);
    const resolved = buildResolvedRequestMetadata(workflow.nodes, scope, assistantModels, {
      aiProfile,
      assistants: { claude: { modelReasoningEffort: 'xhigh' } },
    });
    expect(resolved.a).toEqual({
      provider: 'claude',
      model: 'sonnet',
      tier: 'medium',
      modelReasoningEffort: 'xhigh',
    });
  });
});

describe('assistantModelDefaults', () => {
  test('extracts string models only', () => {
    expect(
      assistantModelDefaults({
        assistants: {
          claude: { model: 'x' },
          codex: { model: 12 as unknown as string },
          empty: undefined,
        },
      })
    ).toEqual({ claude: 'x' });
  });
});
