#!/usr/bin/env node
/**
 * Verification scaffolding. Opens Console run-detail and the HITL run room
 * the way a user does. Selectors from packages/web/src/experiments/console/
 * (ConsoleInspectPane, RunStream, ConsoleNodeRoom). Never click by coordinates.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const webUrl = process.env.ARCHON_VERIFY_WEB_URL;
const apiUrl = process.env.ARCHON_VERIFY_API_URL || webUrl;
const evidenceDir = process.env.ARCHON_VERIFY_EVIDENCE_DIR;
const runId = process.env.ARCHON_VERIFY_RUN_ID;
const inspectNode = process.env.ARCHON_VERIFY_HITL_NODE || 'inspect-file';
const toolOutput = process.env.ARCHON_VERIFY_HITL_TOOL_OUTPUT || 'HITL_TOOL_OUTPUT_VISIBLE';

if (!webUrl || !evidenceDir || !runId) {
  console.error('ARCHON_VERIFY_WEB_URL, ARCHON_VERIFY_EVIDENCE_DIR, and ARCHON_VERIFY_RUN_ID are required');
  process.exit(1);
}

/** Matches e2e SPLIT_VIEWPORT so the room uses the percentage split, not single-pane. */
const viewport = { width: 1440, height: 1000 };
const DEFAULT_RATIO_MIN = 0.38;
const DEFAULT_RATIO_MAX = 0.42;

await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function openContext(withVideo) {
  const options = { viewport };
  if (withVideo) {
    options.recordVideo = { dir: join(evidenceDir, 'video'), size: viewport };
  }
  return browser.newContext(options);
}

let context = await openContext(true);
let page;
try {
  page = await context.newPage();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!/ffmpeg/i.test(message)) {
    await browser.close().catch(() => undefined);
    throw err;
  }
  process.stderr.write('playwright ffmpeg missing; continuing without video\n');
  await context.close().catch(() => undefined);
  context = await openContext(false);
  page = await context.newPage();
}
const assertions = [];

function noted(id, detail) {
  assertions.push({ id, detail, ok: true });
}

function panelLocator(id) {
  return page.locator(`[data-panel-id="${id}"], #${id}`).first();
}

async function boxWidth(locator, label) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${label} has no bounding box`);
  }
  return box.width;
}

try {
  const detailRes = await page.request.get(
    `${apiUrl}/api/workflows/runs/${encodeURIComponent(runId)}`
  );
  if (!detailRes.ok()) {
    throw new Error(`GET /api/workflows/runs/${runId} HTTP ${detailRes.status()}`);
  }
  const detail = await detailRes.json();
  const projectId = detail.run?.codebase_id;
  if (!projectId) {
    throw new Error(`run ${runId} has no codebase_id; register the checkout before the run`);
  }
  noted('run-detail-api', `codebase_id=${projectId}`);

  const runPath = `/console/p/${projectId}/r/${runId}`;
  await page.goto(`${webUrl}${runPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(new RegExp(`/console/p/${projectId}/r/${runId}`));
  await page.getByText(/e2e-hitl-run/i).first().waitFor({ state: 'visible', timeout: 30_000 });
  noted('run-title', 'run detail shows e2e-hitl-run');

  const roomCount = await panelLocator('console-run-room').count();
  if (roomCount !== 0) {
    throw new Error('console-run-room present on first visit; room must start absent');
  }
  const dividerCount = await page.getByRole('separator', { name: 'Resize node room' }).count();
  if (dividerCount !== 0) {
    throw new Error('Resize node room separator present before a node is selected');
  }
  noted('room-absent', 'first visit has no room and no divider');

  const logRow = page.locator('button[id^="console-log-"]').filter({ hasText: inspectNode }).first();
  await logRow.waitFor({ state: 'visible', timeout: 30_000 });
  await logRow.click();

  const room = page.getByRole('region', { name: `${inspectNode} room` });
  await room.waitFor({ state: 'visible', timeout: 30_000 });
  noted('room-open', `region ${inspectNode} room is visible`);

  const viewWidth = await boxWidth(panelLocator('console-run-view'), 'console-run-view');
  const roomWidth = await boxWidth(panelLocator('console-run-room'), 'console-run-room');
  const ratio = roomWidth / (viewWidth + roomWidth);
  if (ratio < DEFAULT_RATIO_MIN || ratio > DEFAULT_RATIO_MAX) {
    throw new Error(`room ratio ${ratio.toFixed(3)} is outside ${DEFAULT_RATIO_MIN}-${DEFAULT_RATIO_MAX}`);
  }
  noted('room-ratio', `ratio=${ratio.toFixed(3)}`);

  await room.getByText('ASSISTANT').waitFor({ state: 'visible', timeout: 30_000 });
  await room.getByText(toolOutput).waitFor({ state: 'visible', timeout: 30_000 });
  noted('room-history', `ASSISTANT + ${toolOutput} visible in room`);

  await page.screenshot({
    path: join(evidenceDir, 'hitl-room-open.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Close' }).click();
  await panelLocator('console-run-room').waitFor({ state: 'hidden', timeout: 15_000 }).catch(async () => {
    const leftover = await panelLocator('console-run-room').count();
    if (leftover !== 0) {
      throw new Error('console-run-room still present after Close');
    }
  });
  if ((await panelLocator('console-run-room').count()) !== 0) {
    throw new Error('console-run-room still present after Close');
  }
  noted('room-close', 'Close removes console-run-room');

  await page.screenshot({
    path: join(evidenceDir, 'hitl-room-closed.png'),
    fullPage: true,
  });

  await page.goto(`${webUrl}${runPath}?node=${encodeURIComponent(inspectNode)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('region', { name: `${inspectNode} room` }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  noted('room-deeplink', `?node=${inspectNode} opens the room`);

  await page.screenshot({
    path: join(evidenceDir, 'hitl-room-deeplink.png'),
    fullPage: true,
  });

  const videoPath = (await page.video()?.path()) ?? null;
  await context.close();
  await browser.close();

  const summary = {
    ok: true,
    feature: 'hitl-run-room',
    webUrl,
    runId,
    projectId,
    inspectNode,
    roomRatio: ratio,
    viewport,
    assertions,
    screenshots: ['hitl-room-open.png', 'hitl-room-closed.png', 'hitl-room-deeplink.png'],
    video: videoPath,
    videoEnabled: videoPath !== null,
  };
  await writeFile(join(evidenceDir, 'ui-assertions.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await page.screenshot({
      path: join(evidenceDir, 'hitl-room-failure.png'),
      fullPage: true,
    });
  } catch {
    /* page may already be gone */
  }
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await writeFile(
    join(evidenceDir, 'ui-assertions.json'),
    `${JSON.stringify({ ok: false, error: message, assertions }, null, 2)}\n`
  );
  console.error(message);
  process.exit(1);
}
