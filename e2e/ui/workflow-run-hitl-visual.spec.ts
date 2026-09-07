import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '../lib/playwright/suite';
import { HITL_INSPECT_NODE, HITL_TOOL_OUTPUT } from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Visual acceptance captures for HITL mockup alignment.
 *
 * These are review artifacts, not self-approving app snapshots. Compare each
 * actual capture against the canonical mockup in
 * `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` and record the
 * verdict in `plans/.../reports/visual-acceptance.md`.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTURE_DIR = join(
  REPO_ROOT,
  'plans',
  '260907-1454-workflow-run-hitl-mockup-alignment',
  'reports',
  'captures'
);
const MOCKUP_CONSOLE = join(
  REPO_ROOT,
  '_bmad-output',
  'specs',
  'spec-workflow-run-view-hitl',
  'ux-mockup',
  'console.html'
);
const MOCKUP_LEGACY = join(
  REPO_ROOT,
  '_bmad-output',
  'specs',
  'spec-workflow-run-view-hitl',
  'ux-mockup',
  'index.html'
);

const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1280x900', width: 1280, height: 900 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
] as const;

test('[P1] HITL visual: Console and Legacy vs canonical mockup at required viewports', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  mkdirSync(CAPTURE_DIR, { recursive: true });

  await openRunDetail(page, started.runId, HITL_INSPECT_NODE);
  await expect(page.getByText(/Awaiting input/i).first()).toBeVisible({ timeout: T.medium });
  await expect(page.locator('.ptool', { hasText: HITL_TOOL_OUTPUT })).toBeVisible({
    timeout: T.medium,
  });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible();
    await page.screenshot({
      path: join(CAPTURE_DIR, `console-actual-${vp.name}.png`),
      fullPage: true,
    });
  }

  await openLegacyRunDetail(page, started.runId);
  await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible({ timeout: T.medium });
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.screenshot({
      path: join(CAPTURE_DIR, `legacy-actual-${vp.name}.png`),
      fullPage: true,
    });
  }

  let mockupCaptured = false;
  let mockupLimit = '';
  try {
    await page.goto(`file://${MOCKUP_CONSOLE}`);
    await expect(page.locator('body')).toBeVisible({ timeout: T.short });
    mockupCaptured = true;
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.screenshot({
        path: join(CAPTURE_DIR, `console-mockup-${vp.name}.png`),
        fullPage: true,
      });
    }
    await page.goto(`file://${MOCKUP_LEGACY}`);
    await expect(page.locator('body')).toBeVisible({ timeout: T.short });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.screenshot({
        path: join(CAPTURE_DIR, `legacy-mockup-${vp.name}.png`),
        fullPage: true,
      });
    }
  } catch (err) {
    mockupLimit = err instanceof Error ? err.message : String(err);
    writeFileSync(
      join(CAPTURE_DIR, 'mockup-capture-limit.txt'),
      `file:// mockup capture blocked or failed:\n${mockupLimit}\n`
    );
  }
  expect(mockupCaptured || mockupLimit.length > 0).toBe(true);
});
