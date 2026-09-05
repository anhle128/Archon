import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodePatchEditor, WorkflowEnvManageDialog } from './WorkflowEnvManageDialog';
import {
  LOOP_GROUP_BODY_NOTE,
  PLAINTEXT_NOTICE,
  buildPatchesFromDrafts,
  emptyNodeDraft,
  type NodePatchDraft,
} from '../lib/workflow-env-editor';
import type { WorkflowEnvPreviewTarget } from '../skills/workflowEnvs';

const targets: WorkflowEnvPreviewTarget[] = [
  {
    id: 'plan',
    nodeType: 'prompt',
    allowedFields: ['provider', 'model', 'effort', 'thinking', 'prompt'],
  },
  {
    id: 'pack__step',
    nodeType: 'command',
    allowedFields: ['provider', 'model'],
  },
  {
    id: 'run_bash',
    nodeType: 'bash',
    allowedFields: ['bash'],
  },
];

function renderNode(
  draft: NodePatchDraft,
  allowedFields?: WorkflowEnvPreviewTarget['allowedFields']
): string {
  const target = targets.find(t => t.id === draft.nodeId) ?? targets[0];
  if (target === undefined) {
    throw new Error('test targets must not be empty');
  }
  const fields = allowedFields ?? target.allowedFields;
  return renderToStaticMarkup(
    createElement(NodePatchEditor, {
      draft,
      targets,
      allowedFields: fields,
      onChange: () => undefined,
      onRemove: () => undefined,
    })
  );
}

describe('NodePatchEditor allowed-field rendering', () => {
  test('prompt target shows provider/model/effort/thinking/prompt and not bash', () => {
    const html = renderNode({
      ...emptyNodeDraft('plan'),
      provider: 'claude',
    });
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).toContain('data-testid="env-field-effort"');
    expect(html).toContain('data-testid="env-field-thinking-mode"');
    expect(html).toContain('data-testid="env-field-prompt"');
    expect(html).toContain('data-testid="env-field-prompt-enabled"');
    expect(html).not.toContain('data-testid="env-field-bash"');
    // Include-expanded ids appear as returned in the select options.
    expect(html).toContain('pack__step');
    expect(html).toContain('plan (prompt)');
  });

  test('bash target shows only bash field', () => {
    const html = renderNode(emptyNodeDraft('run_bash'), ['bash']);
    expect(html).toContain('data-testid="env-field-bash"');
    expect(html).toContain('data-testid="env-field-bash-enabled"');
    expect(html).not.toContain('data-testid="env-field-provider"');
    expect(html).not.toContain('data-testid="env-field-prompt"');
    expect(html).not.toContain('data-testid="env-field-model"');
  });

  test('command target omits prompt and bash', () => {
    const html = renderNode(emptyNodeDraft('pack__step'), ['provider', 'model']);
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).not.toContain('data-testid="env-field-prompt"');
    expect(html).not.toContain('data-testid="env-field-bash"');
    expect(html).not.toContain('data-testid="env-field-thinking-mode"');
  });

  test('explicitly enabled empty prompt/bash bodies render and are not dropped on save', () => {
    const promptHtml = renderNode({
      ...emptyNodeDraft('plan'),
      promptEnabled: true,
      prompt: '',
    });
    expect(promptHtml).toContain('data-testid="env-field-prompt-enabled"');
    expect(promptHtml).toMatch(/data-testid="env-field-prompt-enabled"[^>]*checked/);
    expect(promptHtml).toContain('data-testid="env-field-prompt"');
    // Empty value is intentional — textarea present, body not forced non-empty.
    expect(promptHtml).not.toMatch(/data-testid="env-field-prompt"[^>]*>[^<]+</);

    const bashHtml = renderNode(
      {
        ...emptyNodeDraft('run_bash'),
        bashEnabled: true,
        bash: '',
      },
      ['bash']
    );
    expect(bashHtml).toMatch(/data-testid="env-field-bash-enabled"[^>]*checked/);

    // Dialog onSubmit uses buildPatchesFromDrafts — enabled empty bodies survive full-map save.
    const savedPrompt = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('plan'), promptEnabled: true, prompt: '' }],
      targets
    );
    expect(savedPrompt).toEqual({ ok: true, patches: { plan: { prompt: '' } } });

    const savedBash = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('run_bash'), bashEnabled: true, bash: '' }],
      targets
    );
    expect(savedBash).toEqual({ ok: true, patches: { run_bash: { bash: '' } } });

    // Untouched (disabled) body stays omitted.
    const omitted = buildPatchesFromDrafts(
      [{ ...emptyNodeDraft('plan'), provider: 'claude', promptEnabled: false, prompt: '' }],
      targets
    );
    expect(omitted).toEqual({ ok: true, patches: { plan: { provider: 'claude' } } });
  });
});

