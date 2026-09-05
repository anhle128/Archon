import { test, expect } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

/**
 * Lane B spec for PR #73 — per-run workflow ENV overlays.
 *
 * User story: an operator opens the console, creates a named ENV overlay
 * (provider/model/effort/env), selects it when starting a workflow run, and the
 * run detail shows the resolved provider/model/effort/env snapshot; the overlay
 * is frozen and replays on resume. The whole app is real (console + API + DB);
 * the only mocked external is the AI provider — the overlay routes the run onto
 * the env-gated `e2e-fake` provider, so nothing paid is called and the run
 * detail shows `e2e-fake` as the resolved provider.
 *
 * STATUS: written from PR #73's real UI (branch archon/thread-9f31dc07) — the
 * confirmed data-testids are `env-editor-name`, `env-editor-submit`,
 * `env-node-select`, `env-node-patch`, `env-summary-list`, `run-env-chip`; the
 * Start controls are the "Start a new run" / "Start run" buttons and the "Manage"
 * button opens WorkflowEnvManageDialog. It is `fixme` because it can only run
 * once PR #73's overlay code and this e2e harness live on the SAME branch (the
 * archon-runtime fixture must boot an Archon that HAS the overlay routes/UI).
 * Unskip after PR #73 merges into a branch that also carries this e2e package.
 */
test.fixme('[P0] a workflow run started with an ENV overlay shows the resolved overlay in run detail', async ({
  page,
  archon,
}) => {
  // A trivial one-node workflow to run under the overlay. Seeded like the other
  // specs' e2e-usage-record; here the overlay — not the node — selects e2e-fake.
  void archon;

  // 1. Open the console draft-run card and the ENV overlay manager.
  await page.goto('/console');
  await page.getByRole('button', { name: /Start a new run/i }).click();
  await page.getByRole('button', { name: 'Manage' }).click();

  // 2. Create a named overlay that routes onto the fake provider.
  await page.getByTestId('env-editor-name').fill('e2e-overlay');
  // Select the workflow node to patch, then set its provider to e2e-fake.
  await page.getByTestId('env-node-select').selectOption({ index: 1 });
  // (env-node-patch / env-patch-editor carry the provider/model/effort fields —
  //  confirm the exact provider control when first running this spec.)
  await page.getByTestId('env-editor-submit').click();
  await expect(page.getByTestId('env-summary-list')).toContainText('e2e-overlay');

  // 3. Back on the draft card, select the overlay and start the run.
  //    DraftRunCard passes `{ envId }` to startRun when an overlay is selected.
  await page.getByRole('button', { name: /Start run/i }).click();

  // 4. Run detail shows the overlay was applied (frozen snapshot), routed to e2e-fake.
  await expect(page.getByTestId('run-env-chip')).toContainText('e2e-overlay', {
    timeout: T.long,
  });
  await expect(page.getByTestId('env-summary-list')).toContainText('e2e-fake');
});
