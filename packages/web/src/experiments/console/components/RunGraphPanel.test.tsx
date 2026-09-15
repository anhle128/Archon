process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Root } from 'react-dom/client';

import type { WorkflowNodeState } from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { roomOpenerId } from '@/lib/execution-room-model';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { buildRunGraphInput } from './graph/build-run-graph-input';
import { fitGraphScale, graphBounds } from './graph/graph-viewport';

const react = await import('react');
const reactDomClient = await import('react-dom/client');
const runGraphPanel = await import('./RunGraphPanel');

const act = react.act;
const createElement = react.createElement;
const createRoot = reactDomClient.createRoot;

function nodeState(
  nodeId: string,
  status: WorkflowNodeState['status'],
  name = nodeId
): WorkflowNodeState {
  return { nodeId, name, status, retryEpoch: 0 };
}

function routeLoopDagNodes(): DagNode[] {
  return [
    { id: 'fix', prompt: 'Revise the implementation.' },
    { id: 'review', depends_on: ['fix'], prompt: 'Review the implementation.' },
    {
      id: 'review_router',
      depends_on: ['review'],
      route_loop: {
        condition: "$review.output.status == 'approved'",
        max_iterations: 3,
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalate',
        },
      },
    },
    { id: 'done', bash: "echo 'approved'" },
    { id: 'escalate', bash: "echo 'review exhausted'" },
  ];
}

function routeLoopStates(): WorkflowNodeState[] {
  return [
    nodeState('fix', 'completed', 'Fix'),
    nodeState('review', 'completed', 'Review'),
    nodeState('review_router', 'running', 'Review router'),
    nodeState('done', 'pending', 'Done'),
    nodeState('escalate', 'skipped', 'Escalate'),
  ];
}

function stubScrollerSize(scroller: HTMLElement, width: number, height: number): void {
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: width * 2 });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: height * 2 });
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

