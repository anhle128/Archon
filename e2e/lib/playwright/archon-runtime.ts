import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// e2e/lib/playwright -> repo root is three levels up.
const REPO_ROOT = join(HERE, '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'src', 'cli.ts');
const SERVER_ENTRY = join(REPO_ROOT, 'packages', 'server', 'src', 'index.ts');
const WEB_DIST_INDEX = join(REPO_ROOT, 'packages', 'web', 'dist', 'index.html');
const WORKFLOW_FIXTURE = join(HERE, '..', '..', 'fixtures', 'workflows', 'e2e-usage-record.yaml');

/** Name of the seeded workflow whose single AI node runs on the fake provider. */
export const E2E_WORKFLOW_NAME = 'e2e-usage-record';

/**
 * The one model the seeded config prices. A usage entry for
 * `(provider: 'openai', model: PRICED_MODEL)` with NO reported cost gets an
 * estimated cost of input 2.0 + output 10.0 (USD per 1M tokens); any other
 * (provider, model) stays unpriced. Lets the estimate path be exercised without
 * a real vendor rate.
 */
export const PRICED_MODEL = 'e2e-priced-model';
export const PRICED_MODEL_PROVIDER = 'openai';
export const PRICED_RATE_INPUT_PER_M = 2.0;
export const PRICED_RATE_OUTPUT_PER_M = 10.0;

export interface ArchonRuntime {
  /** Base URL of this worker's isolated Archon server (API + SPA). */
  baseURL: string;
  /** Isolated ARCHON_HOME (SQLite DB, home-scoped workflows) for this worker. */
  home: string;
  /** Non-git folder-project workspace used for `--folder` runs. */
  workdir: string;
  /**
   * Run the seeded workflow for real (executor -> usage recorder -> ledger),
   * with the AI faked by the env-gated `e2e-fake` provider. `directive` is the
   * `<<E2E_USAGE>>...<</E2E_USAGE>>` block that tells the fake what usage to
   * emit; omit it to exercise the no-usage path. Resolves with the run id.
   */
  runWorkflow(directive?: string): Promise<string>;
  /** Stop the server and delete the isolated temp tree. */
  stop(): Promise<void>;
}

/**
 * Isolated env for the spawned Archon processes.
 * `DATABASE_URL: ''` (empty, NOT unset) selects SQLite — an unset value would let
 * the server's dotenv re-inject the repo `.env` Postgres URL. `ARCHON_E2E_FAKE_PROVIDER`
 * registers the fake AI provider (no-op in any process without it).
 */
function isolatedEnv(home: string, port?: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ARCHON_HOME: home,
    DATABASE_URL: '',
    ARCHON_E2E_FAKE_PROVIDER: '1',
    LOG_LEVEL: 'warn',
    ...(port ? { PORT: String(port) } : {}),
  };
}

async function waitForHealth(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/health`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(
    `Archon server not healthy at ${baseURL} within ${timeoutMs}ms (last: ${lastErr})`
  );
}

export async function createArchonRuntime(workerIndex: number): Promise<ArchonRuntime> {
  if (!existsSync(WEB_DIST_INDEX)) {
    throw new Error(
      `Web UI bundle missing at ${WEB_DIST_INDEX}. Build it once with \`bun run build:web\` from the repo root before running e2e.`
    );
  }

  const base = mkdtempSync(join(tmpdir(), 'archon-e2e-'));
  const home = join(base, 'home');
  const workdir = join(base, 'workdir');
  mkdirSync(join(home, 'workflows'), { recursive: true });
  mkdirSync(workdir, { recursive: true });
  // Seed the home-scoped workflow (auto-discovered; never touches the repo).
  writeFileSync(
    join(home, 'workflows', `${E2E_WORKFLOW_NAME}.yaml`),
    readFileSync(WORKFLOW_FIXTURE)
  );

  // Seed one priced model so the tokens-only -> estimated-USD path is testable.
  // estimate.ts reads this on each fresh CLI process; reported costs still win.
  writeFileSync(
    join(home, 'config.yaml'),
    [
      'pricing:',
      '  models:',
      `    - provider: ${PRICED_MODEL_PROVIDER}`,
      `      model: ${PRICED_MODEL}`,
      `      input: ${String(PRICED_RATE_INPUT_PER_M)}`,
      `      output: ${String(PRICED_RATE_OUTPUT_PER_M)}`,
      '',
    ].join('\n')
  );

  const port = 3400 + workerIndex;
  const baseURL = `http://127.0.0.1:${port}`;

  // cwd = home (a dir with no .env) so `strip-cwd-env-boot` leaves our empty
  // DATABASE_URL intact and the repo `.env` cannot force Postgres.
  const server: ChildProcess = spawn('bun', [SERVER_ENTRY], {
    cwd: home,
    env: isolatedEnv(home, port),
    stdio: 'pipe',
  });
  let serverLog = '';
  server.stdout?.on('data', d => (serverLog += String(d)));
  server.stderr?.on('data', d => (serverLog += String(d)));
  const serverExited = new Promise<number>(res => server.on('exit', code => res(code ?? -1)));

  try {
    await waitForHealth(baseURL, 30_000);
  } catch (err) {
    server.kill('SIGTERM');
    throw new Error(
      `${(err as Error).message}\n--- server log (tail) ---\n${serverLog.slice(-2000)}`
    );
  }

  const runWorkflow = async (directive?: string): Promise<string> => {
    const args = [CLI_ENTRY, 'workflow', 'run', E2E_WORKFLOW_NAME];
    if (directive) args.push(directive);
    args.push('--folder', '--json');

    const cli = spawn('bun', args, { cwd: workdir, env: isolatedEnv(home), stdio: 'pipe' });
    let out = '';
    let errOut = '';
    cli.stdout?.on('data', d => (out += String(d)));
    cli.stderr?.on('data', d => (errOut += String(d)));
    const code: number = await new Promise(res => cli.on('exit', c => res(c ?? -1)));
    if (code !== 0) {
      throw new Error(
        `\`workflow run\` exited ${code}\n--- stderr ---\n${errOut}\n--- stdout ---\n${out}`
      );
    }
    // The CLI prints a JSON command envelope carrying workflowRunRef.runId.
    const line = out
      .split('\n')
      .reverse()
      .find(l => l.includes('workflowRunRef'));
    if (!line) throw new Error(`No run envelope in CLI output:\n${out}`);
    const envelope = JSON.parse(line) as { workflowRunRef?: { runId?: string } };
    const runId = envelope.workflowRunRef?.runId;
    if (!runId) throw new Error(`Run envelope missing runId:\n${line}`);
    return runId;
  };

  const stop = async (): Promise<void> => {
    server.kill('SIGTERM');
    await Promise.race([serverExited, new Promise(r => setTimeout(r, 3_000))]);
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best effort — temp dir cleanup should never fail a run
    }
  };

  return { baseURL, home, workdir, runWorkflow, stop };
}
