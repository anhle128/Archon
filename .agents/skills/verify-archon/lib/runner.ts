import { cp, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import {
  collectPlaywright,
  digest,
  evaluatePlaywright,
  normalizeProposal,
  playwrightReportSchema,
  selectionSchema,
  type Catalog,
  type Scenario,
  type ScenarioResult,
  type Selection,
} from './contract';
import {
  readJson,
  repoRoot,
  runCommand,
  skillRoot,
  snapshot,
  suiteRoot,
  toolingDigest,
  writeJson,
} from './io';

const runtime = join(skillRoot, 'bin/runtime');
const playwright = join(suiteRoot, 'node_modules/@playwright/test/cli.js');

export async function validateSelection(
  catalog: Catalog,
  repo: string,
  input: unknown,
  base: string,
  mode: Selection['mode'] = 'change'
): Promise<Selection> {
  const selection = selectionSchema.parse(input);
  if (selection.mode !== mode)
    throw new Error(
      selection.mode === 'historical'
        ? 'Historical selection requires explicit --historical mode.'
        : 'Change selection cannot be validated as historical.'
    );
  const current = await snapshot(repo, base);
  const normalized = normalizeProposal(catalog, selection.proposal, current, mode);
  if (digest(selection) !== digest(normalized)) {
    throw new Error(
      'Selection is stale or modified; normalize the complete current proposal again.'
    );
  }
  return normalized;
}

function selectedScenarios(catalog: Catalog, ids: string[]): Scenario[] {
  if (ids.length === 0) throw new Error('At least one scenario is required');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selected scenario');
  return ids.map(id => {
    const scenario = catalog.scenarios.get(id);
    if (!scenario) throw new Error(`Unknown scenario: ${id}`);
    return scenario;
  });
}

function playwrightArgs(scenarios: Scenario[]): string[] {
  const files = [
    ...new Set(
      scenarios.flatMap(item => (item.runner.kind === 'playwright' ? [item.runner.file] : []))
    ),
  ];
  const escape = (id: string): string => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    'node',
    playwright,
    'test',
    '-c',
    join(suiteRoot, 'playwright.config.ts'),
    ...files,
    '--grep',
    scenarios.map(item => `\\[V:${escape(item.id)}\\]`).join('|'),
  ];
}

export async function validateRunnable(
  catalog: Catalog,
  ids: string[],
  dir: string
): Promise<void> {
  const scenarios = selectedScenarios(catalog, ids);
  const ui = scenarios.filter(item => item.runner.kind === 'playwright');
  if (ui.length) {
    const listed = await runCommand(
      [...playwrightArgs(ui), '--list', '--reporter=json'],
      suiteRoot,
      dir,
      'list',
      {
        PLAYWRIGHT_JSON_OUTPUT_NAME: '',
        PLAYWRIGHT_JSON_OUTPUT_FILE: '',
        PLAYWRIGHT_JSON_OUTPUT_DIR: '',
      },
      60_000
    );
    if (listed.exit_code !== 0)
      throw new Error(`Cannot list durable Playwright scenarios; see ${listed.stderr}`);
    const actual = collectPlaywright(await readJson(listed.stdout));
    for (const scenario of ui) {
      if (actual.get(scenario.id)?.length !== 1) {
        throw new Error(
          `Scenario ${scenario.id} must identify exactly one runnable Playwright test`
        );
      }
    }
  }
  for (const scenario of scenarios) {
    if (scenario.runner.kind === 'playwright') continue;
    const checked = await runCommand(
      ['bash', runtime, 'supports', scenario.runner.recipe],
      repoRoot,
      dir,
      `supports-${scenario.id}`
    );
    if (checked.exit_code !== 0)
      throw new Error(`Scenario ${scenario.id} has no executable CLI/API recipe`);
  }
}

export function cliRuntimeEnv(repo: string, dir: string): NodeJS.ProcessEnv {
  const port = Number(process.env.ARCHON_VERIFY_PORT ?? '13390');
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('ARCHON_VERIFY_PORT must be an integer between 1024 and 65535');
  return {
    ARCHON_VERIFY_REPO_ROOT: repo,
    ARCHON_VERIFY_STATE_DIR: join(dir, 'runtime'),
    ARCHON_VERIFY_EVIDENCE: dir,
    ARCHON_VERIFY_TARGET: 'local',
    ARCHON_VERIFY_PORT: String(port),
    ARCHON_VERIFY_BASE_URL: `http://127.0.0.1:${port}`,
    ARCHON_VERIFY_HOME: join(dir, 'runtime/home'),
  };
}

