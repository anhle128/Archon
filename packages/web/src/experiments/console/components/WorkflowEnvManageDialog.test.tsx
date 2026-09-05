/**
 * WorkflowEnvManageDialog tests — static NodePatchEditor markup plus mounted
 * create/edit flows (happy-dom) for no-op patches: {}.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import {
  NodePatchEditor,
  WorkflowEnvEditorView,
  WorkflowEnvManageDialog,
} from './WorkflowEnvManageDialog';
import {
  LOOP_GROUP_BODY_NOTE,
  PLAINTEXT_NOTICE,
  buildPatchesFromDrafts,
  emptyNodeDraft,
  type NodePatchDraft,
} from '../lib/workflow-env-editor';
import * as skill from '../skills';
import type { WorkflowEnv, WorkflowEnvPreviewTarget } from '../skills/workflowEnvs';
import { invalidate } from '../store/cache';

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
    const html = renderNode(emptyNodeDraft('plan'));
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).toContain('data-testid="env-field-effort"');
    expect(html).toContain('data-testid="env-field-thinking-mode"');
    expect(html).toContain('data-testid="env-field-prompt-enabled"');
    expect(html).not.toContain('data-testid="env-field-bash-enabled"');
  });

  test('bash target shows only bash field', () => {
    const html = renderNode(emptyNodeDraft('run_bash'));
    expect(html).toContain('data-testid="env-field-bash-enabled"');
    expect(html).not.toContain('data-testid="env-field-provider"');
    expect(html).not.toContain('data-testid="env-field-prompt-enabled"');
  });

  test('command target omits prompt and bash', () => {
    const html = renderNode(emptyNodeDraft('pack__step'));
    expect(html).toContain('data-testid="env-field-provider"');
    expect(html).toContain('data-testid="env-field-model"');
    expect(html).not.toContain('data-testid="env-field-prompt-enabled"');
    expect(html).not.toContain('data-testid="env-field-bash-enabled"');
  });

  test('explicitly enabled empty prompt/bash bodies render and are not dropped on save', () => {
    const promptHtml = renderNode({
      ...emptyNodeDraft('plan'),
      promptEnabled: true,
      prompt: '',
    });
    expect(promptHtml).toContain('data-testid="env-field-prompt-enabled"');
    expect(promptHtml).toContain('data-testid="env-field-prompt"');

    const bashHtml = renderNode({
      ...emptyNodeDraft('run_bash'),
      bashEnabled: true,
      bash: '',
    });
    expect(bashHtml).toContain('data-testid="env-field-bash-enabled"');
    expect(bashHtml).toContain('data-testid="env-field-bash"');

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
    expect(html.toLowerCase()).not.toContain('encrypted at rest');
    expect(html).toContain('Workflow ENVs');
    expect(html).toContain('feature');
  });
});

// ---------------------------------------------------------------------------
// Mounted create/edit — happy-dom + React.act (NODE_ENV=development for act)
// ---------------------------------------------------------------------------

interface Clickable {
  click: () => void;
  disabled?: boolean;
}

function asClickable(el: Element): Clickable {
  return el as unknown as Clickable;
}

function installHappyDom(): Window {
  const win = new Window({ url: 'https://localhost/' });
  // happy-dom types intentionally diverge from lib.dom; install via unknown bag.
  const bag: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    SVGElement: win.SVGElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLButtonElement: win.HTMLButtonElement,
    HTMLFormElement: win.HTMLFormElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    navigator: win.navigator,
    location: win.location,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    InputEvent: win.InputEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, bag);
  return win;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface ReactChangeProps {
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
}

function setInputValue(input: Element, value: string): void {
  // happy-dom native input/change events do not always drive React 19 controlled
  // inputs; invoke the fiber onChange prop with a minimal synthetic event.
  const propsKey = Object.keys(input).find(k => k.startsWith('__reactProps$'));
  let onChange: ReactChangeProps['onChange'];
  if (propsKey !== undefined && propsKey in input) {
    const props = (input as unknown as Record<string, unknown>)[propsKey];
    if (props !== null && typeof props === 'object' && 'onChange' in props) {
      const candidate = (props as ReactChangeProps).onChange;
      if (typeof candidate === 'function') {
        onChange = candidate;
      }
    }
  }
  if (onChange !== undefined) {
    onChange({ target: { value }, currentTarget: { value } });
    return;
  }
  const el = input as unknown as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function requireTestId(root: Element, testId: string): Element {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (el === null) {
    throw new Error(`missing [data-testid="${testId}"]`);
  }
  return el;
}

describe('WorkflowEnvEditorView mounted no-op patches', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    // React.act requires the development build.
    // happy-dom must be installed before createRoot.
    process.env.NODE_ENV = 'development';
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    invalidate('workflowEnvs');
    invalidate('workflowEnvPreview');
    invalidate('workflowEnv');
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    for (const s of spies.splice(0)) s.mockRestore();
    win.close();
  });

  function track<T extends { mockRestore: () => void }>(s: T): T {
    spies.push(s);
    return s;
  }

  function EditorHarness(props: {
    mode: 'create' | 'edit';
    workflowName: string;
    envId: string | null;
    targets: WorkflowEnvPreviewTarget[];
    targetsLoading?: boolean;
    targetsError?: Error;
  }): ReactElement {
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    return createElement(WorkflowEnvEditorView, {
      mode: props.mode,
      workflowName: props.workflowName,
      envId: props.envId,
      targets: props.targets,
      targetsLoading: props.targetsLoading ?? false,
      targetsError: props.targetsError,
      busy,
      setBusy,
      actionError,
      setActionError,
      onCancel: () => undefined,
      onSaved: () => undefined,
    });
  }

  test('create flow with zero editable targets POSTs { patches: {} }', async () => {
    const createSpy = track(
      spyOn(skill, 'createWorkflowEnv').mockImplementation(
        async (_wf: string, body: { name: string; patches: Record<string, unknown> }) => {
          const row: WorkflowEnv = {
            id: 'env-new',
            workflowName: 'feature',
            name: body.name,
            patches: body.patches as WorkflowEnv['patches'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdByUserId: null,
          };
          return row;
        }
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'create',
          workflowName: 'feature',
          envId: null,
          // Discovery resolved successfully with zero targets.
          targets: [],
          targetsLoading: false,
        })
      );
    });
    await flush();

    const emptyCopy = host.querySelector('[data-testid="env-empty-patches"]');
    expect(emptyCopy?.textContent ?? '').toContain('no-op ENV');
    expect(emptyCopy?.textContent ?? '').toContain('patches: {}');
    expect(emptyCopy?.textContent ?? '').toContain('No editable target nodes');

    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(false);

    const nameInput = requireTestId(host, 'env-editor-name');
    await act(async () => {
      setInputValue(nameInput, 'noop-env');
    });

    await act(async () => {
      asClickable(submit).click();
    });
    await flush();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]).toBe('feature');
    expect(createSpy.mock.calls[0]?.[1]).toEqual({
      name: 'noop-env',
      patches: {},
    });
  });

  test('edit flow removing every patch PATCHes complete { patches: {} }', async () => {
    const existing: WorkflowEnv = {
      id: 'env-1',
      workflowName: 'feature',
      name: 'was-fast',
      patches: { plan: { provider: 'claude' } },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: null,
    };

    track(spyOn(skill, 'getWorkflowEnv').mockResolvedValue(existing));

    const updateSpy = track(
      spyOn(skill, 'updateWorkflowEnv').mockImplementation(
        async (
          _wf: string,
          envId: string,
          body: { name?: string; patches?: Record<string, unknown> }
        ) => ({
          ...existing,
          id: envId,
          name: body.name ?? existing.name,
          patches: (body.patches ?? existing.patches) as WorkflowEnv['patches'],
          updatedAt: '2026-01-02T00:00:00.000Z',
        })
      )
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'edit',
          workflowName: 'feature',
          envId: 'env-1',
          // Targets exist so the loaded draft can render, then be removed.
          targets,
          targetsLoading: false,
        })
      );
    });
    await flush();

    // Detail load resolved — draft row present.
    expect(host.querySelector('[data-testid="env-node-patch"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="env-empty-patches"]')).toBeNull();

    const removeBtn = Array.from(host.querySelectorAll('button')).find(
      b => b.getAttribute('aria-label') === 'Remove node patch'
    );
    if (removeBtn === undefined) {
      throw new Error('missing Remove node patch button');
    }

    await act(async () => {
      asClickable(removeBtn).click();
    });
    await flush();

    const emptyCopy = host.querySelector('[data-testid="env-empty-patches"]');
    expect(emptyCopy?.textContent ?? '').toContain('no-op ENV');
    expect(emptyCopy?.textContent ?? '').toContain('patches: {}');
    // Targets still exist; copy is "no patches yet" not "no editable target nodes".
    expect(emptyCopy?.textContent ?? '').toContain('No patches yet');

    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(false);

    await act(async () => {
      asClickable(submit).click();
    });
    await flush();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]).toBe('feature');
    expect(updateSpy.mock.calls[0]?.[1]).toBe('env-1');
    expect(updateSpy.mock.calls[0]?.[2]).toEqual({
      name: 'was-fast',
      patches: {},
    });
  });

  test('target discovery loading disables submit and does not POST', async () => {
    const createSpy = track(
      spyOn(skill, 'createWorkflowEnv').mockResolvedValue({
        id: 'x',
        workflowName: 'feature',
        name: 'x',
        patches: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'create',
          workflowName: 'feature',
          envId: null,
          targets: [],
          targetsLoading: true,
        })
      );
    });
    await flush();

    expect(host.textContent).toContain('Loading allowed target fields');
    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(true);

    const nameInput = requireTestId(host, 'env-editor-name');
    await act(async () => {
      setInputValue(nameInput, 'blocked');
    });
    await flush();

    await act(async () => {
      // Force click even though disabled — onSubmit must still refuse if invoked.
      asClickable(submit).disabled = false;
      asClickable(submit).click();
    });
    await flush();

    expect(createSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toMatch(
      /still loading/i
    );
  });

  test('target discovery failure disables submit and cannot overwrite ENV', async () => {
    const updateSpy = track(
      spyOn(skill, 'updateWorkflowEnv').mockResolvedValue({
        id: 'env-1',
        workflowName: 'feature',
        name: 'keep',
        patches: { plan: { model: 'x' } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );
    track(
      spyOn(skill, 'getWorkflowEnv').mockResolvedValue({
        id: 'env-1',
        workflowName: 'feature',
        name: 'keep',
        patches: { plan: { model: 'x' } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdByUserId: null,
      })
    );

    await act(async () => {
      root.render(
        createElement(EditorHarness, {
          mode: 'edit',
          workflowName: 'feature',
          envId: 'env-1',
          targets: [],
          targetsLoading: false,
          targetsError: new Error('preview boom'),
        })
      );
    });
    await flush();

    expect(host.textContent).toContain('Baseline preview failed');
    expect(host.textContent).toContain('preview boom');
    const submit = requireTestId(host, 'env-editor-submit');
    expect(asClickable(submit).disabled).toBe(true);

    await act(async () => {
      asClickable(submit).disabled = false;
      asClickable(submit).click();
    });
    await flush();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="env-editor-error"]')?.textContent ?? '').toContain(
      'preview boom'
    );
  });
});
