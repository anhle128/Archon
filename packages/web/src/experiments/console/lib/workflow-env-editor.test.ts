import { describe, expect, test } from 'bun:test';
import { HttpError } from './http';
import {
  PLAINTEXT_NOTICE,
  LOOP_GROUP_BODY_NOTE,
  buildPatchesFromDrafts,
  draftFromPatch,
  draftsFromPatches,
  emptyNodeDraft,
  formatWorkflowEnvActionError,
  isValidEnvName,
  thinkingFromPatch,
  thinkingToPatch,
  workflowEnvCacheInvalidationTargets,
  type NodePatchDraft,
} from './workflow-env-editor';
import type { WorkflowEnvPreviewTarget } from '../skills/workflowEnvs';

const targets: WorkflowEnvPreviewTarget[] = [
  {
    id: 'plan',
    nodeType: 'prompt',
    allowedFields: ['provider', 'model', 'effort', 'thinking', 'prompt'],
  },
  {
    id: 'include__child',
    nodeType: 'command',
    allowedFields: ['provider', 'model', 'effort', 'thinking'],
  },
  {
    id: 'run_bash',
    nodeType: 'bash',
    allowedFields: ['bash'],
  },
  {
    id: 'group',
    nodeType: 'loop_group',
    allowedFields: ['provider', 'model'],
  },
];

function draft(partial: Partial<NodePatchDraft> & { nodeId: string }): NodePatchDraft {
  return { ...emptyNodeDraft(partial.nodeId), ...partial };
}

describe('workflow-env-editor thinking', () => {
  test('normalizes schema-supported thinking choices', () => {
    expect(thinkingToPatch({ mode: 'unset', budgetTokens: '' })).toBeUndefined();
    expect(thinkingToPatch({ mode: 'adaptive', budgetTokens: '' })).toEqual({ type: 'adaptive' });
    expect(thinkingToPatch({ mode: 'disabled', budgetTokens: '' })).toEqual({ type: 'disabled' });
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '' })).toEqual({ type: 'enabled' });
    expect(thinkingToPatch({ mode: 'enabled', budgetTokens: '2000' })).toEqual({
      type: 'enabled',
      budgetTokens: 2000,
    });
  });

  test('rejects invalid budgetTokens', () => {
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '1.5' })).toThrow(
      /non-negative integer/
    );
    expect(() => thinkingToPatch({ mode: 'enabled', budgetTokens: '-1' })).toThrow(
      /non-negative integer/
    );
  });

  test('round-trips thinking from stored patch', () => {
    expect(thinkingFromPatch({ type: 'adaptive' })).toEqual({
      mode: 'adaptive',
      budgetTokens: '',
    });
    expect(thinkingFromPatch({ type: 'enabled', budgetTokens: 9 })).toEqual({
      mode: 'enabled',
      budgetTokens: '9',
    });
    expect(thinkingFromPatch(undefined).mode).toBe('unset');
  });
});

describe('buildPatchesFromDrafts — full-map replacement', () => {
  test('builds complete patch map with only allowed fields', () => {
    const result = buildPatchesFromDrafts(
      [
        draft({
          nodeId: 'plan',
          provider: 'claude',
          model: 'sonnet',
          effort: 'high',
          thinking: { mode: 'enabled', budgetTokens: '1000' },
          prompt: 'do the thing',
          bash: 'should-not-appear',
        }),
        draft({
          nodeId: 'include__child',
          provider: 'codex',
          model: 'gpt',
        }),
        draft({
          nodeId: 'run_bash',
          bash: 'echo hi',
        }),
      ],
      targets
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Full map — every chosen node present; bash stripped from prompt target.
    expect(result.patches).toEqual({
      plan: {
        provider: 'claude',
        model: 'sonnet',
        effort: 'high',
        thinking: { type: 'enabled', budgetTokens: 1000 },
        prompt: 'do the thing',
      },
      include__child: {
        provider: 'codex',
        model: 'gpt',
      },
      run_bash: {
        bash: 'echo hi',
      },
    });
    expect(result.patches.plan).not.toHaveProperty('bash');
  });

  test('requires non-empty patch per chosen node', () => {
    const empty = buildPatchesFromDrafts([draft({ nodeId: 'plan' })], targets);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error).toMatch(/at least one allowed field/i);
  });

  test('rejects unknown and duplicate targets', () => {
    const unknown = buildPatchesFromDrafts(
      [draft({ nodeId: 'group.child', provider: 'claude' })],
      targets
    );
    expect(unknown.ok).toBe(false);

    const dup = buildPatchesFromDrafts(
      [draft({ nodeId: 'plan', provider: 'a' }), draft({ nodeId: 'plan', provider: 'b' })],
      targets
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/Duplicate/);
  });

  test('preserves include-expanded ids as returned', () => {
    const result = buildPatchesFromDrafts(
      [draft({ nodeId: 'include__child', model: 'x' })],
      targets
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.patches)).toEqual(['include__child']);
  });

  test('draftsFromPatches loads complete map for editor', () => {
    const drafts = draftsFromPatches({
      plan: { provider: 'claude', thinking: { type: 'disabled' } },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.nodeId).toBe('plan');
    expect(drafts[0]?.provider).toBe('claude');
    expect(drafts[0]?.thinking.mode).toBe('disabled');
    expect(draftFromPatch('x', { model: 'm' }).model).toBe('m');
  });
});

describe('ENV name + notices', () => {
  test('validates ENV name shape', () => {
    expect(isValidEnvName('fast')).toBe(true);
    expect(isValidEnvName('A1._-z')).toBe(true);
    expect(isValidEnvName('')).toBe(false);
    expect(isValidEnvName('-bad')).toBe(false);
    expect(isValidEnvName('has space')).toBe(false);
  });

  test('plaintext notice never claims secrets or encryption', () => {
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('plaintext');
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('not secrets');
    expect(PLAINTEXT_NOTICE.toLowerCase()).toContain('not encrypted');
    expect(PLAINTEXT_NOTICE.toLowerCase()).not.toMatch(/\bsecret\b(?!s)/); // allow "secrets" in "not secrets"
    expect(LOOP_GROUP_BODY_NOTE.toLowerCase()).toContain('loop-group');
  });
});

describe('conflict + cache invalidation', () => {
  test('formats 409 conflict from HttpError body', () => {
    const err = new HttpError(
      409,
      '/api/workflows/wf/envs',
      JSON.stringify({ error: 'env_name_conflict', detail: 'name taken' })
    );
    expect(formatWorkflowEnvActionError(err)).toBe('name taken');
    const bare = new HttpError(409, '/x', 'not-json');
    expect(formatWorkflowEnvActionError(bare)).toMatch(/conflict/i);
  });

  test('cache invalidation targets list + preview prefix + optional detail', () => {
    expect(workflowEnvCacheInvalidationTargets('a:b')).toEqual([
      'workflowEnvs:a%3Ab',
      'workflowEnvPreview',
    ]);
    expect(workflowEnvCacheInvalidationTargets('wf', 'e1')).toEqual([
      'workflowEnvs:wf',
      'workflowEnvPreview',
      'workflowEnv:wf:e1',
    ]);
  });
});
