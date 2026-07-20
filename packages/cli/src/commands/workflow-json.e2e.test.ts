import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';

// RED-PHASE E2E SCAFFOLD (EXECUTABLE) — Story 3.3b "Provide Archon Start And
// Status CLI JSON". First-party consumer surface: a real controller (Hermes)
// invokes `archon workflow run <name> [message] --json` / `archon workflow
// get <run-id> --json` as a subprocess and parses stdout. Mirrors
// provider-binding.e2e.test.ts's real-subprocess `runCli()` harness — the
// harness (cli.ts, Bun) already exists, so these run the REAL CLI entry
// point rather than importing `./workflow` or `./cli` directly.
//
// Every test below drives cli.ts genuinely (no `test.skip()`): the dispatch
// route already exists (`case 'workflow': switch (subcommand) { case 'run':
// ... case 'get': ... }`), so these fail for real against TODAY's plain-text
// usage errors / legacy `{ok:false}` JSON, not vacuously. Verified manually
// before writing (see story research): `workflow run --json` with a missing
// name prints "Usage: ..." to stderr and exits 1 with EMPTY stdout;
// `workflow get <uuid> --json` for a not-found run prints the legacy
// `{ok:false, runId, error:'not_found'}` shape with no `correlationId`.

const CLI_ENTRY = join(import.meta.dir, '..', 'cli.ts');

let isolatedHome: string;
let isolatedRepo: string;

beforeAll(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), 'archon-workflow-json-e2e-'));
  isolatedRepo = mkdtempSync(join(tmpdir(), 'archon-workflow-json-repo-'));
  execFileSync('git', ['init', isolatedRepo], { stdio: 'ignore' });
});

afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
  rmSync(isolatedRepo, { recursive: true, force: true });
});

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string = isolatedRepo): Promise<CliResult> {
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ARCHON_HOME: isolatedHome,
  };
  delete childEnv.DATABASE_URL;
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: childEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function parseSoleJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

async function seedFailedRun(runId: string, workingPath: string): Promise<void> {
  await runCli(['workflow', 'list', '--json']);
  const dbPath = join(isolatedHome, 'archon.db');
  const db = new Database(dbPath);
  try {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(
      `INSERT OR IGNORE INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
       VALUES ('seed-conv-e2e', 'cli', 'seed-conv-e2e')`
    );
    db.run(
      `INSERT INTO remote_agent_workflow_runs (id, conversation_id, workflow_name, user_message, status, working_path, metadata)
       VALUES (?, 'seed-conv-e2e', 'test-workflow', 'seed failed run', 'failed', ?, '{}')`,
      [runId, workingPath]
    );
  } finally {
    db.close();
  }
}

