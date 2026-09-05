import { describe, expect, test } from 'bun:test';
import {
  workflowEnvNameSchema,
  workflowEnvRowSchema,
  workflowEnvSummarySchema,
  workflowEnvWorkflowNameSchema,
} from './workflow-env';

describe('workflowEnvNameSchema', () => {
  test('accepts trimmed 1–64 names matching the identity regex', () => {
    expect(workflowEnvNameSchema.parse('A')).toBe('A');
    expect(workflowEnvNameSchema.parse(' baseline ')).toBe('baseline');
    expect(workflowEnvNameSchema.parse('v1.2_fast-model')).toBe('v1.2_fast-model');
    expect(workflowEnvNameSchema.parse('a'.repeat(64))).toBe('a'.repeat(64));
  });

  test('rejects empty, overlong, and illegal characters', () => {
    expect(() => workflowEnvNameSchema.parse('')).toThrow();
    expect(() => workflowEnvNameSchema.parse('   ')).toThrow();
    expect(() => workflowEnvNameSchema.parse('a'.repeat(65))).toThrow();
    expect(() => workflowEnvNameSchema.parse('_leading')).toThrow();
    expect(() => workflowEnvNameSchema.parse('has space')).toThrow();
    expect(() => workflowEnvNameSchema.parse('bad/slash')).toThrow();
  });
});

describe('workflowEnvWorkflowNameSchema', () => {
  test('accepts flat and single-namespace workflow names up to 255', () => {
    expect(workflowEnvWorkflowNameSchema.parse('feature')).toBe('feature');
    expect(workflowEnvWorkflowNameSchema.parse('pack/feature')).toBe('pack/feature');
    expect(workflowEnvWorkflowNameSchema.parse('a'.repeat(255))).toBe('a'.repeat(255));
  });

  test('rejects empty, overlong, and multi-slash paths', () => {
    expect(() => workflowEnvWorkflowNameSchema.parse('')).toThrow();
    expect(() => workflowEnvWorkflowNameSchema.parse('a'.repeat(256))).toThrow();
    expect(() => workflowEnvWorkflowNameSchema.parse('a/b/c')).toThrow();
    expect(() => workflowEnvWorkflowNameSchema.parse('../x')).toThrow();
  });
});

describe('workflowEnvRowSchema / summary', () => {
  const baseRow = {
    id: 'env-1',
    workflow_name: 'feature',
    name: 'baseline',
    patches: {} as Record<string, never>,
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: new Date('2026-09-05T01:00:00.000Z'),
    created_by_user_id: null as string | null,
  };

  test('accepts empty patches and Date|string timestamps', () => {
    const parsed = workflowEnvRowSchema.parse(baseRow);
    expect(parsed.patches).toEqual({});
    expect(parsed.created_by_user_id).toBeNull();
  });

  test('accepts a valid node patch map', () => {
    const parsed = workflowEnvRowSchema.parse({
      ...baseRow,
      patches: {
        research: { provider: 'claude', model: 'claude-sonnet-4', prompt: 'try harder' },
      },
    });
    expect(parsed.patches.research?.provider).toBe('claude');
  });

  test('summary omits patches', () => {
    const summary = workflowEnvSummarySchema.parse({
      id: baseRow.id,
      workflow_name: baseRow.workflow_name,
      name: baseRow.name,
      created_at: baseRow.created_at,
      updated_at: baseRow.updated_at,
      created_by_user_id: baseRow.created_by_user_id,
    });
    expect(summary).not.toHaveProperty('patches');
  });

  test('rejects empty per-node patches and unknown patch keys', () => {
    expect(() =>
      workflowEnvRowSchema.parse({
        ...baseRow,
        patches: { research: {} },
      })
    ).toThrow();
    expect(() =>
      workflowEnvRowSchema.parse({
        ...baseRow,
        patches: { research: { provider: 'claude', temperature: 0.2 } },
      })
    ).toThrow();
  });

  test('rejects invalid stored workflow_name and name identities', () => {
    expect(() =>
      workflowEnvRowSchema.parse({
        ...baseRow,
        workflow_name: 'bad//workflow',
      })
    ).toThrow();
    expect(() =>
      workflowEnvRowSchema.parse({
        ...baseRow,
        name: 'has space',
      })
    ).toThrow();

    expect(() =>
      workflowEnvSummarySchema.parse({
        id: baseRow.id,
        workflow_name: 'bad//workflow',
        name: baseRow.name,
        created_at: baseRow.created_at,
        updated_at: baseRow.updated_at,
        created_by_user_id: baseRow.created_by_user_id,
      })
    ).toThrow();
    expect(() =>
      workflowEnvSummarySchema.parse({
        id: baseRow.id,
        workflow_name: baseRow.workflow_name,
        name: 'has space',
        created_at: baseRow.created_at,
        updated_at: baseRow.updated_at,
        created_by_user_id: baseRow.created_by_user_id,
      })
    ).toThrow();
  });
});