describe('RunGraphPanel', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function renderPanel(
    overrides: Partial<Parameters<typeof runGraphPanel.RunGraphPanel>[0]> = {}
  ): void {
    root.render(
      createElement(runGraphPanel.RunGraphPanel, {
        nodes: routeLoopDagNodes(),
        nodeStates: routeLoopStates(),
        selectedNodeId: 'review',
        definitionPending: false,
        definitionError: null,
        onSelectNode: (): void => undefined,
        ...overrides,
      })
    );
  }

  test('renders nodes, route labels, dashed back-edges, arrows, and selection', async () => {
    await act(async () => {
      renderPanel();
    });
    await flush();

    const text = host.textContent ?? '';
    expect(text).toContain('fix');
    expect(text).toContain('review');
    expect(text).toContain('review_router');
    expect(text).toContain('done');
    expect(text).toContain('escalate');
    expect(text).toContain('Fix');
    expect(text).toContain('Review router');
    expect(text).toContain('positive');
    expect(text).toContain('negative');
    expect(text).toContain('exhausted');
    expect(text).toContain('running');
    expect(text).toContain('completed');
    expect(text).not.toContain('awaiting');

    const selected = host.querySelector('[data-node-id="review"]');
    expect(selected?.getAttribute('aria-current')).toBe('true');
    const unselected = host.querySelector('[data-node-id="fix"]');
    expect(unselected?.getAttribute('aria-current')).toBeNull();

    const back = host.querySelector('[data-edge-id="review_router->fix"]');
    expect(back).not.toBeNull();
    expect(back?.getAttribute('stroke-dasharray')).toBe('5 5');
    expect(back?.getAttribute('marker-end')).toContain('url(#');

    const taken = host.querySelector('[data-edge-id="fix->review"]');
    const untaken = host.querySelector('[data-edge-id="review_router->done"]');
    expect(taken?.getAttribute('stroke')).not.toBe(untaken?.getAttribute('stroke'));
    expect(host.querySelector('marker')).not.toBeNull();
  });

  test('focusable node buttons use console graph opener ids', async () => {
    await act(async () => {
      renderPanel();
    });
    await flush();

    const review = host.querySelector('[data-node-id="review"]');
    const fix = host.querySelector('[data-node-id="fix"]');
    expect(review?.id).toBe(roomOpenerId('console', 'graph', 'review'));
    expect(fix?.id).toBe(roomOpenerId('console', 'graph', 'fix'));
  });

  test('clicking a node calls onSelectNode without changing view', async () => {
    const selected: string[] = [];
    const view: 'log' | 'graph' = 'graph';
    await act(async () => {
      renderPanel({
        onSelectNode: (nodeId: string): void => {
          selected.push(nodeId);
        },
      });
    });
    await flush();

    const card = host.querySelector('[data-node-id="done"]');
    expect(card).not.toBeNull();
    await act(async () => {
      requireButton(card, 'done card').click();
    });

    expect(selected).toEqual(['done']);
    expect(view).toBe('graph');
    expect(host.querySelector('[data-testid="console-run-graph-scroller"]')).not.toBeNull();
  });

  test('zoom, pan, and fit controls update the canvas transform', async () => {
    const model = buildRunGraphInput(routeLoopDagNodes(), routeLoopStates());
    const bounds = graphBounds(model.positions);

    await act(async () => {
      renderPanel();
    });
    await flush();

    const scroller = requireHtmlElement(
      host.querySelector('[data-testid="console-run-graph-scroller"]'),
      'scroller'
    );
    expect(scroller.className).toContain('overflow-auto');
    stubScrollerSize(scroller, 200, 200);

    const canvas = (): HTMLElement =>
      requireHtmlElement(host.querySelector('[data-testid="console-run-graph-canvas"]'), 'canvas');

    expect(canvas().style.transform).toContain('translate(64px, 64px)');
    expect(canvas().style.transform).toContain('scale(1)');

    await act(async () => {
      requireButton(host.querySelector('[aria-label="Zoom in"]'), 'zoom in').click();
    });
    expect(canvas().style.transform).toContain('scale(1.1)');

    await act(async () => {
      requireButton(host.querySelector('[aria-label="Zoom out"]'), 'zoom out').click();
    });
    expect(canvas().style.transform).toContain('scale(1)');

    for (let i = 0; i < 12; i += 1) {
      await act(async () => {
        requireButton(host.querySelector('[aria-label="Zoom out"]'), 'zoom out').click();
      });
    }
    expect(canvas().style.transform).toContain('scale(0.25)');

    await act(async () => {
      renderPanel();
    });
    await flush();
    stubScrollerSize(
      requireHtmlElement(
        host.querySelector('[data-testid="console-run-graph-scroller"]'),
        'scroller'
      ),
      200,
      200
    );
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        requireButton(host.querySelector('[aria-label="Zoom in"]'), 'zoom in').click();
      });
    }
    expect(canvas().style.transform).toContain('scale(1.5)');

    const expectedFit = fitGraphScale(200, 200, bounds);
    await act(async () => {
      requireButton(host.querySelector('[aria-label="Fit"]'), 'fit').click();
    });
    await flush();
    expect(canvas().style.transform).toContain(`scale(${String(expectedFit)})`);
  });

  test('definition error and empty definition have distinct visible messages', async () => {
    await act(async () => {
      renderPanel({
        nodes: [],
        nodeStates: [],
        definitionError: 'Workflow not found: missing',
      });
    });
    await flush();
    const errorText = host.textContent ?? '';
    expect(errorText).toContain('Could not load graph: Workflow not found: missing');
    expect(host.querySelector('[data-testid="console-run-graph-canvas"]')).toBeNull();

    await act(async () => {
      renderPanel({
        nodes: [],
        nodeStates: [],
        definitionError: null,
        definitionPending: false,
      });
    });
    await flush();
    const emptyText = host.textContent ?? '';
    expect(emptyText).toContain('No workflow nodes to display.');
    expect(emptyText).not.toContain('Could not load graph:');
    expect(emptyText).not.toContain('Loading graph');

    await act(async () => {
      renderPanel({
        nodes: [],
        nodeStates: [],
        definitionPending: true,
        definitionError: null,
      });
    });
    await flush();
    const pendingText = host.textContent ?? '';
    expect(pendingText).toContain('Loading graph');
    expect(pendingText).not.toContain('Could not load graph:');
    expect(pendingText).not.toContain('No workflow nodes to display.');
  });

  test('renders awaiting review card with warning waiting-on-you chrome', async () => {
    await act(async () => {
      renderPanel({
        nodeStates: [
          nodeState('fix', 'completed', 'Fix'),
          nodeState('review', 'awaiting', 'Review'),
          nodeState('review_router', 'pending', 'Review router'),
          nodeState('done', 'pending', 'Done'),
          nodeState('escalate', 'skipped', 'Escalate'),
        ],
      });
    });
    await flush();

    const waitingCard = host.querySelector('[data-node-id="review"]');
    expect(waitingCard?.textContent).toContain('waiting on you');
    expect(waitingCard?.getAttribute('title')).toContain('waiting on you');
    expect(waitingCard?.className).toContain('animate-[pulse_2.4s_ease-in-out_infinite]');
    expect(waitingCard?.className).toContain('motion-reduce:animate-none');
    expect(waitingCard?.querySelector('span[aria-hidden]')?.className).toContain('text-warning');
  });
});
