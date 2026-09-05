import { expect, type Page } from '@playwright/test';

/**
 * Open a run's detail page (`/console/p/:projectId/r/:runId`).
 *
 * The route needs the run's project (codebase) id. That id is data the run
 * itself produced, so we read it back from the REAL run-detail API rather than
 * threading it through the CLI envelope or mocking it — same principle the whole
 * suite follows: the app's own API/DB stay real, only the AI provider is faked.
 */
export async function openRunDetail(page: Page, runId: string): Promise<void> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const detail = (await res.json()) as { run?: { codebase_id?: string | null } };
  const projectId = detail.run?.codebase_id;
  // A --folder run registers a folder project, so its run carries a codebase id;
  // without one the detail route cannot be built — fail loud rather than 404.
  expect(projectId, `run ${runId} has a project (codebase) id`).toBeTruthy();
  await page.goto(`/console/p/${projectId ?? ''}/r/${runId}`);
}