describe('workflow run/get --json CLI dispatch E2E — real subprocess (Story 3.3b)', () => {
  // 3.3B-CLI-031 [P0] R-003,RC-09,RC-10 — a missing `workflow run` name under
  // --json must become a `workflow.start` MALFORMED_REQUEST envelope with
  // exitCode 64, not today's plain "Usage: ..." stderr text + empty stdout.
  test('3.3B-CLI-031: `workflow run --json` with no name emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'run', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-032 [P0] R-003,R-009 — a mutually-exclusive flag combination
  // (--branch + --no-worktree) under --json must reach workflowRunCommand's
  // fail-closed boundary as a classified envelope, not cli.ts's plain-text
  // `console.error` shortcut that bypasses --json entirely today.
  test('3.3B-CLI-032: `workflow run <name> --branch x --no-worktree --json` emits one classified envelope, not a console.error shortcut', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--branch',
      'x',
      '--no-worktree',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-033 [P0] R-003,RC-09,RC-10 — a missing `workflow get` run id
  // under --json must become a `workflow.status` MALFORMED_REQUEST envelope
  // with exitCode 64, not today's plain "Usage: ..." stderr text.
  test('3.3B-CLI-033: `workflow get --json` with no run id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'get', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-035 [P0] R-003,R-004,R-009 — an unknown workflow name under
  // --json must fail closed as ONE classified WORKFLOW_NOT_FOUND envelope
  // (exit 78), never today's uncaught rejection surfacing as a raw
  // "Error: Workflow '...' not found." line via cli.ts's generic catch.
  test('3.3B-CLI-035: unknown workflow name under --json emits one WORKFLOW_NOT_FOUND envelope, exit 78', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('WORKFLOW_NOT_FOUND');
    expect(error?.category).toBe('unexpected_state');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-034 [P1] R-010 — `--correlation-id` (already a registered
  // global parseArgs option since Story 3.1) is threaded through to both
  // `workflow run --json` and `workflow get --json` and echoed verbatim.
  describe('3.3B-CLI-034: --correlation-id argv threading', () => {
    test('is echoed on a `workflow run --json` failure envelope', async () => {
      const { stdout } = await runCli([
        'workflow',
        'run',
        'totally-nonexistent-workflow-story-3-3b',
        '--json',
        '--correlation-id',
        'corr-cli-034-run',
      ]);
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.correlationId).toBe('corr-cli-034-run');
    });

    test('is echoed on a `workflow get --json` not-found envelope', async () => {
      const { stdout } = await runCli([
        'workflow',
        'get',
        '00000000-0000-0000-0000-000000000000',
        '--json',
        '--correlation-id',
        'corr-cli-034-get',
      ]);
      const envelope = parseSoleJsonLine(stdout);
      // Today this is the legacy `{ok:false, runId, error:'not_found'}` shape
      // with no `correlationId` key at all — genuinely red, not a value
      // mismatch on a key that already exists.
      expect(envelope.correlationId).toBe('corr-cli-034-get');
    });
  });

  test('RF-35: `workflow run --json --correlation-id=` emits MALFORMED_REQUEST, not an internal or lookup error', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-35: `workflow get --json --correlation-id=` emits MALFORMED_REQUEST, not an internal error', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-36: `workflow run --json=true` emits a malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--json=true',
      '--correlation-id',
      'corr-rf-36-run',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-rf-36-run');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-36: `workflow run --json=true` without a supplied correlation id still emits one malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    expect(typeof envelope.correlationId).toBe('string');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-40: `workflow get --json=true` emits a malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-rf-40-get',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-rf-40-get');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-41: bare `--correlation-id` cannot consume `--json` and bypass the get envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-41: bare `--correlation-id` cannot consume `--json` and bypass the run envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-44: `--json=true` after `--` stays positional and does not emit a workflow.start envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--',
      '--json=true',
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
    expect(stdout).not.toContain('"command":"workflow.start"');
    expect(stderr).toContain("Workflow 'totally-nonexistent-workflow-story-3-3b' not found.");
  });

  test('RF-34: git-preflight JSON fallback does not emit workflow.start for unrelated workflow JSON commands', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-'));
    try {
      const { stdout, exitCode } = await runCli(['workflow', 'list', '--json'], nonGitCwd);

      expect(exitCode).not.toBe(0);
      if (stdout.trim().length > 0) {
        const envelope = parseSoleJsonLine(stdout);
        expect(envelope.command).not.toBe('workflow.start');
      } else {
        expect(stdout).not.toContain('workflow.start');
      }
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE E2E SCAFFOLD — Story 3.3c "Provide Archon Provider Decision
// Command CLI JSON". First-party consumer surface: a real controller (Hermes)
// invokes `archon workflow approve <run-id> --json` / `archon workflow reject
// <run-id> --json` as a subprocess and parses stdout.
//
// Tests below drive the REAL CLI entry point (cli.ts) as a subprocess.
// Currently genuinely red: today's `workflow approve --json` with a missing
// run-id prints "Usage: ..." to stderr and exits 1 (no MALFORMED_REQUEST
// envelope), and `workflow reject --json` behaves the same.
//
// ACTIVATION: getWorkflowCommandEnvelopeCommand in cli.ts must map
// 'approve' → 'workflow.approve' and 'reject' → 'workflow.reject', and
// the missing-run-id handler must emit a MALFORMED_REQUEST envelope in
// JSON mode.
// ---------------------------------------------------------------------------

describe('workflow approve/reject --json CLI dispatch E2E — real subprocess (Story 3.3c)', () => {
  // 3.3C-CLI-001 [P0] AC #2 — missing run-id on approve --json
  test('3.3C-CLI-001: `workflow approve --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'approve', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-002 [P0] AC #2 — missing run-id on reject --json
  test('3.3C-CLI-002: `workflow reject --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'reject', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-003 [P1] AC #2 — correlation-id threaded on approve --json
  test('3.3C-CLI-003: --correlation-id is echoed on a `workflow approve --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-003-approve',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-003-approve');
  });

  // 3.3C-CLI-004 [P1] AC #2 — correlation-id threaded on reject --json
  test('3.3C-CLI-004: --correlation-id is echoed on a `workflow reject --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'some reason',
      '--json',
      '--correlation-id',
      'corr-cli-004-reject',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-004-reject');
  });

  // 3.3C-CLI-005 [P0] AC #2 — blank correlation-id on approve emits MALFORMED_REQUEST
  test('3.3C-CLI-005: `workflow approve --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details005 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors005 = details005?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors005).toBeDefined();
    expect(fieldErrors005).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-006 [P0] AC #2 — blank correlation-id on reject emits MALFORMED_REQUEST
  test('3.3C-CLI-006: `workflow reject --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details006 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors006 = details006?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors006).toBeDefined();
    expect(fieldErrors006).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-007 [P1] AC #2 — invalid JSON flag (--json=true) on approve
  test('3.3C-CLI-007: `workflow approve --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-cli-007',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-007');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details007 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors007 = details007?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors007).toBeDefined();
    expect(fieldErrors007).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-008 [P1] AC #2 — invalid JSON flag (--json=true) on reject
  test('3.3C-CLI-008: `workflow reject --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json=true',
      '--correlation-id',
      'corr-cli-008',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-008');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details008 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors008 = details008?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors008).toBeDefined();
    expect(fieldErrors008).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-009 [P1] — bare --correlation-id consuming --json on approve
  test('3.3C-CLI-009: bare `--correlation-id` cannot consume `--json` and bypass the approve envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details009 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors009 = details009?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors009).toBeDefined();
    expect(fieldErrors009).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-010 [P1] — bare --correlation-id consuming --json on reject
  test('3.3C-CLI-010: bare `--correlation-id` cannot consume `--json` and bypass the reject envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details010 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors010 = details010?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors010).toBeDefined();
    expect(fieldErrors010).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-011 [P0] — not-a-git-repo emits envelope (inherited from cli.ts guard)
  test('3.3C-CLI-011: `workflow approve --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3c-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'approve', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.approve');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details011 = error?.details as Record<string, unknown> | undefined;
      const fieldErrors011 = details011?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors011).toBeDefined();
      expect(fieldErrors011?.length).toBeGreaterThanOrEqual(1);
      expect(fieldErrors011).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3C-CLI-014 [P0] — reject from non-git directory emits envelope (RF-09, RF-11)
  test('3.3C-CLI-014: `workflow reject --json` from a non-git directory emits MALFORMED_REQUEST with /cwd field error', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3c-rj-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'reject', '00000000-0000-0000-0000-000000000000', 'reason', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.reject');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors?.length).toBeGreaterThanOrEqual(1);
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3C-CLI-012 [P0] — nonexistent --cwd emits envelope (inherited from cli.ts guard)
  test('3.3C-CLI-012: `workflow approve --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details012 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors012 = details012?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors012).toBeDefined();
    expect(fieldErrors012).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-013 [P0] — nonexistent --cwd emits envelope for reject too
  test('3.3C-CLI-013: `workflow reject --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details013 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors013 = details013?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors013).toBeDefined();
    expect(fieldErrors013).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE E2E SCAFFOLD — Story 3.3d "Provide Archon Recovery Command CLI
// JSON". First-party consumer surface: a real controller (Hermes) invokes
// `archon workflow resume/retry/cancel <run-id> --json` as a subprocess and
// parses stdout.
//
// Tests below drive the REAL CLI entry point (cli.ts) as a subprocess.
// Resume tests are EXECUTABLE (today's `workflow resume --json` with a missing
// run-id prints usage text, not an envelope).
// Retry/cancel tests: `workflow retry` and `workflow cancel` subcommands do
// not exist yet, so the CLI dispatcher falls through to the default case
// (usage text + exit 1), not an envelope. These fail genuinely.
//
// ACTIVATION for retry/cancel: cli.ts switch must handle 'retry' and 'cancel'
// subcommands, getWorkflowCommandEnvelopeCommand must map them to
// 'workflow.retry' and 'workflow.cancel', and the missing-run-id pre-handler
// must emit a MALFORMED_REQUEST envelope in JSON mode.
// ---------------------------------------------------------------------------

describe('workflow resume/retry/cancel --json CLI dispatch E2E — real subprocess (Story 3.3d)', () => {
  // 3.3D-CLI-001 [P0] AC #1 — missing run-id on resume --json
  test('3.3D-CLI-001: `workflow resume --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'resume', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-002 [P0] AC #1 — correlation-id threaded on resume --json
  test('3.3D-CLI-002: --correlation-id is echoed on a `workflow resume --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-002-resume',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-002-resume');
  });

  // 3.3D-CLI-003 [P0] AC #1 — blank correlation-id on resume emits MALFORMED_REQUEST
  test('3.3D-CLI-003: `workflow resume --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-004 [P1] AC #1 — invalid JSON flag (--json=true) on resume
  test('3.3D-CLI-004: `workflow resume --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-cli-004',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-004');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-005 [P0] AC #1 — not-a-git-repo emits envelope for resume
  test('3.3D-CLI-005: `workflow resume --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-rs-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'resume', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.resume');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-006 [P0] AC #1 — nonexistent --cwd emits envelope for resume
  test('3.3D-CLI-006: `workflow resume --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-3d',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-007 [P0] AC #1 — resume with a not-found run-id emits UNEXPECTED_STATE
  test('3.3D-CLI-007: `workflow resume <unknown-uuid> --json` emits envelope with exit 78', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(error?.category).toBe('unexpected_state');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-008 [P0] AC #2 — missing run-id on retry --json
  test('3.3D-CLI-008: `workflow retry --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'retry', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-009 [P0] AC #4 — missing run-id on cancel --json
  test('3.3D-CLI-009: `workflow cancel --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'cancel', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-010 [P1] AC #2 — correlation-id threaded on retry --json
  test('3.3D-CLI-010: --correlation-id is echoed on a `workflow retry --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-010-retry',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-010-retry');
  });

  // 3.3D-CLI-011 [P1] AC #4 — correlation-id threaded on cancel --json
  test('3.3D-CLI-011: --correlation-id is echoed on a `workflow cancel --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-011-cancel',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-011-cancel');
  });

  // 3.3D-CLI-012 [P0] AC #2 — blank correlation-id on retry emits MALFORMED_REQUEST
  test('3.3D-CLI-012: `workflow retry --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-013 [P0] AC #4 — blank correlation-id on cancel emits MALFORMED_REQUEST
  test('3.3D-CLI-013: `workflow cancel --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-014 [P1] AC #2 — invalid JSON flag (--json=true) on retry
  test('3.3D-CLI-014: `workflow retry --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-015 [P1] AC #4 — invalid JSON flag (--json=true) on cancel
  test('3.3D-CLI-015: `workflow cancel --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-016 [P0] — retry from non-git directory emits envelope
  test('3.3D-CLI-016: `workflow retry --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-rt-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'retry', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.retry');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-017 [P0] — cancel from non-git directory emits envelope
  test('3.3D-CLI-017: `workflow cancel --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-cn-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'cancel', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.cancel');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-018 [P0] — non-JSON `workflow retry` emits usage guidance (TD-009)
  test('3.3D-CLI-018: `workflow retry` without --json emits usage guidance pointing to retry-node', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
    ]);

    const output = stdout + stderr;
    expect(output).toContain('retry-node');
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
  });

  // 3.3D-CLI-019 [P0] — non-JSON `workflow cancel` emits usage guidance (TD-009)
  test('3.3D-CLI-019: `workflow cancel` without --json emits dedicated usage guidance pointing to abandon', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
    ]);

    const output = stdout + stderr;
    // Must contain dedicated guidance text like "use `workflow abandon`", not
    // just "abandon" appearing in a generic "Available:" subcommand list.
    expect(output).toMatch(/use.*abandon|workflow abandon/i);
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
  });

  // 3.3D-CLI-020 [P1] — bare --correlation-id cannot consume --json on retry
  test('3.3D-CLI-020: bare `--correlation-id` cannot consume `--json` and bypass the retry envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-021 [P1] — bare --correlation-id cannot consume --json on cancel
  test('3.3D-CLI-021: bare `--correlation-id` cannot consume `--json` and bypass the cancel envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-022 [P0] R1-F14 — real-subprocess retry success envelope
  test('3.3D-CLI-022: `workflow retry <failed-run> --json` emits a success envelope matching retry-success.json shape', async () => {
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--json',
      '--correlation-id',
      'corr-cli-022-retry-success',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-022-retry-success');

    const wfRef = envelope.workflowRunRef as Record<string, unknown> | undefined;
    expect(wfRef?.provider).toBe('archon');
    expect(wfRef?.runId).toBe(runId);
    expect(wfRef?.workflowName).toBe('test-workflow');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('retry');
    expect(result?.scope).toBe('run');
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-023 [P0] R1-F14 — worker-boundary proof: parent succeeds regardless
  // of detached worker outcome. The spawned child runs `workflow resume <id>`
  // which will fail (no real workflow engine), but the parent already emitted
  // success and exited 0.
  test('3.3D-CLI-023: retry dispatch parent exits 0 with success envelope even though detached worker will fail', async () => {
    const runId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'retry', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-024 [P1] R1-F14 — targeted-node retry success envelope
  test('3.3D-CLI-024: `workflow retry <failed-run> --node <id> --json` emits success envelope with scope=node', async () => {
    const runId = 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--node',
      'implement-story',
      '--json',
      '--correlation-id',
      'corr-cli-024-retry-node',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-024-retry-node');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('retry');
    expect(result?.scope).toBe('node');
    expect(result?.nodeId).toBe('implement-story');
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AC #6 — Consumer boundary: Archon adds no consumer classification code
// ---------------------------------------------------------------------------
describe('AC #6 consumer boundary — Archon has no consumer classification (Story 3.3d)', () => {
  test('packages/cli contains no UNEXPECTED_EXIT, SCHEMA_MISMATCH, or consumer TIMEOUT classification', async () => {
    const { readFileSync } = await import('node:fs');
    const { readdirSync, statSync } = await import('node:fs');
    const cliSrc = join(import.meta.dir, '..');

    function readAllTs(dir: string): string {
      let content = '';
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          content += readAllTs(full);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
          content += readFileSync(full, 'utf8');
        }
      }
      return content;
    }

    const allSource = readAllTs(cliSrc);
    expect(allSource).not.toContain("'UNEXPECTED_EXIT'");
    expect(allSource).not.toContain("'SCHEMA_MISMATCH'");
    // Consumer's TIMEOUT classification (not Archon's COMMAND_TIMEOUT):
    expect(allSource).not.toContain("code: 'TIMEOUT'");
  });
});
