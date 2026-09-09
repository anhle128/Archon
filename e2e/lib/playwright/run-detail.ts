import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';

import { E2E_STARTER_WEB_USER, E2E_TEAMMATE_WEB_USER, HITL_ASK_NODE } from './archon-runtime';

export type IdentityKind = 'starter' | 'teammate' | 'none';

/**
 * Open a run's detail page (`/console/p/:projectId/r/:runId`).
 *
 * The route needs the run's project (codebase) id. That id is data the run
 * itself produced, so we read it back from the REAL run-detail API rather than
 * threading it through the CLI envelope or mocking it — same principle the whole
 * suite follows: the app's own API/DB stay real, only the AI provider is faked.
 */
export async function openRunDetail(
  page: Page,
  runId: string,
  nodeId?: string
): Promise<{ projectId: string }> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const detail = (await res.json()) as { run?: { codebase_id?: string | null } };
  const projectId = detail.run?.codebase_id;
  expect(projectId, `run ${runId} has a project (codebase) id`).toBeTruthy();
  const nodeQuery = nodeId ? `?node=${encodeURIComponent(nodeId)}` : '';
  await page.goto(`/console/p/${projectId ?? ''}/r/${runId}${nodeQuery}`);
  return { projectId: projectId ?? '' };
}

export async function openLegacyRunDetail(page: Page, runId: string): Promise<void> {
  await page.goto(`/legacy/workflows/runs/${encodeURIComponent(runId)}`);
}

export async function openNodeRoom(page: Page, nodeId: string): Promise<void> {
  const divider = page.locator(`#node-transition-${nodeId}`);
  await expect(divider).toBeVisible();
  await divider.getByRole('button', { name: new RegExp(nodeId) }).click();
}

export async function listNodeMessages(
  page: Page,
  runId: string,
  nodeId: string
): Promise<{ kind: string; payload: Record<string, unknown> }[]> {
  const res = await page.request.get(
    `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/messages`
  );
  expect(res.ok(), `node messages for ${nodeId} responded ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    messages?: { kind: string; payload: Record<string, unknown> }[];
  };
  return body.messages ?? [];
}

export interface NodeMessageRequest {
  afterSeq: string | null;
  limit: string | null;
  occurrenceId: string | null;
  attemptId: string | null;
}

export function observeNodeMessagePages(
  page: Page,
  runId: string,
  nodeId: string
): { records: NodeMessageRequest[]; dispose: () => void } {
  const records: NodeMessageRequest[] = [];
  const pathname =
    '/api/workflows/runs/' +
    encodeURIComponent(runId) +
    '/nodes/' +
    encodeURIComponent(nodeId) +
    '/messages';
  const listener = (request: Request): void => {
    const url = new URL(request.url());
    if (url.pathname !== pathname) return;
    records.push({
      afterSeq: url.searchParams.get('afterSeq'),
      limit: url.searchParams.get('limit'),
      occurrenceId: url.searchParams.get('occurrenceId'),
      attemptId: url.searchParams.get('attemptId'),
    });
  };
  page.on('request', listener);
  return {
    records,
    dispose: (): void => {
      page.off('request', listener);
    },
  };
}

export async function getRunDetail(
  page: Page,
  runId: string
): Promise<{
  status?: string;
  user_id?: string | null;
  parent_platform_id?: string;
  pending_interactions: {
    tool_use_id: string;
    status: string;
    node_id: string;
    answer?: unknown;
  }[];
  nodeExecutions: {
    node_id: string;
    occurrence_id?: string;
    attempt_id?: string;
    loop_ancestry?: { node_id: string; iteration: number }[];
  }[];
  events: {
    event_type: string;
    step_name: string | null;
    data: Record<string, unknown>;
  }[];
}> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    run?: {
      status?: string;
      user_id?: string | null;
      parent_platform_id?: string;
    };
    pending_interactions?: {
      tool_use_id: string;
      status: string;
      node_id: string;
      answer?: unknown;
    }[];
    nodeExecutions?: {
      node_id: string;
      occurrence_id?: string;
      attempt_id?: string;
      loop_ancestry?: { node_id: string; iteration: number }[];
    }[];
    events?: {
      event_type: string;
      step_name: string | null;
      data: Record<string, unknown>;
    }[];
  };
  return {
    status: body.run?.status,
    user_id: body.run?.user_id,
    parent_platform_id: body.run?.parent_platform_id,
    pending_interactions: body.pending_interactions ?? [],
    nodeExecutions: body.nodeExecutions ?? [],
    events: body.events ?? [],
  };
}

export async function createIdentityContext(
  browser: Browser,
  baseURL: string,
  kind: IdentityKind
): Promise<BrowserContext> {
  if (kind === 'none') {
    return browser.newContext({ baseURL });
  }
  const header = kind === 'starter' ? E2E_STARTER_WEB_USER : E2E_TEAMMATE_WEB_USER;
  return browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'X-Archon-User': header },
  });
}

export async function submitAskYes(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Awaiting input', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'yes' }).first().check();
  await page.getByRole('button', { name: 'Submit' }).first().click();
}

export async function postConversationMessage(
  page: Page,
  conversationId: string,
  message: string
): Promise<number> {
  const res = await page.request.post(
    `/api/conversations/${encodeURIComponent(conversationId)}/message`,
    { data: { message } }
  );
  return res.status();
}

export async function answerAskViaApi(
  page: Page,
  runId: string,
  requestId: string
): Promise<number> {
  const res = await page.request.post(
    `/api/workflows/runs/${encodeURIComponent(runId)}/ask/${encodeURIComponent(requestId)}/answer`,
    {
      data: { answers: [{ questionId: 'proceed', value: 'yes' }] },
    }
  );
  return res.status();
}

export { HITL_ASK_NODE };