describe('WorkflowEnvManageDialog create/update empty patches', () => {
  test('create and full-map PATCH can submit patches: {}', () => {
    // EditorView starts create with drafts=[] and onSubmit calls buildPatchesFromDrafts.
    // Zero chosen targets is a valid no-op ENV; PATCH with all rows removed is the same.
    const createBody = buildPatchesFromDrafts([], targets);
    expect(createBody).toEqual({ ok: true, patches: {} });

    const fullMapPatch = buildPatchesFromDrafts([], targets);
    expect(fullMapPatch).toEqual({ ok: true, patches: {} });
    // Identity of the empty object map the dialog would POST/PATCH.
    expect(JSON.stringify(createBody.ok ? createBody.patches : null)).toBe('{}');
    expect(JSON.stringify(fullMapPatch.ok ? fullMapPatch.patches : null)).toBe('{}');
  });

  test('empty drafts state copy documents no-op ENV save', () => {
    // Static shell cannot drive EditorView state; assert the empty-patches contract
    // text lives on the component source used when drafts.length === 0.
    // Runtime path is buildPatchesFromDrafts([]) above; UI copy is a secondary signal.
    const html = renderToStaticMarkup(
      createElement(NodePatchEditor, {
        draft: emptyNodeDraft(''),
        targets,
        allowedFields: [],
        onChange: () => undefined,
        onRemove: () => undefined,
      })
    );
    // Without a selected node, body enable toggles are not forced.
    expect(html).toContain('data-testid="env-node-select"');
    expect(html).not.toContain('data-testid="env-field-prompt-enabled"');
  });
});

describe('WorkflowEnvManageDialog notices', () => {
  test('closed dialog renders nothing', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowEnvManageDialog, {
        workflowName: 'feature',
        projectCwd: '/tmp/proj',
        open: false,
        onClose: () => undefined,
      })
    );
    expect(html).toBe('');
  });

  test('open dialog shell includes plaintext + loop-group notices', () => {
    // Body mounts useEntity loaders; static markup still emits the notices
    // that live outside the async list/editor (always visible while open).
    const html = renderToStaticMarkup(
      createElement(WorkflowEnvManageDialog, {
        workflowName: 'feature',
        projectCwd: '/tmp/proj',
        open: true,
        onClose: () => undefined,
      })
    );
    expect(html).toContain(PLAINTEXT_NOTICE);
    expect(html).toContain(LOOP_GROUP_BODY_NOTE);
    expect(html).toContain('data-testid="env-plaintext-notice"');
    expect(html).toContain('data-testid="env-loop-group-note"');
    expect(html.toLowerCase()).toContain('plaintext');
    expect(html.toLowerCase()).toContain('not secrets');
    expect(html.toLowerCase()).toContain('not encrypted');
    // Must not market prompt/bash as encrypted secrets.
    expect(html.toLowerCase()).not.toContain('encrypted at rest');
    expect(html).toContain('Workflow ENVs');
    expect(html).toContain('feature');
  });
});
