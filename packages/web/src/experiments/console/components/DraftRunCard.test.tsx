/**
 * DraftRunCard ENV picker/start wiring — mounted component races (US-025).
 *
 * Pure lib/draft-env.test.ts coverage is supporting only; these tests mount the
 * rendered Start card with controlled async ENV list/preview + Start submission.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { Window } from 'happy-dom';
import { DraftRunCard } from './DraftRunCard';
import * as skill from '../skills';
import { invalidate, get as cacheGet } from '../store/cache';
import { K } from '../store/keys';
import type { Workflow } from '../primitives/workflow';
import type { WorkflowEnvPreview, WorkflowEnvSummary } from '../skills/workflowEnvs';
import type { WorkflowListResult } from '../skills/workflows';
import type { StartRunArgs } from '../skills/startRun';

interface Clickable {
  click: () => void;
  disabled?: boolean;
}

function installHappyDom(): Window {
  const win = new Window({ url: 'https://localhost/' });
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
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLFormElement: win.HTMLFormElement,
    HTMLIFrameElement: win.HTMLIFrameElement,
    navigator: win.navigator,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    getComputedStyle: win.getComputedStyle.bind(win),
    // happy-dom returns Immediate; coerce for lib.dom's number handle type.
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      const handle = win.requestAnimationFrame(cb as unknown as (time: number) => void);
      return Number(handle);
    },
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
  // WorkflowPicker reposition needs a non-zero viewport.
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(win, 'innerWidth', { value: 1200, configurable: true });
  return win;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ReactChangeProps {
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
}

function setControlValue(el: Element, value: string): void {
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  let onChange: ReactChangeProps['onChange'];
  if (propsKey !== undefined && propsKey in el) {
    const props = (el as unknown as Record<string, unknown>)[propsKey];
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
  const input = el as unknown as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function workflow(name: string, inputs: Workflow['inputs'] = []): Workflow {
  return {
    name,
    description: null,
    source: 'project',
    parseWarnings: [],
    inputs,
  };
}

function envSummary(id: string, workflowName: string, name: string): WorkflowEnvSummary {
  return {
    id,
    workflowName,
    name,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function previewOf(
  workflowName: string,
  envId: string | null,
  envName: string | null,
  modelTag: string
): WorkflowEnvPreview {
  return {
    preview: true,
    authoritative: false,
    workflowName,
    envId,
    envName,
    skippedNodeIds: envId === null ? [] : [`skip-${workflowName}`],
    targets: [],
    resolved:
      envId === null
        ? [{ nodeId: 'plan', provider: 'claude', model: `yaml-${modelTag}` }]
        : [{ nodeId: 'plan', provider: 'claude', model: modelTag }],
  };
}

function clearConsoleCaches(): void {
  invalidate('workflows');
  invalidate('workflowEnvs');
  invalidate('workflowEnvPreview');
  invalidate('workflowEnv');
  invalidate('runs');
}

function mountCard(root: Root): void {
  root.render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      createElement(DraftRunCard, {
        projectId: 'proj-1',
        projectCwd: '/tmp/proj',
      })
    )
  );
}

function envSelect(rootEl: Element): HTMLSelectElement {
  const el = rootEl.querySelector('select[aria-label="Workflow ENV overlay"]');
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error('missing ENV select');
  }
  return el;
}

function startButton(rootEl: Element): HTMLButtonElement {
  const buttons = Array.from(rootEl.querySelectorAll('button'));
  const btn = buttons.find(b => (b.textContent ?? '').includes('Start run'));
  if (btn === undefined) throw new Error('missing Start run button');
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error('Start run control is not a button');
  }
  return btn;
}

async function expandCard(host: Element): Promise<void> {
  const expand = Array.from(host.querySelectorAll('button')).find(b =>
    (b.textContent ?? '').includes('Start a new run')
  );
  if (expand === undefined) throw new Error('missing expand control');
  await act(async () => {
    (expand as unknown as Clickable).click();
  });
  await flush();
}

function stubBoundingClientRect(): () => void {
  const proto = (
    globalThis as unknown as {
      HTMLElement: {
        prototype: { getBoundingClientRect: (this: Element) => DOMRect };
      };
    }
  ).HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      bottom: 40,
      right: 200,
      width: 190,
      height: 30,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect;
  };
  return (): void => {
    proto.getBoundingClientRect = original;
  };
}

async function pickWorkflow(doc: Document, name: string): Promise<void> {
  const trigger = doc.querySelector('[data-keymap-workflow-trigger]');
  if (trigger === null) throw new Error('missing workflow trigger');
  // happy-dom getBoundingClientRect is often zero-sized; stub so the portal anchors.
  const restore = stubBoundingClientRect();
  try {
    await act(async () => {
      (trigger as unknown as Clickable).click();
    });
    await flush();
    const options = Array.from(doc.querySelectorAll('[role="option"]'));
    const opt = options.find(o => (o.textContent ?? '').includes(name));
    if (opt === undefined) {
      throw new Error(
        `missing workflow option ${name}; saw ${options.map(o => o.textContent).join('|')}`
      );
    }
    await act(async () => {
      (opt as unknown as Clickable).click();
    });
    await flush();
  } finally {
    restore();
  }
}

describe('DraftRunCard ENV picker and Start wiring', () => {
  let win: Window;
  let host: Element;
  let root: Root;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    clearConsoleCaches();
    try {
      win.localStorage.removeItem('archon.console.lastWorkflow');
    } catch {
      /* ignore */
    }
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    for (const s of spies.splice(0)) s.mockRestore();
    clearConsoleCaches();
    win.close();
  });

  function track<T extends { mockRestore: () => void }>(s: T): T {
    spies.push(s);
    return s;
  }

  test('None is default; list failure still permits YAML Start; Start omits envId', async () => {
    const listFail = deferred<WorkflowEnvSummary[]>();
    const previewNone = deferred<WorkflowEnvPreview>();
    const startCalls: StartRunArgs[] = [];

    track(
      spyOn(skill, 'listWorkflows').mockResolvedValue({
        workflows: [workflow('feature')],
        recommended: [],
      } satisfies WorkflowListResult)
    );
    track(spyOn(skill, 'listWorkflowEnvs').mockImplementation(() => listFail.promise));
    track(
      spyOn(skill, 'previewWorkflowEnv').mockImplementation((_wf, _cwd, envId) => {
        if (envId === null || envId === undefined || envId.length === 0) {
          return previewNone.promise;
        }
        return Promise.reject(new Error('unexpected selected preview'));
      })
    );
    track(
      spyOn(skill, 'startRun').mockImplementation(async (args: StartRunArgs) => {
        startCalls.push(args);
      })
    );

    await act(async () => {
      mountCard(root);
    });
    await flush();
    await expandCard(host);
    await flush();

    // List still pending — None selected, Start must stay usable for YAML.
    expect(envSelect(host).value).toBe('');
    expect(startButton(host).disabled).toBe(false);

    await act(async () => {
      listFail.reject(new Error('ENV list unavailable'));
      previewNone.resolve(previewOf('feature', null, null, 'baseline'));
    });
    await flush();

    expect(host.textContent).toContain('ENV list unavailable — YAML Start still works.');
    expect(envSelect(host).value).toBe('');
    expect(startButton(host).disabled).toBe(false);

    await act(async () => {
      (startButton(host) as unknown as Clickable).click();
    });
    await flush();

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.workflow).toBe('feature');
    expect(startCalls[0]).not.toHaveProperty('envId');
  });

  test('selected ENV Start includes envId; loading/error retain selection and disable Start', async () => {
    const listOk = deferred<WorkflowEnvSummary[]>();
    const previewNone = deferred<WorkflowEnvPreview>();
    const previewSelected = deferred<WorkflowEnvPreview>();
    const startCalls: StartRunArgs[] = [];
    let previewSelectedCalls = 0;

    track(
      spyOn(skill, 'listWorkflows').mockResolvedValue({
        workflows: [workflow('feature')],
        recommended: [],
      })
    );
    track(spyOn(skill, 'listWorkflowEnvs').mockImplementation(() => listOk.promise));
    track(
      spyOn(skill, 'previewWorkflowEnv').mockImplementation((_wf, _cwd, envId) => {
        if (envId === null || envId === undefined || envId.length === 0) {
          return previewNone.promise;
        }
        previewSelectedCalls += 1;
        return previewSelected.promise;
      })
    );
    track(
      spyOn(skill, 'startRun').mockImplementation(async (args: StartRunArgs) => {
        startCalls.push(args);
      })
    );

    await act(async () => {
      mountCard(root);
    });
    await flush();
    await expandCard(host);

    await act(async () => {
      listOk.resolve([envSummary('env-1', 'feature', 'fast')]);
      previewNone.resolve(previewOf('feature', null, null, 'baseline'));
    });
    await flush();

    expect(envSelect(host).value).toBe('');
    expect(host.textContent).toContain('fast');

    await act(async () => {
      setControlValue(envSelect(host), 'env-1');
    });
    await flush();

    // Selected ENV preview still loading — selection retained, Start disabled.
    expect(envSelect(host).value).toBe('env-1');
    expect(startButton(host).disabled).toBe(true);
    expect(host.textContent).toMatch(/Loading ENV preview/i);
    expect(startCalls).toHaveLength(0);

    // Fail the selected preview — still retain selection, still block Start.
    await act(async () => {
      previewSelected.reject(new Error('preview network down'));
    });
    await flush();

    expect(envSelect(host).value).toBe('env-1');
    expect(startButton(host).disabled).toBe(true);
    expect(host.textContent).toContain('Start is disabled');
    expect(host.textContent).toContain('preview network down');
    // Never silently reset to YAML-only.
    expect(envSelect(host).value).not.toBe('');

    // Recover: resolve a fresh selected preview via re-select after invalidate.
    const previewOk = deferred<WorkflowEnvPreview>();
    track(
      spyOn(skill, 'previewWorkflowEnv').mockImplementation((_wf, _cwd, envId) => {
        if (envId === null || envId === undefined || envId.length === 0) {
          return Promise.resolve(previewOf('feature', null, null, 'baseline'));
        }
        return previewOk.promise;
      })
    );
    await act(async () => {
      setControlValue(envSelect(host), '');
    });
    await flush();
    // Drop stale error for env-1 so the next selection loads cleanly.
    invalidate(K.workflowEnvPreview('/tmp/proj', 'feature', 'env-1'));
    await act(async () => {
      setControlValue(envSelect(host), 'env-1');
    });
    await flush();

    expect(startButton(host).disabled).toBe(true);
    await act(async () => {
      previewOk.resolve(previewOf('feature', 'env-1', 'fast', 'selected-model'));
    });
    await flush();

    expect(host.textContent).toContain('selected-model');
    expect(startButton(host).disabled).toBe(false);

    await act(async () => {
      (startButton(host) as unknown as Clickable).click();
    });
    await flush();

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.envId).toBe('env-1');
    expect(previewSelectedCalls).toBeGreaterThanOrEqual(1);
  });

  test('changing workflow resets ENV and inputs immediately; stale prior response cannot replace current', async () => {
    const listA = deferred<WorkflowEnvSummary[]>();
    const listB = deferred<WorkflowEnvSummary[]>();
    const previewA = deferred<WorkflowEnvPreview>();
    const previewB = deferred<WorkflowEnvPreview>();

    track(
      spyOn(skill, 'listWorkflows').mockResolvedValue({
        workflows: [
          workflow('wf-a', [
            {
              name: 'diff',
              required: true,
              default: null,
              description: 'diff input',
            },
          ]),
          workflow('wf-b'),
        ],
        recommended: [],
      })
    );
    track(
      spyOn(skill, 'listWorkflowEnvs').mockImplementation((wf: string) => {
        if (wf === 'wf-a') return listA.promise;
        if (wf === 'wf-b') return listB.promise;
        return Promise.resolve([]);
      })
    );
    track(
      spyOn(skill, 'previewWorkflowEnv').mockImplementation((wf, _cwd, envId) => {
        if (wf === 'wf-a') return previewA.promise;
        if (wf === 'wf-b') return previewB.promise;
        return Promise.reject(new Error(`unexpected wf ${wf} env ${String(envId)}`));
      })
    );
    track(spyOn(skill, 'startRun').mockResolvedValue(undefined));

    // Prefer wf-a as initial selection.
    try {
      win.localStorage.setItem('archon.console.lastWorkflow', 'wf-a');
    } catch {
      /* ignore */
    }

    await act(async () => {
      mountCard(root);
    });
    await flush();
    await expandCard(host);
    await flush();

    // wf-a list still pending — fill required input while waiting.
    const diffInput = host.querySelector('input[placeholder="required"]');
    if (diffInput === null) {
      throw new Error('missing required input field');
    }
    await act(async () => {
      setControlValue(diffInput, 'D1');
    });
    await flush();

    // Select ENV once list A resolves, then switch workflow before previews settle.
    await act(async () => {
      listA.resolve([envSummary('env-a', 'wf-a', 'fast-a')]);
    });
    await flush();

    await act(async () => {
      setControlValue(envSelect(host), 'env-a');
    });
    await flush();
    expect(envSelect(host).value).toBe('env-a');

    // Switch to wf-b immediately — ENV + inputs must clear before B settles.
    await pickWorkflow(win.document as unknown as Document, 'wf-b');
    await flush();

    expect(envSelect(host).value).toBe('');
    expect(host.querySelector('input[placeholder="required"]')).toBeNull();
    expect(host.textContent).not.toContain('fast-a');
    // Selection reset is synchronous with workflow change (not waiting on loaders).
    expect(host.textContent).toContain('Loading preview');

    // Current workflow settles.
    await act(async () => {
      listB.resolve([envSummary('env-b', 'wf-b', 'fast-b')]);
      previewB.resolve(previewOf('wf-b', null, null, 'b-yaml'));
    });
    await flush();

    expect(host.textContent).toContain('fast-b');
    expect(host.textContent).toContain('b-yaml');
    expect(host.textContent).not.toContain('fast-a');
    expect(envSelect(host).value).toBe('');

    // Stale wf-a responses arrive late — must land only under A's keys, not the UI.
    await act(async () => {
      previewA.resolve(previewOf('wf-a', 'env-a', 'fast-a', 'stale-a-model'));
    });
    await flush();

    expect(host.textContent).toContain('fast-b');
    expect(host.textContent).toContain('b-yaml');
    expect(host.textContent).not.toContain('fast-a');
    expect(host.textContent).not.toContain('stale-a-model');
    expect(envSelect(host).value).toBe('');

    // Cache isolation: current key holds B's preview.
    const currentKey = K.workflowEnvPreview('/tmp/proj', 'wf-b', null);
    expect(cacheGet(currentKey)).toEqual(previewOf('wf-b', null, null, 'b-yaml'));
  });
});
