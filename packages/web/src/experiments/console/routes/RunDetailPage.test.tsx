process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, createElement, Fragment, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RunDetailHeader } from '../components/RunDetailHeader';
import { WorkflowEnvResolvedTable } from '../components/WorkflowEnvResolvedTable';
import { toRun, type Run } from '../primitives/run';
import type {
  PendingInteraction,
  RunDetailResponse,
  WorkflowEvent,
  WorkflowNodeState,
} from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { invalidate } from '../store/cache';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { hasRunEnvOverlayUi, RunDetailPage } from './RunDetailPage';

/**
 * Mirrors RunDetailPage's ENV surfaces (header chip + resolved table gate)
 * without mounting the full hook-heavy page (console tests avoid mock.module).
 */
function renderRunDetailEnvSurfaces(run: Run): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        Fragment,
        null,
        createElement(RunDetailHeader, {
          run,
          projectId: 'proj-1',
          projectName: 'demo',
          usage: null,
        }),
        hasRunEnvOverlayUi(run)
          ? createElement(WorkflowEnvResolvedTable, { overlay: run.envOverlay })
          : null,
        // Stand-in for the rest of the log column (started line / stream).
        createElement(
          'div',
          { 'data-testid': 'run-detail-rest' },
          `workflow:${run.workflow} status:${run.status} msg:${run.userMessage}`
        )
      )
    )
  );
}

function rawRun(metadata: Record<string, unknown> | undefined): Run {
  return toRun({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    workflow_name: 'archon-dev',
    status: 'completed',
    codebase_id: 'proj-1',
    started_at: '2026-09-04T10:00:00Z',
    completed_at: '2026-09-04T10:05:00Z',
    user_message: 'ship it',
    platform_type: 'cli',
    metadata,
  });
}

describe('RunDetailPage ENV surfaces', () => {
  test('malformed envOverlay metadata omits chip and table; rest of detail still renders', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        // missing patches + non-array skipped + corrupt resolved → hybrid
        skippedNodeIds: 'not-array',
        resolved: 'not-object',
      },
      total_cost_usd: 1.25,
    });

    expect(run.envOverlay).toBeNull();
    expect(hasRunEnvOverlayUi(run)).toBe(false);

    const html = renderRunDetailEnvSurfaces(run);
    expect(html).not.toContain('run-env-chip');
    expect(html).not.toContain('workflow-env-resolved-table');
    expect(html).not.toContain('No provider-turn request rows');
    expect(html).not.toContain('env: fast');
    // Non-ENV run detail content remains.
    expect(html).toContain('archon-dev');
    expect(html).toContain('ship it');
    expect(html).toContain('data-testid="run-detail-rest"');
    expect(html).toContain('workflow:archon-dev');
  });

  test('valid complete overlay still shows chip + resolved table via the same gate', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        patches: {},
        skippedNodeIds: [],
        latestMissingNodeIds: [],
        resolved: {
          plan: { provider: 'claude', model: 'sonnet' },
        },
      },
    });

    expect(hasRunEnvOverlayUi(run)).toBe(true);
    const html = renderRunDetailEnvSurfaces(run);
    expect(html).toContain('run-env-chip');
    expect(html).toContain('env: fast');
    expect(html).toContain('workflow-env-resolved-table');
    expect(html).toContain('sonnet');
    expect(html).toContain('data-testid="run-detail-rest"');
  });

  test('corrupt frozen patch metadata hides only ENV surfaces and never leaks bodies', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        // Valid-looking identity + lifecycle keys, corrupt per-node patch shape.
        patches: { plan: { prompt: 42, typo: 'SECRET_PATCH_BODY' } },
        skippedNodeIds: [],
        latestMissingNodeIds: [],
        resolved: {
          plan: { provider: 'claude', model: 'sonnet' },
        },
      },
      total_cost_usd: 0.5,
    });

    expect(run.envOverlay).toBeNull();
    expect(hasRunEnvOverlayUi(run)).toBe(false);

    const html = renderRunDetailEnvSurfaces(run);
    expect(html).not.toContain('run-env-chip');
    expect(html).not.toContain('workflow-env-resolved-table');
    expect(html).not.toContain('env: fast');
    expect(html).not.toContain('sonnet');
    expect(html).not.toContain('SECRET_PATCH_BODY');
    expect(html).not.toContain('typo');
    // Rest of run detail remains usable.
    expect(html).toContain('archon-dev');
    expect(html).toContain('ship it');
    expect(html).toContain('data-testid="run-detail-rest"');
    expect(html).toContain('workflow:archon-dev status:completed');
  });
});