async function runCli(scenario: Scenario, repo: string, dir: string): Promise<ScenarioResult> {
  if (scenario.runner.kind === 'playwright') throw new Error('Expected CLI/API scenario');
  const env = cliRuntimeEnv(repo, dir);
  let error: string | undefined;
  try {
    for (const [step, args] of [
      ['launch', ['launch', '--json']],
      ['doctor', ['doctor', '--json']],
      ['drive', ['drive', scenario.runner.recipe, '--json']],
    ] as const) {
      const result = await runCommand(['bash', runtime, ...args], repoRoot, dir, step, env);
      if (result.exit_code !== 0)
        throw new Error(`${step} exited ${result.exit_code}; see ${result.stderr}`);
      if (step === 'drive') {
        const body = await readJson(result.stdout);
        if (typeof body !== 'object' || body === null || !('ok' in body) || body.ok !== true) {
          throw new Error(
            'CLI/API scenario did not produce a successful executable assertion result'
          );
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    const cleanup = await runCommand(
      ['bash', runtime, 'cleanup', '--json'],
      repoRoot,
      dir,
      'cleanup',
      env
    );
    if (cleanup.exit_code !== 0) error = `${error ?? ''} Cleanup failed; see ${cleanup.stderr}`;
  }
  return {
    id: scenario.id,
    status: error ? 'failed' : 'passed',
    errors: error ? [error] : [],
    attachments: [],
  };
}

export async function prove(
  catalog: Catalog,
  repo: string,
  ids: string[],
  evidenceRoot: string,
  selection?: Selection,
  selectionBase = 'HEAD',
  selectionMode: Selection['mode'] = 'change'
): Promise<{
  ok: boolean;
  verdict: 'PASS' | 'FAIL';
  evidence_dir: string;
  scenarios: ScenarioResult[];
}> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = resolve(evidenceRoot, runId);
  await mkdir(dir, { recursive: true });
  const errors: string[] = [];
  const results: ScenarioResult[] = [];
  const before = await snapshot(repo, selection ? selectionBase : 'HEAD');
  const toolHash = await toolingDigest();
  const selected = selectedScenarios(catalog, ids);
  await writeJson(
    join(dir, 'selection.json'),
    selection ?? {
      version: 1,
      mode: 'scenario-debug',
      snapshot: before,
      scenario_ids: ids,
      catalog_sha256: catalog.sha256,
    }
  );
  try {
    if (before.dirty)
      throw new Error('Product checkout is dirty; a commit-bound proof needs a clean target.');
    if (selection) await validateSelection(catalog, repo, selection, selectionBase, selectionMode);
    await validateRunnable(catalog, ids, dir);
    const ui = selected.filter(item => item.runner.kind === 'playwright');
    if (ui.length) {
      // Always build the selected product checkout; an old dist is not evidence for its HEAD.
      const build = await runCommand(['bun', 'run', 'build:web'], repo, dir, 'build-web');
      if (build.exit_code !== 0) throw new Error(`Product build failed; see ${build.stderr}`);
      const rawReport = join(dir, 'playwright.json');
      const execution = await runCommand(
        [
          ...playwrightArgs(ui),
          '--reporter=json',
          '--retries=0',
          '--workers=1',
          '--forbid-only',
          '--fail-on-flaky-tests',
          '--update-snapshots=none',
          '--trace=retain-on-failure',
          '--global-timeout',
          String(Math.max(240_000, ui.length * 100_000)),
          '--output',
          join(dir, 'playwright-artifacts'),
        ],
        suiteRoot,
        dir,
        'playwright',
        {
          ARCHON_E2E_REPO_ROOT: repo,
          ARCHON_E2E_PROOF: '1',
          ARCHON_E2E_PORT_BASE: process.env.ARCHON_E2E_PORT_BASE ?? '13500',
          PLAYWRIGHT_JSON_OUTPUT_FILE: rawReport,
          PLAYWRIGHT_JSON_OUTPUT_NAME: '',
          PLAYWRIGHT_JSON_OUTPUT_DIR: '',
        },
        Math.max(300_000, ui.length * 120_000)
      );
      const report = playwrightReportSchema.parse(await readJson(rawReport));
      results.push(
        ...evaluatePlaywright(
          report,
          ui.map(item => item.id)
        )
      );
      errors.push(
        ...report.errors.map(error => error.message ?? error.value ?? 'Playwright worker error')
      );
      if (execution.exit_code !== 0 && results.every(item => item.status === 'passed')) {
        errors.push(`Playwright process exited ${execution.exit_code}; see ${execution.stderr}`);
      }
    }
    for (const scenario of selected) {
      if (scenario.runner.kind !== 'playwright') {
        results.push(await runCli(scenario, repo, join(dir, 'scenarios', scenario.id)));
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const after = await snapshot(repo, before.base_sha);
  if (before.head_sha !== after.head_sha || after.dirty)
    errors.push('Product HEAD or working tree changed during proof; select and run again.');
  if (toolHash !== (await toolingDigest()))
    errors.push('Verification tooling changed during proof; run again.');
  for (const id of ids) {
    if (!results.some(item => item.id === id))
      results.push({
        id,
        status: 'missing',
        errors: ['Required scenario did not execute'],
        attachments: [],
      });
  }
  for (const item of results) {
    if (
      item.status === 'passed' &&
      catalog.scenarios.get(item.id)?.proof_obligations.includes('screenshot') &&
      !item.attachments.some(attachment => /\.(png|jpe?g)$/i.test(attachment.path))
    ) {
      item.status = 'failed';
      item.errors.push('Required supporting screenshot was not produced');
    }
    const scenarioDir = join(dir, 'scenarios', item.id);
    await mkdir(scenarioDir, { recursive: true });
    for (const [index, attachment] of item.attachments.entries()) {
      const destination = join(scenarioDir, `${index}-${basename(attachment.path)}`);
      await cp(attachment.path, destination);
      attachment.path = destination;
    }
    await writeJson(join(scenarioDir, 'result.json'), item);
  }
  const ok = errors.length === 0 && results.every(item => item.status === 'passed');
  const verdict = ok ? 'PASS' : 'FAIL';
  const result = {
    version: 1,
    run_id: runId,
    ok,
    verdict,
    mode: selection ? 'selection' : 'scenario-debug',
    repo,
    product: before,
    catalog_sha256: catalog.sha256,
    tooling_sha256: toolHash,
    selection_sha256: digest(await readJson(join(dir, 'selection.json'))),
    behavior_ids: selection?.behavior_ids ?? [],
    scenario_ids: ids,
    scenarios: results,
    errors,
    evidence_dir: dir,
  };
  await writeJson(join(dir, 'result.json'), result);
  return { ok, verdict, evidence_dir: dir, scenarios: results };
}
