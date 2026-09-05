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

  test('OpenCode tier preset carrying effort:high drops with presetEffortDropped', () => {
    const opencodeProfile = buildAiProfile('opencode', {
      globalTiers: {
        large: { provider: 'opencode', model: 'opencode-large', effort: 'high' },
      },
    });
    const node: DagNode = { id: 'n', prompt: 'hi', model: 'large' };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ provider: 'opencode', model: undefined }),
      { ...assistantModels, opencode: 'default-model' },
      { aiProfile: opencodeProfile }
    );
    expect(request.presetEffortDropped).toBe(true);
    expect(request.presetEffortRejection).toEqual({
      ok: false,
      reason: 'unsupported',
      valid: null,
    });
    expect(request.appliedEffort).toBeUndefined();
    expect(request.metadata.effort).toBeUndefined();
    expect(request.metadata.provider).toBe('opencode');
    expect(request.metadata.model).toBe('opencode-large');
    expect(request.metadata.tier).toBe('large');
  });

  test('OpenCode alias preset carrying effort:high also drops without throwing', () => {
    const opencodeProfile = buildAiProfile('opencode', {
      globalAliases: {
        '@fast': { provider: 'opencode', model: 'fast-model', effort: 'high' },
      },
    });
    const node: DagNode = { id: 'n', prompt: 'hi', model: '@fast' };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ provider: 'opencode', model: undefined }),
      { ...assistantModels, opencode: 'default-model' },
      { aiProfile: opencodeProfile }
    );
    expect(request.presetEffortDropped).toBe(true);
    expect(request.appliedEffort).toBeUndefined();
    expect(request.metadata.effort).toBeUndefined();
  });

  test('workflow-authored explicit portable effort still fails on OpenCode', () => {
    const node: DagNode = { id: 'n', prompt: 'hi', provider: 'opencode' };
    expect(() =>
      resolveNodeExecutionRequest(
        node,
        baseScope({ provider: 'opencode', effort: 'high' }),
        assistantModels,
        { aiProfile }
      )
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

  test('preset-only unsupported thinking sets thinkingUnsupported and keeps requested thinking', () => {
    // Codex has no thinkingControl; tier preset supplies thinking with no node/workflow thinking.
    const codexProfile = buildAiProfile('codex', {
      globalTiers: {
        large: { provider: 'codex', model: 'gpt-5.1', thinking: 'enabled' },
      },
    });
    const node: DagNode = { id: 'n', prompt: 'hi', model: 'large' };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ provider: 'codex', model: undefined }),
      { ...assistantModels, codex: 'gpt-5.1' },
      { aiProfile: codexProfile }
    );
    expect(request.thinkingUnsupported).toBe(true);
    expect(request.metadata.thinking).toEqual({ type: 'enabled' });
    expect(request.appliedThinking).toEqual({ type: 'enabled' });
    expect(request.metadata.provider).toBe('codex');
    expect(request.metadata.model).toBe('gpt-5.1');
    expect(request.metadata.tier).toBe('large');
  });

  test('preset-only thinking on a supported provider does not set thinkingUnsupported', () => {
    const claudeProfile = buildAiProfile('claude', {
      globalAliases: {
        '@think': { provider: 'claude', model: 'claude-sonnet-4', thinking: 'adaptive' },
      },
    });
    const node: DagNode = { id: 'n', prompt: 'hi', model: '@think' };
    const request = resolveNodeExecutionRequest(
      node,
      baseScope({ provider: 'claude', model: undefined }),
      assistantModels,
      { aiProfile: claudeProfile }
    );
    expect(request.thinkingUnsupported).toBe(false);
    expect(request.metadata.thinking).toEqual({ type: 'adaptive' });
    expect(request.appliedThinking).toEqual({ type: 'adaptive' });
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

  test('exposes providerConflict when group provider disagrees with alias model', () => {
    // US-037: group provider claude + alias → codex must surface the conflict
    // decision so runtime can emit dag.model_provider_conflict (body nodes
    // inherit the already-resolved provider and cannot recover it).
    const profile = buildAiProfile('claude', {
      repoAliases: {
        '@fast': { provider: 'codex', model: 'gpt-5.5', effort: 'minimal' },
      },
    });
    const group: LoopGroupNode = {
      id: 'grp',
      provider: 'claude',
      model: '@fast',
      loop_group: {
        until: 'DONE',
        max_iterations: 1,
        nodes: [{ id: 'body', prompt: 'x' }],
      },
    };
    const groupScope = resolveGroupModelScope(group, baseScope(), assistantModels, profile);
    expect(groupScope.provider).toBe('codex');
    expect(groupScope.model).toBe('gpt-5.5');
    expect(groupScope.providerConflict).toEqual({
      declared: 'claude',
      resolved: 'codex',
      modelRef: '@fast',
    });
    // ENV resolved map still excludes the group container.
    const resolved = buildResolvedRequestMetadata([group], baseScope(), assistantModels, {
      aiProfile: profile,
    });
    expect(resolved['grp']).toBeUndefined();
    expect(resolved['grp.body']).toMatchObject({ provider: 'codex', model: 'gpt-5.5' });
  });

  test('nested group conflict is independent of outer matching scope', () => {
    const profile = buildAiProfile('claude', {
      repoAliases: {
        '@codex-fast': { provider: 'codex', model: 'gpt-5.5' },
        '@claude-fast': { provider: 'claude', model: 'haiku' },
      },
    });
    const outer: LoopGroupNode = {
      id: 'outer',
      provider: 'claude',
      model: '@claude-fast',
      loop_group: {
        until: 'DONE',
        max_iterations: 1,
        nodes: [
          {
            id: 'inner',
            provider: 'claude',
            model: '@codex-fast',
            loop_group: {
              until: 'OK',
              max_iterations: 1,
              nodes: [{ id: 'deep', prompt: 'deep' }],
            },
          },
        ],
      },
    };
    const outerScope = resolveGroupModelScope(outer, baseScope(), assistantModels, profile);
    // Matching alias provider — no conflict on the outer group.
    expect(outerScope.provider).toBe('claude');
    expect(outerScope.model).toBe('haiku');
    expect(outerScope.providerConflict).toBeUndefined();

    const inner = outer.loop_group.nodes[0] as LoopGroupNode;
    const innerScope = resolveGroupModelScope(inner, outerScope, assistantModels, profile);
    expect(innerScope.provider).toBe('codex');
    expect(innerScope.model).toBe('gpt-5.5');
    expect(innerScope.providerConflict).toEqual({
      declared: 'claude',
      resolved: 'codex',
      modelRef: '@codex-fast',
    });
  });

  test('matching group provider and alias provider produces no conflict', () => {
    const profile = buildAiProfile('claude', {
      repoAliases: {
        '@codex-main': { provider: 'codex', model: 'gpt-5.1' },
      },
    });
    const group: LoopGroupNode = {
      id: 'grp',
      provider: 'codex',
      model: '@codex-main',
      loop_group: {
        until: 'DONE',
        max_iterations: 1,
        nodes: [{ id: 'body', prompt: 'x' }],
      },
    };
    const groupScope = resolveGroupModelScope(group, baseScope(), assistantModels, profile);
    expect(groupScope.provider).toBe('codex');
    expect(groupScope.model).toBe('gpt-5.1');
    expect(groupScope.providerConflict).toBeUndefined();
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

describe('resolveWorkflowModelScope — legacy modelReasoningEffort', () => {
  test('unexpanded programmatic workflow-level modelReasoningEffort becomes scope.effort', () => {
    // Loader-normalized YAML translates modelReasoningEffort → effort before the
    // definition is handed to the engine. Programmatic callers may still pass the
    // legacy field alone; scope must match the DAG executor fallback so Preview /
    // snapshot / node_started / provider options stay aligned.
    const programmatic: WorkflowDefinition = {
      name: 'legacy-mre',
      description: 'unexpanded',
      modelReasoningEffort: 'high',
      nodes: [{ id: 'turn', prompt: 'go' }],
    };
    const loaderNormalized: WorkflowDefinition = {
      name: 'legacy-mre',
      description: 'loader-translated',
      effort: 'high',
      nodes: [{ id: 'turn', prompt: 'go' }],
    };

    const progScope = resolveWorkflowModelScope(programmatic, 'claude', assistantModels, aiProfile);
    const yamlScope = resolveWorkflowModelScope(
      loaderNormalized,
      'claude',
      assistantModels,
      aiProfile
    );
    expect(progScope.effort).toBe('high');
    expect(yamlScope.effort).toBe('high');
    expect(progScope.effort).toBe(yamlScope.effort);

    const progRequest = resolveNodeExecutionRequest(
      programmatic.nodes[0]!,
      progScope,
      assistantModels,
      { aiProfile }
    );
    const yamlRequest = resolveNodeExecutionRequest(
      loaderNormalized.nodes[0]!,
      yamlScope,
      assistantModels,
      { aiProfile }
    );
    // Same portable effort in metadata, appliedEffort (provider nodeConfig.effort),
    // and no assistant-legacy modelReasoningEffort surface once portable effort wins.
    expect(progRequest.metadata).toEqual(yamlRequest.metadata);
    expect(progRequest.metadata.effort).toBe('high');
    expect(progRequest.metadata.modelReasoningEffort).toBeUndefined();
    expect(progRequest.appliedEffort).toBe('high');
    expect(progRequest.appliedEffort).toBe(yamlRequest.appliedEffort);

    const progResolved = buildResolvedRequestMetadata(
      programmatic.nodes,
      progScope,
      assistantModels,
      { aiProfile }
    );
    const yamlResolved = buildResolvedRequestMetadata(
      loaderNormalized.nodes,
      yamlScope,
      assistantModels,
      { aiProfile }
    );
    expect(progResolved).toEqual(yamlResolved);
    expect(progResolved.turn).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-4',
      effort: 'high',
    });
  });

  test('portable effort wins over workflow-level modelReasoningEffort', () => {
    const scope = resolveWorkflowModelScope(
      { effort: 'low', modelReasoningEffort: 'xhigh' },
      'claude',
      assistantModels,
      aiProfile
    );
    expect(scope.effort).toBe('low');
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
