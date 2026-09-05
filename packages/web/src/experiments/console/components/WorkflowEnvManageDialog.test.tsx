import { createElement } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodePatchEditor, WorkflowEnvManageDialog } from './WorkflowEnvManageDialog';
import {
  LOOP_GROUP_BODY_NOTE,
  PLAINTEXT_NOTICE,
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
    expect(html).not.toContain('data-testid="env-field-bash"');
    // Include-expanded ids appear as returned in the select options.
    expect(html).toContain('pack__step');
    expect(html).toContain('plan (prompt)');
  });

  test('bash target shows only bash field', () => {
    const html = renderNode(emptyNodeDraft('run_bash'), ['bash']);
    expect(html).toContain('data-testid="env-field-bash"');
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
