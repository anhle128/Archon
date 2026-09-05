import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { clearRegistry, registerBuiltinProviders } from '@archon/providers';
import {
  COMPILED_LOOP_COMMAND,
  COMPOSED_NODE,
  type LoopWithCompiledCommand,
  type NodeWithComposedMeta,
} from './compiled-command';
import {
  applyEnvOverlay,
  buildEnvOverlaySnapshot,
  cloneWorkflowWithEngineMetadata,
  EnvOverlayError,
  listEnvOverlayTargets,
  parseStoredEnvOverlay,
  restoreEnvOverlayFromStored,
  verifyAppliedEnvOverlay,
} from './env-overlay';
import type { AppliedEnvOverlay, DagNode, EnvPatches, WorkflowDefinition } from './schemas';
import { isBashNode, isLoopGroupNode, isPromptNode } from './schemas';

beforeAll(() => {
  clearRegistry();
  registerBuiltinProviders();
});

afterAll(() => {
  clearRegistry();
});

function baseWorkflow(nodes: DagNode[]): WorkflowDefinition {
  return {
    name: 'overlay-demo',
    description: 'ENV overlay test workflow',
    nodes,
  };
}

function stampComposed(node: DagNode, origin = 'block'): DagNode {
  const stamped = node as DagNode & NodeWithComposedMeta;
  stamped[COMPOSED_NODE] = { origin, inputs: { plan: 'p1' }, blockEntry: true };
  return stamped;
}

function stampCompiledLoop(node: DagNode): DagNode {
  if (!('loop' in node) || typeof node.loop !== 'object' || node.loop === null) {
    throw new Error('expected loop node');
  }
  (node.loop as typeof node.loop & LoopWithCompiledCommand)[COMPILED_LOOP_COMMAND] = {
    prompt: 'compiled-body',
  };
  return node;
}

describe('cloneWorkflowWithEngineMetadata', () => {
  test('preserves composed and compiled-loop metadata through nested groups', () => {
    const loopNode = stampCompiledLoop({
      id: 'loop1',
      loop: { prompt: 'iterate', until: 'DONE', max_iterations: 3 },
    });
    stampComposed(loopNode, 'inner');

    const bodyPrompt = stampComposed({ id: 'body', prompt: 'review this' }, 'group-body');
    const group: DagNode = {
      id: 'grp',
      loop_group: {
        max_iterations: 2,
        until: 'DONE',
        nodes: [bodyPrompt],
      },
    };
    stampComposed(group, 'group-origin');

    const wf = baseWorkflow([loopNode, group]);
    const clone = cloneWorkflowWithEngineMetadata(wf);

    const clonedLoop = clone.nodes[0] as DagNode & NodeWithComposedMeta;
    expect(clonedLoop[COMPOSED_NODE]).toEqual({
      origin: 'inner',
      inputs: { plan: 'p1' },
      blockEntry: true,
    });
    expect((clonedLoop as { loop: LoopWithCompiledCommand }).loop[COMPILED_LOOP_COMMAND]).toEqual({
      prompt: 'compiled-body',
    });

    const clonedGroup = clone.nodes[1];
    expect(isLoopGroupNode(clonedGroup)).toBe(true);
    if (!isLoopGroupNode(clonedGroup)) return;
    expect((clonedGroup as DagNode & NodeWithComposedMeta)[COMPOSED_NODE]?.origin).toBe(
      'group-origin'
    );
    const clonedBody = clonedGroup.loop_group.nodes[0] as DagNode & NodeWithComposedMeta;
    expect(clonedBody[COMPOSED_NODE]?.origin).toBe('group-body');

    // Original untouched
    expect((loopNode as DagNode & NodeWithComposedMeta)[COMPOSED_NODE]?.origin).toBe('inner');
  });
});

