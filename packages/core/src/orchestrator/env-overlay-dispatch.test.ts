/**
 * Pure pre-isolation ENV overlay selection for orchestrator dispatch (US-006).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { clearRegistry, registerBuiltinProviders } from '@archon/providers';
import { EnvOverlayError } from '@archon/workflows/env-overlay';
import { makeTestWorkflow } from '@archon/workflows/test-utils';
import type { EnvOverlayCandidate } from '@archon/workflows/schemas/env-overlay';
import {
  formatEnvOverlayDispatchMessage,
  resolveContinuationDispatchEnvOverlay,
  resolveFreshDispatchEnvOverlay,
} from './env-overlay-dispatch';

beforeAll(() => {
  clearRegistry();
  registerBuiltinProviders();
});

afterAll(() => {
  clearRegistry();
});

function candidate(
  overrides: Partial<EnvOverlayCandidate> & { patches: EnvOverlayCandidate['patches'] }
): EnvOverlayCandidate {
  return {
    envId: 'env-1',
    envName: 'fast',
    workflowName: 'test-workflow',
    ...overrides,
  };
}

describe('resolveFreshDispatchEnvOverlay', () => {
  test('returns original workflow when no candidate', () => {
    const workflow = makeTestWorkflow({ name: 'test-workflow' });
    const result = resolveFreshDispatchEnvOverlay(workflow, undefined);
    expect(result.workflow).toBe(workflow);
    expect(result.applied).toBeUndefined();
  });

  test('applies matching candidate and detaches applied descriptor', () => {
    const workflow = makeTestWorkflow({
      name: 'test-workflow',
      nodes: [{ id: 'default', prompt: 'hello', provider: 'claude' }],
    });
    const request = candidate({
      patches: { default: { model: 'claude-sonnet-4' } },
    });
    const result = resolveFreshDispatchEnvOverlay(workflow, request);

    expect(result.workflow).not.toBe(workflow);
    expect(result.workflow.nodes[0]).toMatchObject({
      id: 'default',
      model: 'claude-sonnet-4',
    });
    // Original untouched
    expect((workflow.nodes[0] as { model?: string }).model).toBeUndefined();
    expect(result.applied).toEqual({
      envId: 'env-1',
      envName: 'fast',
      workflowName: 'test-workflow',
      patches: { default: { model: 'claude-sonnet-4' } },
      skippedNodeIds: [],
    });
    // Detached: mutating returned applied must not alias request patches
    result.applied!.patches.default!.model = 'mutated';
    expect(request.patches.default!.model).toBe('claude-sonnet-4');
  });

  test('skips missing target ids without failing', () => {
    const workflow = makeTestWorkflow({ name: 'test-workflow' });
    const result = resolveFreshDispatchEnvOverlay(
      workflow,
      candidate({ patches: { gone: { model: 'x' } } })
    );
    expect(result.applied?.skippedNodeIds).toEqual(['gone']);
    expect(result.applied?.patches).toEqual({});
  });

  test('rejects canonical workflow name mismatch before apply', () => {
    const workflow = makeTestWorkflow({ name: 'test-workflow' });
    expect(() =>
      resolveFreshDispatchEnvOverlay(
        workflow,
        candidate({ workflowName: 'other-workflow', patches: { default: { model: 'x' } } })
      )
    ).toThrow(EnvOverlayError);
    try {
      resolveFreshDispatchEnvOverlay(
        workflow,
        candidate({ workflowName: 'other-workflow', patches: { default: { model: 'x' } } })
      );
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('workflow_mismatch');
    }
  });

  test('rejects unsupported field for node kind', () => {
    const workflow = makeTestWorkflow({
      name: 'test-workflow',
      nodes: [{ id: 'default', command: 'test-command' }],
    });
    try {
      resolveFreshDispatchEnvOverlay(
        workflow,
        candidate({ patches: { default: { prompt: 'nope' } } })
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('field_not_supported_for_node');
      expect(formatEnvOverlayDispatchMessage(err as EnvOverlayError)).toContain(
        'field_not_supported_for_node'
      );
      expect(formatEnvOverlayDispatchMessage(err as EnvOverlayError)).not.toContain('nope');
    }
  });
});

describe('resolveContinuationDispatchEnvOverlay', () => {
  test('YAML-only resume when run has no stored overlay', () => {
    const workflow = makeTestWorkflow({ name: 'test-workflow' });
    const result = resolveContinuationDispatchEnvOverlay(workflow, undefined, undefined);
    expect(result.workflow).toBe(workflow);
    expect(result.applied).toBeUndefined();
  });

  test('restores stored patches and ignores request candidate with notice', () => {
    const workflow = makeTestWorkflow({
      name: 'test-workflow',
      nodes: [{ id: 'default', prompt: 'base', provider: 'claude' }],
    });
    const stored = {
      envId: 'env-stored',
      envName: 'stored-env',
      workflowName: 'test-workflow',
      patches: { default: { model: 'from-stored' } },
      skippedNodeIds: ['was-missing'],
      latestMissingNodeIds: [],
      resolved: { default: { provider: 'claude', model: 'from-stored' } },
    };
    const request = candidate({
      envId: 'env-new',
      envName: 'new-env',
      patches: { default: { model: 'from-request' } },
    });

    const result = resolveContinuationDispatchEnvOverlay(workflow, stored, request);
    expect(result.applied).toEqual({
      envId: 'env-stored',
      envName: 'stored-env',
      workflowName: 'test-workflow',
      patches: { default: { model: 'from-stored' } },
      skippedNodeIds: ['was-missing'],
    });
    expect(result.workflow.nodes[0]).toMatchObject({ model: 'from-stored' });
    expect(result.ignoredRequestEnv).toEqual({ envId: 'env-new', envName: 'new-env' });
  });

  test('malformed stored snapshot throws invalid_overlay_snapshot', () => {
    const workflow = makeTestWorkflow({ name: 'test-workflow' });
    try {
      resolveContinuationDispatchEnvOverlay(workflow, { not: 'valid' }, undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvOverlayError);
      expect((err as EnvOverlayError).code).toBe('invalid_overlay_snapshot');
    }
  });
});