type FetchSpy = ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

const CREATED_AT = '2026-09-07T10:00:00.000Z';
const REVIEW_TEXT = 'review-transcript';
const BUILD_TEXT = 'build-transcript';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  }
  return raw;
}

function workflowEvent(overrides: {
  id: string;
  workflow_run_id: string;
  event_type: string;
  step_name: string;
  created_at?: string;
  data?: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: overrides.id,
    workflow_run_id: overrides.workflow_run_id,
    event_type: overrides.event_type,
    step_index: null,
    step_name: overrides.step_name,
    data: overrides.data ?? {},
    created_at: overrides.created_at ?? CREATED_AT,
  };
}

function nodeState(
  overrides: Pick<WorkflowNodeState, 'nodeId' | 'name' | 'status'>
): WorkflowNodeState {
  return { retryEpoch: 0, ...overrides };
}

function SearchProbe(): ReactElement {
  const location = useLocation();
  return createElement('span', { 'data-testid': 'location-search' }, location.search);
}

describe('RunDetailPage inspect selection', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;
  let fetchSpy: FetchSpy | undefined;
  let seq = 0;
  let projectId = '';
  let runId = '';
  let cwd = '';
  let workflow = '';
  let answerPosts: { path: string; body: unknown }[] = [];

  beforeEach(() => {
    seq += 1;
    projectId = `proj-us010-${String(seq)}`;
    runId = `run-us010-${String(seq)}`;
    cwd = `/repo us010 ${String(seq)}`;
    workflow = `inspect-us010-${String(seq)}`;
    answerPosts = [];
    win = installHappyDom();
    win.localStorage.clear();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    invalidate('project');
    invalidate('run');
    invalidate('artifacts');
    invalidate('workflow-dag-nodes');
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
    invalidate('health');
    invalidate('messages');
    invalidate('noop:no-conversation-id');
    invalidate('noop:no-project-id');
    invalidate('noop:no-run-id');
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    win.localStorage.clear();
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushUntil(label: string, predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await flush();
      if (predicate()) return;
    }
    throw new Error(`${label}: ${host.textContent ?? ''}`);
  }

  function requireHtmlElement(value: Element | null, label: string): HTMLElement {
    if (!(value instanceof HTMLElement)) {
      throw new Error(label);
    }
    return value;
  }

  function requireButton(value: Element | null, label: string): HTMLButtonElement {
    if (!(value instanceof HTMLButtonElement)) {
      throw new Error(label);
    }
    return value;
  }

  function requireSelect(value: Element | null, label: string): HTMLSelectElement {
    if (!(value instanceof HTMLSelectElement)) {
      throw new Error(label);
    }
    return value;
  }

  function tabButton(label: string): HTMLButtonElement {
    const buttons = [...host.querySelectorAll('button')];
    const found = buttons.find(button => (button.textContent ?? '').includes(label));
    if (found === undefined || !(found instanceof HTMLButtonElement)) {
      throw new Error(`missing tab ${label}`);
    }
    return found;
  }

  function locationSearch(): string {
    return host.querySelector('[data-testid="location-search"]')?.textContent ?? '';
  }

  function runPayload(
    status: RunDetailResponse['run']['status'],
    metadata: Record<string, unknown> = {}
  ): RunDetailResponse['run'] {
    return {
      id: runId,
      workflow_name: workflow,
      conversation_id: 'c1',
      parent_conversation_id: null,
      codebase_id: projectId,
      status,
      user_message: 'inspect this run',
      metadata,
      started_at: CREATED_AT,
      completed_at: status === 'running' || status === 'paused' ? null : '2026-09-07T10:02:00.000Z',
      last_activity_at: CREATED_AT,
      working_path: cwd,
      user_id: null,
      parent_run_id: null,
      output_root: null,
      conversation_platform_id: null,
    };
  }

  function eventsFor(id: string): WorkflowEvent[] {
    return [
      workflowEvent({
        id: 'review-start',
        workflow_run_id: id,
        event_type: 'node_started',
        step_name: 'review',
        created_at: '2026-09-07T10:00:01.000Z',
        data: { name: 'Review' },
      }),
      workflowEvent({
        id: 'review-done',
        workflow_run_id: id,
        event_type: 'node_completed',
        step_name: 'review',
        created_at: '2026-09-07T10:00:02.000Z',
        data: { name: 'Review', duration_ms: 1000, num_turns: 1, stop_reason: 'end_turn' },
      }),
      workflowEvent({
        id: 'build-start',
        workflow_run_id: id,
        event_type: 'node_started',
        step_name: 'build',
        created_at: '2026-09-07T10:00:03.000Z',
        data: { name: 'Build' },
      }),
    ];
  }

  const NODE_STATES: WorkflowNodeState[] = [
    nodeState({ nodeId: 'review', name: 'Review', status: 'completed' }),
    nodeState({ nodeId: 'build', name: 'Build', status: 'running' }),
  ];

  function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
    return {
      id: 'ask-1',
      workflow_run_id: runId,
      node_id: 'review',
      tool_use_id: 'tool-1',
      kind: 'ask',
      status: 'pending',
      envelope: {
        questions: [
          {
            id: 'q1',
            prompt: 'Ship it?',
            selection: 'single',
            options: ['Ship', 'Hold'],
            allowOther: false,
          },
        ],
      },
      answer: null,
      provider_session_id: 'session-1',
      created_at: CREATED_AT,
      resolved_at: null,
      resolved_by: null,
      ...overrides,
    };
  }

  function stubPageFetch(
    options: {
      status?: RunDetailResponse['run']['status'];
      runError?: boolean;
      metadata?: Record<string, unknown>;
      nodeStates?: WorkflowNodeState[];
      events?: WorkflowEvent[];
      workflowNodes?: DagNode[];
      pendingInteractions?: PendingInteraction[];
      viewerIsStarter?: boolean;
      starterDisplayName?: string | null;
    } = {}
  ): void {
    const detailStatus = options.status ?? 'running';
    const cwdQuery = `/api/workflows?cwd=${encodeURIComponent(cwd)}`;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = requestPath(input);
      if (path === `/api/codebases/${encodeURIComponent(projectId)}`) {
        return Promise.resolve(
          jsonResponse({
            id: projectId,
            name: 'inspect-project',
            default_cwd: cwd,
            default_branch: 'main',
            repository_url: null,
            kind: 'repo',
            updated_at: CREATED_AT,
            created_at: CREATED_AT,
          })
        );
      }
      if (path === `/api/workflows/runs/${encodeURIComponent(runId)}`) {
        if (options.runError === true) {
          return Promise.resolve(jsonResponse({ error: 'missing run' }, 404));
        }
        return Promise.resolve(
          jsonResponse({
            run: runPayload(detailStatus, options.metadata),
            events: options.events ?? eventsFor(runId),
            nodeStates: options.nodeStates ?? NODE_STATES,
            pending_interactions: options.pendingInteractions ?? [],
            usage: null,
            viewer_is_starter: options.viewerIsStarter ?? false,
            starter_display_name: options.starterDisplayName ?? null,
          } satisfies RunDetailResponse)
        );
      }
      if (path === `/api/runs/${encodeURIComponent(runId)}/artifacts`) {
        return Promise.resolve(jsonResponse({ files: [] }));
      }
      if (path === cwdQuery) {
        return Promise.resolve(
          jsonResponse({
            workflows: [
              {
                workflow: {
                  name: workflow,
                  description: 'inspect',
                  nodes: options.workflowNodes ?? [
                    { id: 'review', prompt: 'Review the change.' },
                    { id: 'build', prompt: 'Build the change.', depends_on: ['review'] },
                  ],
                },
                source: 'project',
              },
            ],
            recommended: [],
          })
        );
      }
      if (
        path ===
        `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent('review')}/messages`
      ) {
        return Promise.resolve(
          jsonResponse({
            messages: [
              {
                id: 'm-review',
                seq: 1,
                kind: 'text',
                payload: { text: REVIEW_TEXT },
                created_at: CREATED_AT,
              },
            ],
          })
        );
      }
      if (
        path ===
        `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent('build')}/messages`
      ) {
        return Promise.resolve(
          jsonResponse({
            messages: [
              {
                id: 'm-build',
                seq: 1,
                kind: 'text',
                payload: { text: BUILD_TEXT },
                created_at: CREATED_AT,
              },
            ],
          })
        );
      }
      if (path === '/api/health') {
        return Promise.resolve(jsonResponse({ ok: true, is_docker: true }));
      }
      if (
        path.startsWith(`/api/workflows/runs/${encodeURIComponent(runId)}/ask/`) &&
        path.endsWith('/answer')
      ) {
        if (init?.method !== 'POST') throw new Error('Ask answer must use POST');
        if (new Headers(init.headers).get('Content-Type') !== 'application/json') {
          throw new Error('Ask answer must use JSON');
        }
        if (typeof init.body !== 'string') throw new Error('Ask answer body must be JSON text');
        answerPosts.push({ path, body: JSON.parse(init.body) as unknown });
        return Promise.resolve(jsonResponse({ success: true, message: 'ok' }));
      }
      return Promise.resolve(jsonResponse({ error: `unmocked ${path}` }, 404));
    }) as typeof fetch);
  }

  function renderPage(search = ''): void {
    const suffix = search === '' || search.startsWith('?') ? search : `?${search}`;
    root.render(
      createElement(
        MemoryRouter,
        {
          initialEntries: [`/console/p/${projectId}/r/${runId}${suffix}`],
        },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/console/p/:projectId/r/:runId',
            element: createElement(
              Fragment,
              null,
              createElement(SearchProbe),
              createElement(RunDetailPage)
            ),
          })
        )
      )
    );
  }

  test('?node=review deep-links into the review room after detail and definition resolve', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?keep=1&node=review');
    });
    await flushUntil('review room', () => (host.textContent ?? '').includes(REVIEW_TEXT));
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="console-inspect-pane"]')).not.toBeNull();
    expect(host.textContent).toContain('Workflow');
    expect(host.textContent).toContain('inspect this run');
    expect(locationSearch()).toContain('node=review');
    expect(locationSearch()).toContain('keep=1');
  });

  test('paused Plannotator detail forwards raw approval review metadata to the room', async () => {
    stubPageFetch({
      status: 'paused',
      metadata: {
        approval: {
          nodeId: 'review',
          message: 'Review the generated plan',
          type: 'plannotator_gate',
          document: 'Review session document',
          reviewUrl: 'https://plannotator.example/review',
        },
      },
      nodeStates: [nodeState({ nodeId: 'review', name: 'Review', status: 'running' })],
      workflowNodes: [
        {
          id: 'review',
          plannotator_gate: {
            message: 'Review plan in Plannotator',
            document: 'plan.md',
            rework: { prompt: 'Apply review feedback.' },
          },
        },
      ],
    });
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('plannotator link', () =>
      (host.textContent ?? '').includes('Open Plannotator')
    );

    expect(host.textContent).toContain('Review plan in Plannotator');
    expect(host.textContent).toContain('Review session document');
    expect(host.querySelector('a[href="https://plannotator.example/review"]')).not.toBeNull();
    expect(host.textContent).not.toContain(REVIEW_TEXT);
    expect(host.textContent).toContain('Waiting for approval');
    expect(host.textContent).not.toContain('Awaiting input (');
  });

  test('an invalid ?node= query falls back to the inspect-running node', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?node=ghost');
    });
    await flushUntil('build fallback', () => (host.textContent ?? '').includes(BUILD_TEXT));
    expect(host.querySelector('[aria-label="build room"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="review room"]')).toBeNull();
  });

  test('switching Log to Graph retains the mounted room and selecting a graph node updates ?node=', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('review room', () => (host.textContent ?? '').includes(REVIEW_TEXT));
    const roomBefore = host.querySelector('[aria-label="review room"]');
    expect(roomBefore).not.toBeNull();

    await act(async () => {
      tabButton('Graph').click();
    });
    await flushUntil(
      'graph scroller',
      () => host.querySelector('[data-testid="console-run-graph-scroller"]') !== null
    );
    expect(host.querySelector('[aria-label="review room"]')).toBe(roomBefore);
    expect(host.querySelector('[data-testid="console-inspect-pane"]')).not.toBeNull();
    expect(host.textContent).toContain(REVIEW_TEXT);

    await act(async () => {
      requireButton(host.querySelector('[data-node-id="build"]'), 'build card').click();
    });
    await flushUntil('build selected', () => (host.textContent ?? '').includes(BUILD_TEXT));
    expect(locationSearch()).toBe('?node=build');
    expect(host.querySelector('[aria-label="build room"]')).not.toBeNull();
  });

  test('closing the room removes only the node query parameter', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?keep=1&node=review');
    });
    await flushUntil('review room', () => (host.textContent ?? '').includes(REVIEW_TEXT));

    await act(async () => {
      requireButton(
        host.querySelector('[data-testid="console-inspect-room"] header button'),
        'close room'
      ).click();
    });
    await flushUntil('room closed', () => (host.textContent ?? '').includes('Select a node'));
    expect(host.querySelector('[aria-label="review room"]')).toBeNull();
    expect(locationSearch()).toBe('?keep=1');
    expect(locationSearch()).not.toContain('node=');
  });

  test('StreamToolbar All nodes filtering does not close or change the selected room', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('review room', () => (host.textContent ?? '').includes(REVIEW_TEXT));
    const roomBefore = host.querySelector('[aria-label="review room"]');
    expect(host.querySelector('#node-transition-review-start')).not.toBeNull();
    expect(host.querySelector('#node-transition-build-start')).not.toBeNull();

    const filter = requireSelect(
      host.querySelector('[aria-label="Filter stream by node"]'),
      'node filter'
    );
    expect([...filter.options].some(option => option.textContent === 'All nodes')).toBe(true);

    await act(async () => {
      filter.value = 'review';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushUntil(
      'filtered to review',
      () => host.querySelector('#node-transition-build-start') === null
    );
    expect(host.querySelector('#node-transition-review-start')).not.toBeNull();
    expect(host.querySelector('[aria-label="review room"]')).toBe(roomBefore);
    expect(host.textContent).toContain(REVIEW_TEXT);
    expect(filter.value).toBe('review');

    await act(async () => {
      filter.value = 'all';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushUntil(
      'all nodes restored',
      () => host.querySelector('#node-transition-build-start') !== null
    );
    expect(host.querySelector('[aria-label="review room"]')).toBe(roomBefore);
  });

  test('Artifacts stays full width and returning to Log restores the selected room', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('review room', () => (host.textContent ?? '').includes(REVIEW_TEXT));

    await act(async () => {
      tabButton('Artifacts').click();
    });
    await flushUntil('artifacts view', () =>
      (host.textContent ?? '').includes('No artifacts written to disk for this run.')
    );
    expect(host.querySelector('[data-testid="console-inspect-pane"]')).toBeNull();
    expect(host.querySelector('[aria-label="review room"]')).toBeNull();
    expect(host.querySelector('[data-testid="console-run-graph-scroller"]')).toBeNull();

    await act(async () => {
      tabButton('Log').click();
    });
    await flushUntil('log restored', () => (host.textContent ?? '').includes(REVIEW_TEXT));
    expect(host.querySelector('[data-testid="console-inspect-pane"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="review room"]')).not.toBeNull();
    expect(locationSearch()).toContain('node=review');
  });

  test('a missing run shows the load error without mounting the inspect pane', async () => {
    stubPageFetch({ runError: true });
    await act(async () => {
      renderPage();
    });
    await flushUntil('run error', () => (host.textContent ?? '').includes('Could not load run.'));
    expect(host.querySelector('[data-testid="console-inspect-pane"]')).toBeNull();
  });

  test('running runs expose Cancel and completed runs expose Re-run', async () => {
    stubPageFetch({ status: 'running' });
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('running cancel', () => (host.textContent ?? '').includes('Cancel'));
    expect(host.textContent).not.toContain('Re-run');

    await act(async () => {
      root.unmount();
    });
    invalidate('project');
    invalidate('run');
    invalidate('artifacts');
    invalidate('workflow-dag-nodes');
    invalidate('run-node-messages');
    invalidate('console-node-room:idle');
    seq += 1;
    projectId = `proj-us010-${String(seq)}`;
    runId = `run-us010-${String(seq)}`;
    cwd = `/repo us010 ${String(seq)}`;
    workflow = `inspect-us010-${String(seq)}`;
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
    fetchSpy?.mockRestore();
    stubPageFetch({ status: 'completed' });
    await act(async () => {
      renderPage('?node=review');
    });
    await flushUntil('completed rerun', () => (host.textContent ?? '').includes('Re-run'));
    expect(host.textContent).not.toContain('Cancel');
  });

  test('a log-row click stores the node query without changing the All nodes filter', async () => {
    stubPageFetch();
    await act(async () => {
      renderPage();
    });
    await flushUntil('build fallback', () => (host.textContent ?? '').includes(BUILD_TEXT));
    const filter = requireSelect(
      host.querySelector('[aria-label="Filter stream by node"]'),
      'node filter'
    );
    expect(filter.value).toBe('all');

    const reviewRow = requireHtmlElement(
      host.querySelector('#node-transition-review-start'),
      'review row'
    );
    await act(async () => {
      requireButton(reviewRow.querySelector('button'), 'review identity').click();
    });
    await flushUntil('review selected', () => (host.textContent ?? '').includes(REVIEW_TEXT));
    expect(locationSearch()).toBe('?node=review');
    expect(filter.value).toBe('all');
    expect(host.querySelector('#node-transition-build-start')).not.toBeNull();
  });

  test('jumps to an awaiting room, answers through the skill, and keeps gate keys inactive', async () => {
    const pending = ask();
    stubPageFetch({
      status: 'paused',
      nodeStates: [
        nodeState({ nodeId: 'review', name: 'Review', status: 'awaiting' }),
        nodeState({ nodeId: 'build', name: 'Build', status: 'running' }),
      ],
      pendingInteractions: [pending],
      viewerIsStarter: true,
      starterDisplayName: 'Avery',
    });
    await act(async () => {
      renderPage('?node=build');
    });
    await flushUntil('awaiting chrome', () =>
      (host.textContent ?? '').includes('Awaiting input (1)')
    );

    await act(async () => {
      tabButton('Awaiting input (1)').click();
    });
    await flushUntil(
      'review Ask room',
      () =>
        host.querySelector('[data-testid="console-run-graph-scroller"]') !== null &&
        host.querySelector('[aria-label="review room"] form') !== null
    );
    expect(locationSearch()).toContain('node=review');

    const choice = host.querySelector('input[type="radio"][value="Ship"]');
    if (!(choice instanceof HTMLInputElement)) throw new Error('missing Ship choice');
    await act(async () => {
      choice.click();
    });
    const submit = [...host.querySelectorAll('button')].find(
      button => (button.textContent ?? '').trim() === 'Submit'
    );
    if (!(submit instanceof HTMLButtonElement)) throw new Error('missing Submit');
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
    });
    await flushUntil('accepted answer', () =>
      (host.textContent ?? '').includes('Answered · by you')
    );
    expect(answerPosts).toEqual([
      {
        path: `/api/workflows/runs/${encodeURIComponent(runId)}/ask/tool-1/answer`,
        body: { answers: [{ questionId: 'q1', value: 'Ship' }] },
      },
    ]);

    document.body.focus();
    const approveKey = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    const rejectKey = new KeyboardEvent('keydown', { key: 'r', cancelable: true });
    window.dispatchEvent(approveKey);
    window.dispatchEvent(rejectKey);
    expect(approveKey.defaultPrevented).toBe(false);
    expect(rejectKey.defaultPrevented).toBe(false);
    expect(host.textContent).not.toContain('Reply…');
  });

  test('renders CAP-7 failure as error chrome without an awaiting pill', async () => {
    const message = 'AskHuman is not supported by provider: grok';
    stubPageFetch({ status: 'failed', metadata: { error: message } });
    await act(async () => {
      renderPage();
    });
    await flushUntil('CAP-7 banner', () => (host.textContent ?? '').includes(message));
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.className).toContain('text-error');
    expect(host.textContent).not.toContain('Awaiting input (');
  });
});