describe('applyEnvOverlay field matrix', () => {
  test('prompt accepts prompt/provider/model/effort/thinking', () => {
    const wf = baseWorkflow([{ id: 'p', prompt: 'original' }]);
    const result = applyEnvOverlay(wf, {
      p: {
        prompt: 'patched',
        provider: 'claude',
        model: 'opus',
        effort: 'high',
        thinking: { type: 'enabled', budgetTokens: 1000 },
      },
    });
    const node = result.workflow.nodes[0];
    expect(isPromptNode(node)).toBe(true);
    if (!isPromptNode(node)) return;
    expect(node.prompt).toBe('patched');
    expect(node.provider).toBe('claude');
    expect(node.model).toBe('opus');
    expect(node.effort).toBe('high');
    expect(node.thinking).toEqual({ type: 'enabled', budgetTokens: 1000 });
  });

  test('command accepts provider/model/effort/thinking but not prompt', () => {
    const wf = baseWorkflow([{ id: 'c', command: 'build' }]);
    const ok = applyEnvOverlay(wf, {
      c: { provider: 'claude', model: 'sonnet', effort: 'low', thinking: 'disabled' },
    });
    expect(ok.appliedPatches.c?.model).toBe('sonnet');
    expect(ok.appliedPatches.c?.thinking).toEqual({ type: 'disabled' });

    expect(() => applyEnvOverlay(wf, { c: { prompt: 'nope' } })).toThrow(EnvOverlayError);
    try {
      applyEnvOverlay(wf, { c: { prompt: 'nope' } });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
      expect((err as EnvOverlayError).message).not.toContain('nope');
    }
  });

  test('loop accepts provider/model/effort and rejects thinking', () => {
    const wf = baseWorkflow([
      { id: 'lp', loop: { prompt: 'go', until: 'DONE', max_iterations: 2 } },
    ]);
    const ok = applyEnvOverlay(wf, {
      lp: { provider: 'claude', model: 'haiku', effort: 'medium' },
    });
    expect(ok.appliedPatches.lp?.effort).toBe('medium');

    try {
      applyEnvOverlay(wf, { lp: { thinking: 'enabled' } });
      expect.unreachable('should reject thinking on loop');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
      expect((err as EnvOverlayError).field).toBe('thinking');
    }
  });

  test('loop_group accepts provider/model and rejects effort/thinking', () => {
    const wf = baseWorkflow([
      {
        id: 'g',
        loop_group: {
          max_iterations: 2,
          until: 'DONE',
          nodes: [{ id: 'child', prompt: 'body' }],
        },
      },
    ]);
    const ok = applyEnvOverlay(wf, { g: { provider: 'claude', model: 'opus' } });
    expect(ok.appliedPatches.g?.model).toBe('opus');

    for (const field of ['effort', 'thinking'] as const) {
      try {
        applyEnvOverlay(
          wf,
          field === 'effort' ? { g: { effort: 'high' } } : { g: { thinking: 'enabled' } }
        );
        expect.unreachable(`should reject ${field} on loop_group`);
      } catch (err) {
        expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
        expect((err as EnvOverlayError).field).toBe(field);
      }
    }
  });

  test('bash accepts bash only; empty/whitespace preserved byte-for-byte', () => {
    const wf = baseWorkflow([{ id: 'b', bash: 'echo hi' }]);
    const empty = applyEnvOverlay(wf, { b: { bash: '' } });
    const node = empty.workflow.nodes[0];
    expect(isBashNode(node)).toBe(true);
    if (!isBashNode(node)) return;
    expect(node.bash).toBe('');

    const ws = applyEnvOverlay(wf, { b: { bash: ' \n\t' } });
    expect(
      isBashNode(ws.workflow.nodes[0]) && (ws.workflow.nodes[0] as { bash: string }).bash
    ).toBe(' \n\t');

    try {
      applyEnvOverlay(wf, { b: { model: 'x' } });
      expect.unreachable('bash should reject model');
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
    }
  });

  test('script and other kinds reject every field', () => {
    const wf = baseWorkflow([
      { id: 's', script: 'console.log(1)', runtime: 'bun' },
      { id: 'a', approval: 'Ship it?' },
    ]);
    try {
      applyEnvOverlay(wf, { s: { model: 'x' } });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
    }
    try {
      applyEnvOverlay(wf, { a: { provider: 'claude' } });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
    }
  });
});

