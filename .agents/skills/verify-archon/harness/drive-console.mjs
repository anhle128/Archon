#!/usr/bin/env node
/**
 * Verification scaffolding. Opens the Archon console the way a user does.
 * Selectors are from packages/web/src/experiments/console/ (ProjectRail,
 * RunsPage, SettingsPage, FilterChips). Never click by coordinates.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const webUrl = process.env.ARCHON_VERIFY_WEB_URL;
const evidenceDir = process.env.ARCHON_VERIFY_EVIDENCE_DIR;

if (!webUrl || !evidenceDir) {
  console.error('ARCHON_VERIFY_WEB_URL and ARCHON_VERIFY_EVIDENCE_DIR are required');
  process.exit(1);
}

/** Tailwind `lg` is 1024px. ProjectRail is `hidden lg:block` — narrower hides the rail. */
const viewport = { width: 1440, height: 900 };

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

try {
  await page.goto(`${webUrl}/console`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/console\/?$/);

  const rail = page.getByRole('navigation', { name: 'Projects' });
  await rail.waitFor({ state: 'visible', timeout: 30_000 });
  noted('console-rail', 'nav aria-label=Projects is visible');

  await rail.getByText('Archon', { exact: true }).waitFor({ state: 'visible' });
  await rail.getByText('console', { exact: true }).waitFor({ state: 'visible' });
  noted('console-brand', 'rail shows Archon + console pill');

  await page.getByRole('heading', { name: 'All projects', level: 1 }).waitFor({
    state: 'visible',
  });
  await page.getByText('Every run, across every project.').waitFor({ state: 'visible' });
  await page.getByText('Pick a project on the left to start a run.').waitFor({
    state: 'visible',
  });
  noted('console-runs-heading', 'h1 All projects + all-projects copy');

  await page.getByRole('button', { name: 'All projects' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Add project' }).waitFor({ state: 'visible' });
  noted('console-rail-actions', 'All projects + Add project buttons visible');

  await page.getByText('Nothing running right now.').waitFor({ state: 'visible' });
  noted('console-empty-running', 'default Running filter empty state');

  await page.screenshot({
    path: join(evidenceDir, 'console-runs.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /^All \d+$/ }).click();
  await page.getByText('No runs yet.').waitFor({ state: 'visible' });
  noted('console-filter-all', 'All filter chip shows No runs yet.');

  await page.screenshot({
    path: join(evidenceDir, 'console-runs-all.png'),
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.waitForURL(/\/console\/settings\/?$/);
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({
    state: 'visible',
  });
  noted('console-settings', 'Settings link → /console/settings h1 Settings');

  await page.screenshot({
    path: join(evidenceDir, 'console-settings.png'),
    fullPage: true,
  });

  const videoPath = (await page.video()?.path()) ?? null;
  await context.close();
  await browser.close();

  const summary = {
    ok: true,
    feature: 'web-console',
    webUrl,
    viewport,
    assertions,
    screenshots: ['console-runs.png', 'console-runs-all.png', 'console-settings.png'],
    video: videoPath,
    videoEnabled: videoPath !== null,
  };
  await writeFile(join(evidenceDir, 'ui-assertions.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await page.screenshot({
      path: join(evidenceDir, 'console-failure.png'),
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
