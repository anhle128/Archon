import { describe, expect, test } from 'bun:test';
import {
  ENV_OVERLAY_MAX_BYTES,
  ENV_OVERLAY_MAX_TARGETS,
  appliedEnvOverlaySchema,
  envNodePatchSchema,
  envOverlayCandidateSchema,
  envOverlaySnapshotSchema,
  envPatchTargetKeySchema,
  envPatchesSchema,
  nodeExecutionMetadataSchema,
  storedEnvOverlaySchema,
} from './env-overlay';

describe('envPatchTargetKeySchema', () => {
  test('accepts ordinary node ids and long include-expanded ids', () => {
    expect(envPatchTargetKeySchema.parse('review')).toBe('review');
    expect(envPatchTargetKeySchema.parse('quality__review')).toBe('quality__review');
    const longIncludeId = `include_${'a'.repeat(40)}__child_${'b'.repeat(40)}`;
    expect(longIncludeId.length).toBeGreaterThan(64);
    expect(envPatchTargetKeySchema.parse(longIncludeId)).toBe(longIncludeId);
  });

  test('rejects empty and reserved object keys', () => {
    expect(envPatchTargetKeySchema.safeParse('').success).toBe(false);
    expect(envPatchTargetKeySchema.safeParse('__proto__').success).toBe(false);
    expect(envPatchTargetKeySchema.safeParse('prototype').success).toBe(false);
    expect(envPatchTargetKeySchema.safeParse('constructor').success).toBe(false);
  });

  test('rejects illegal characters', () => {
    expect(envPatchTargetKeySchema.safeParse('has.dot').success).toBe(false);
    expect(envPatchTargetKeySchema.safeParse('has space').success).toBe(false);
    expect(envPatchTargetKeySchema.safeParse('9starts-digit').success).toBe(false);
  });
});

describe('envNodePatchSchema', () => {
  test('accepts each allowed field and thinking shorthand', () => {
    expect(envNodePatchSchema.parse({ provider: '  claude  ' })).toEqual({ provider: 'claude' });
    expect(envNodePatchSchema.parse({ model: '  opus  ' })).toEqual({ model: 'opus' });
    expect(envNodePatchSchema.parse({ effort: 'high' })).toEqual({ effort: 'high' });
    expect(envNodePatchSchema.parse({ thinking: 'enabled' })).toEqual({
      thinking: { type: 'enabled' },
    });
    expect(envNodePatchSchema.parse({ prompt: '' })).toEqual({ prompt: '' });
    expect(envNodePatchSchema.parse({ prompt: '   ' })).toEqual({ prompt: '   ' });
    expect(envNodePatchSchema.parse({ bash: '' })).toEqual({ bash: '' });
    expect(envNodePatchSchema.parse({ bash: '\t' })).toEqual({ bash: '\t' });
  });

  test('rejects empty per-node patch, unknown keys, and empty provider/model', () => {
    expect(envNodePatchSchema.safeParse({}).success).toBe(false);
    expect(envNodePatchSchema.safeParse({ foo: 'bar' }).success).toBe(false);
    expect(envNodePatchSchema.safeParse({ provider: '   ' }).success).toBe(false);
    expect(envNodePatchSchema.safeParse({ model: '' }).success).toBe(false);
  });
});

describe('envPatchesSchema', () => {
  test('accepts empty map and normal targets', () => {
    expect(envPatchesSchema.parse({})).toEqual({});
    expect(envPatchesSchema.parse({ review: { model: 'x' } })).toEqual({
      review: { model: 'x' },
    });
  });

  test(`rejects more than ${ENV_OVERLAY_MAX_TARGETS} targets`, () => {
    const patches: Record<string, { model: string }> = {};
    for (let i = 0; i < ENV_OVERLAY_MAX_TARGETS + 1; i++) {
      patches[`n_${i}`] = { model: 'm' };
    }
    expect(envPatchesSchema.safeParse(patches).success).toBe(false);
  });

  test(`rejects documents over ${ENV_OVERLAY_MAX_BYTES} UTF-8 bytes`, () => {
    // One large prompt body that serializes past the 1 MiB bound.
    const huge = 'x'.repeat(ENV_OVERLAY_MAX_BYTES);
    expect(envPatchesSchema.safeParse({ n1: { prompt: huge } }).success).toBe(false);
  });
});

describe('lifecycle overlay schemas', () => {
  const base = {
    envId: 'env-1',
    envName: 'fast',
    workflowName: 'demo',
    patches: { review: { model: 'small' } },
    skippedNodeIds: ['gone'],
  };

  test('candidate / applied / snapshot / stored union', () => {
    expect(
      envOverlayCandidateSchema.parse({
        envId: 'env-1',
        envName: 'fast',
        workflowName: 'demo',
        patches: {},
      })
    ).toMatchObject({ envName: 'fast' });

    expect(appliedEnvOverlaySchema.parse(base)).toMatchObject({ skippedNodeIds: ['gone'] });

    const complete = {
      ...base,
      latestMissingNodeIds: [],
      resolved: {
        review: { provider: 'claude', model: 'opus', tier: 'large' as const },
      },
    };
    expect(envOverlaySnapshotSchema.parse(complete)).toMatchObject({
      latestMissingNodeIds: [],
    });

    // Complete first: pending form must not reject snapshot extras via union order.
    expect(storedEnvOverlaySchema.parse(complete).success ?? true).toBeTruthy();
    expect(storedEnvOverlaySchema.safeParse(complete).success).toBe(true);
    expect(storedEnvOverlaySchema.safeParse(base).success).toBe(true);

    // Partial hybrid (resolved without latestMissingNodeIds) rejected.
    expect(
      storedEnvOverlaySchema.safeParse({
        ...base,
        resolved: { review: { provider: 'claude' } },
      }).success
    ).toBe(false);
  });

  test('nodeExecutionMetadataSchema is strict', () => {
    expect(
      nodeExecutionMetadataSchema.parse({
        provider: 'claude',
        thinking: { type: 'disabled' },
      })
    ).toEqual({ provider: 'claude', thinking: { type: 'disabled' } });
    expect(nodeExecutionMetadataSchema.safeParse({ provider: 'claude', extra: true }).success).toBe(
      false
    );
  });
});