describe('applyEnvOverlay targeting and isolation', () => {
  test('include-expanded id applies; unexpanded body id skips; group body id skips', () => {
    const qualityReview = stampComposed({ id: 'quality__review', prompt: 'from include' });
    const group: DagNode = {
      id: 'iterate',
      loop_group: {
        max_iterations: 2,
        until: 'DONE',
        nodes: [{ id: 'review', prompt: 'body review' }],
      },
    };
    const wf = baseWorkflow([qualityReview, group, { id: 'top', prompt: 'top-level' }]);

    const result = applyEnvOverlay(wf, {
      quality__review: { prompt: 'include-patched' },
      review: { prompt: 'should-skip' },
      missing_one: { model: 'x' },
      z_missing: { model: 'y' },
    });

    const includeNode = result.workflow.nodes.find(n => n.id === 'quality__review');
    expect(isPromptNode(includeNode!) && includeNode.prompt).toBe('include-patched');

    const grp = result.workflow.nodes.find(n => n.id === 'iterate');
    expect(isLoopGroupNode(grp!)).toBe(true);
    if (isLoopGroupNode(grp!)) {
      const body = grp.loop_group.nodes[0];
      expect(isPromptNode(body!) && body.prompt).toBe('body review');
    }

    expect(result.missingNodeIds).toEqual(['missing_one', 'review', 'z_missing']);
    expect(Object.keys(result.appliedPatches).sort()).toEqual(['quality__review']);
  });

  test('unknown provider fails; dangling output refs fail graph validation', () => {
    const wf = baseWorkflow([{ id: 'p', prompt: 'hi' }]);
    try {
      applyEnvOverlay(wf, { p: { provider: 'not-a-real-provider' } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('unknown_provider');
      expect((err as EnvOverlayError).field).toBe('provider');
    }

    const withRefs = baseWorkflow([
      { id: 'p', prompt: 'clean' },
      { id: 'b', bash: 'echo ok', depends_on: ['p'] },
    ]);
    try {
      applyEnvOverlay(withRefs, {
        p: { prompt: 'see $missing.output please' },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('invalid_overlay_graph');
      expect((err as EnvOverlayError).message).toMatch(/missing/);
      // Safe errors: do not echo the full prompt body.
      expect((err as EnvOverlayError).message).not.toContain('please');
    }

    try {
      applyEnvOverlay(withRefs, {
        b: { bash: 'echo $also_missing.output' },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('invalid_overlay_graph');
    }
  });

  test('empty ENV map is a no-op clone; original workflow and patch stay unchanged across ENV A/B/none', () => {
    const promptNode = stampComposed({ id: 'p', prompt: 'original', model: 'base' });
    const loopNode = stampCompiledLoop({
      id: 'lp',
      loop: { prompt: 'loop', until: 'DONE', max_iterations: 2 },
    });
    stampComposed(loopNode, 'loop-origin');
    const original = baseWorkflow([promptNode, loopNode]);
    const originalPrompt =
      original.nodes[0] && isPromptNode(original.nodes[0]) ? original.nodes[0].prompt : null;

    const patchA: EnvPatches = {
      p: { prompt: 'env-a', model: 'model-a', thinking: { type: 'enabled' } },
    };
    const patchB: EnvPatches = {
      p: { prompt: 'env-b', model: 'model-b' },
    };
    const thinkingObj = patchA.p!.thinking as { type: string };
    const thinkingRef = thinkingObj;

    const resultA = applyEnvOverlay(original, patchA);
    expect(isPromptNode(resultA.workflow.nodes[0]!) && resultA.workflow.nodes[0].prompt).toBe(
      'env-a'
    );
    // Mutate caller patch after apply — applied descriptor and clone must not change.
    thinkingRef.type = 'disabled';
    patchA.p!.prompt = 'mutated-after';
    expect(resultA.appliedPatches.p?.thinking).toEqual({ type: 'enabled' });
    expect(resultA.appliedPatches.p?.prompt).toBe('env-a');
    expect(isPromptNode(resultA.workflow.nodes[0]!) && resultA.workflow.nodes[0].prompt).toBe(
      'env-a'
    );

    const resultB = applyEnvOverlay(original, patchB);
    expect(isPromptNode(resultB.workflow.nodes[0]!) && resultB.workflow.nodes[0].prompt).toBe(
      'env-b'
    );

    const resultNone = applyEnvOverlay(original, {});
    expect(isPromptNode(resultNone.workflow.nodes[0]!) && resultNone.workflow.nodes[0].prompt).toBe(
      'original'
    );
    expect(resultNone.appliedPatches).toEqual({});

    // Original discovered object + symbol payloads unchanged
    expect(originalPrompt).toBe('original');
    expect(isPromptNode(original.nodes[0]!) && original.nodes[0].prompt).toBe('original');
    expect(isPromptNode(original.nodes[0]!) && original.nodes[0].model).toBe('base');
    expect((original.nodes[0] as DagNode & NodeWithComposedMeta)[COMPOSED_NODE]?.origin).toBe(
      'block'
    );
    expect(
      (original.nodes[1] as { loop: LoopWithCompiledCommand }).loop[COMPILED_LOOP_COMMAND]
    ).toEqual({ prompt: 'compiled-body' });

    // Clones preserved symbols too
    expect(
      (resultA.workflow.nodes[0] as DagNode & NodeWithComposedMeta)[COMPOSED_NODE]?.origin
    ).toBe('block');
    expect(
      (resultNone.workflow.nodes[1] as { loop: LoopWithCompiledCommand }).loop[
        COMPILED_LOOP_COMMAND
      ]
    ).toEqual({ prompt: 'compiled-body' });
  });

  test('error messages never include prompt or bash bodies', () => {
    const secret = 'SUPER_SECRET_BODY_CONTENT_XYZ';
    const wf = baseWorkflow([{ id: 'c', command: 'build' }]);
    try {
      applyEnvOverlay(wf, { c: { prompt: secret } });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
      expect(JSON.stringify(err)).not.toContain(secret);
    }

    const bashWf = baseWorkflow([{ id: 'p', prompt: 'x' }]);
    try {
      applyEnvOverlay(bashWf, { p: { bash: secret } });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe('ENV overlay restore / verify / snapshot', () => {
  const appliedBase: AppliedEnvOverlay = {
    envId: 'env-1',
    envName: 'fast',
    workflowName: 'overlay-demo',
    patches: { p: { model: 'haiku', prompt: 'patched' } },
    skippedNodeIds: ['gone'],
  };

  test('verifyAppliedEnvOverlay accepts matching patched fields and reports missing ids', () => {
    const patched = applyEnvOverlay(
      baseWorkflow([{ id: 'p', prompt: 'original', model: 'sonnet' }]),
      {
        p: { model: 'haiku', prompt: 'patched' },
        missing: { model: 'opus' },
      }
    );
    const applied: AppliedEnvOverlay = {
      ...appliedBase,
      patches: {
        p: { model: 'haiku', prompt: 'patched' },
        missing: { model: 'opus' },
      },
      skippedNodeIds: [],
    };
    expect(verifyAppliedEnvOverlay(patched.workflow, applied)).toEqual({
      latestMissingNodeIds: ['missing'],
    });
  });

  test('verifyAppliedEnvOverlay fails closed on workflow mismatch and field drift', () => {
    const wf = baseWorkflow([{ id: 'p', prompt: 'patched', model: 'haiku' }]);
    try {
      verifyAppliedEnvOverlay(wf, { ...appliedBase, workflowName: 'other' });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('workflow_mismatch');
    }

    try {
      verifyAppliedEnvOverlay(wf, {
        ...appliedBase,
        patches: { p: { model: 'haiku', prompt: 'DIFFERENT' } },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('invalid_overlay_snapshot');
      expect((err as EnvOverlayError).field).toBe('prompt');
      expect((err as Error).message).not.toContain('DIFFERENT');
    }
  });

  test('restoreEnvOverlayFromStored reapplies frozen patches and keeps missing ids in latestMissingNodeIds', () => {
    const original = baseWorkflow([
      { id: 'p', prompt: 'original' },
      { id: 'keep', prompt: 'stay' },
    ]);
    const stored = {
      ...appliedBase,
      patches: {
        p: { prompt: 'from-snapshot' },
        vanished: { model: 'opus' },
      },
      skippedNodeIds: ['gone'],
      latestMissingNodeIds: [],
      resolved: { p: { provider: 'claude', model: 'old' } },
    };
    const restored = restoreEnvOverlayFromStored(original, stored);
    expect(isPromptNode(restored.workflow.nodes[0])).toBe(true);
    if (isPromptNode(restored.workflow.nodes[0])) {
      expect(restored.workflow.nodes[0].prompt).toBe('from-snapshot');
    }
    // Frozen patches retain vanished id even though it is currently missing.
    expect(restored.applied.patches.vanished?.model).toBe('opus');
    expect(restored.latestMissingNodeIds).toEqual(['vanished']);
    expect(original.nodes[0] && isPromptNode(original.nodes[0]) && original.nodes[0].prompt).toBe(
      'original'
    );
  });

  test('parseStoredEnvOverlay rejects corrupt documents without echoing bodies', () => {
    const secret = 'SECRET_PROMPT_BODY';
    try {
      parseStoredEnvOverlay({ envId: 'x', patches: { p: { prompt: secret } } });
      expect.unreachable();
    } catch (err) {
      expect((err as EnvOverlayError).code).toBe('invalid_overlay_snapshot');
      expect((err as Error).message).not.toContain(secret);
    }
  });

  test('buildEnvOverlaySnapshot freezes patches and sorts latestMissingNodeIds', () => {
    const snapshot = buildEnvOverlaySnapshot(appliedBase, ['z-missing', 'a-missing'], {
      p: { provider: 'claude', model: 'haiku' },
    });
    expect(snapshot.latestMissingNodeIds).toEqual(['a-missing', 'z-missing']);
    expect(snapshot.patches).toEqual(appliedBase.patches);
    expect(snapshot.skippedNodeIds).toEqual(['gone']);
    expect(snapshot.resolved.p?.model).toBe('haiku');
    // Detached from inputs
    snapshot.patches.p!.prompt = 'mutated';
    expect(appliedBase.patches.p?.prompt).toBe('patched');
  });
});

describe('listEnvOverlayTargets', () => {
  test('returns top-level matrix including bash and loop_group; excludes body ids and other kinds', () => {
    const workflow = baseWorkflow([
      { id: 'research', prompt: 'go' },
      { id: 'cmd', command: 'ship' },
      {
        id: 'loop',
        loop: { prompt: 'iterate', until: 'DONE', max_iterations: 2 },
      },
      {
        id: 'group',
        loop_group: {
          nodes: [{ id: 'inner', prompt: 'nested' }],
          until: 'DONE',
          max_iterations: 2,
        },
      },
      { id: 'sh', bash: 'echo hi' },
      { id: 'gate', approval: true },
    ] as DagNode[]);

    const targets = listEnvOverlayTargets(workflow);
    expect(targets.map(t => t.id)).toEqual(['research', 'cmd', 'loop', 'group', 'sh']);
    expect(targets.find(t => t.id === 'research')?.allowedFields).toEqual([
      'prompt',
      'provider',
      'model',
      'effort',
      'thinking',
    ]);
    expect(targets.find(t => t.id === 'cmd')?.allowedFields).toEqual([
      'provider',
      'model',
      'effort',
      'thinking',
    ]);
    expect(targets.find(t => t.id === 'loop')?.allowedFields).toEqual([
      'provider',
      'model',
      'effort',
    ]);
    expect(targets.find(t => t.id === 'group')?.nodeType).toBe('loop_group');
    expect(targets.find(t => t.id === 'group')?.allowedFields).toEqual(['provider', 'model']);
    expect(targets.find(t => t.id === 'sh')?.allowedFields).toEqual(['bash']);
    expect(targets.some(t => t.id === 'inner' || t.id === 'gate')).toBe(false);
  });
});
