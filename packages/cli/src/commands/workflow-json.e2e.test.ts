import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
// `archon workflow resume/cancel/retry <run-id> --json` as a subprocess and
// parses stdout.
//
// Tests below drive the REAL CLI entry point (cli.ts) as a subprocess.
// Currently genuinely red: today's `workflow resume --json` with a missing
// run-id prints "Usage: ..." to stderr and exits 1 (no MALFORMED_REQUEST
// envelope); `workflow cancel` and `workflow retry` do not exist as
// subcommands at all (unknown subcommand → generic error).
//
// ACTIVATION: getWorkflowCommandEnvelopeCommand in cli.ts must map
// 'resume' → 'workflow.resume', 'cancel' → 'workflow.cancel', and
// 'retry' → 'workflow.retry'; the missing-run-id handler must emit a
// MALFORMED_REQUEST envelope in JSON mode; and new `case 'cancel'`/
// `case 'retry'` dispatch must exist.
// ---------------------------------------------------------------------------

describe('workflow resume/cancel/retry --json CLI dispatch E2E — real subprocess (Story 3.3d)', () => {
  // 3.3D-CLI-001 [P0] AC #5 — missing run-id on resume --json
  test('3.3D-CLI-001: `workflow resume --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '--json',
      '--correlation-id',
      'corr-3d-001',
    ]);

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

  // 3.3D-CLI-002 [P0] AC #5 — missing run-id on cancel --json
  test('3.3D-CLI-002: `workflow cancel --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '--json',
      '--correlation-id',
      'corr-3d-002',
    ]);

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

  // 3.3D-CLI-003 [P0] AC #5 — missing run-id on retry --json
  test('3.3D-CLI-003: `workflow retry --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '--json',
      '--correlation-id',
      'corr-3d-003',
    ]);

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

  // 3.3D-CLI-004 [P1] AC #5 — correlation-id threaded on resume --json
  test('3.3D-CLI-004: --correlation-id is echoed on a `workflow resume --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-3d-004-resume',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-3d-004-resume');
  });

  // 3.3D-CLI-005 [P1] AC #5 — correlation-id threaded on cancel --json
  test('3.3D-CLI-005: --correlation-id is echoed on a `workflow cancel --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-3d-005-cancel',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-3d-005-cancel');
  });

  // 3.3D-CLI-006 [P1] AC #5 — correlation-id threaded on retry --json
  test('3.3D-CLI-006: --correlation-id is echoed on a `workflow retry --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-3d-006-retry',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-3d-006-retry');
  });

  // 3.3D-CLI-007 [P0] AC #5 — blank correlation-id on resume emits MALFORMED_REQUEST
  test('3.3D-CLI-007: `workflow resume --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
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
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-008 [P0] AC #5 — blank correlation-id on cancel emits MALFORMED_REQUEST
  test('3.3D-CLI-008: `workflow cancel --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
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

  // 3.3D-CLI-009 [P0] AC #5 — blank correlation-id on retry emits MALFORMED_REQUEST
  test('3.3D-CLI-009: `workflow retry --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
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

  // 3.3D-CLI-010 [P1] AC #5 — invalid JSON flag (--json=true) on resume
  test('3.3D-CLI-010: `workflow resume --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-3d-010',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-3d-010');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-011 [P1] AC #5 — invalid JSON flag (--json=true) on cancel
  test('3.3D-CLI-011: `workflow cancel --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-3d-011',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-012 [P1] AC #5 — invalid JSON flag (--json=true) on retry
  test('3.3D-CLI-012: `workflow retry --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-3d-012',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-013 [P0] AC #5 — nonexistent --cwd emits envelope for resume
  test('3.3D-CLI-013: `workflow resume --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e-3d',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-014 [P0] AC #5 — nonexistent --cwd emits envelope for cancel
  test('3.3D-CLI-014: `workflow cancel --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e-3d',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-015 [P0] AC #5 — non-git directory emits MALFORMED_REQUEST for resume
  test('3.3D-CLI-015: `workflow resume --json` from non-git directory emits not_a_git_repository', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        [
          'workflow',
          'resume',
          '00000000-0000-0000-0000-000000000000',
          '--json',
          '--correlation-id',
          'corr-3d-015',
        ],
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
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-016 [P0] AC #5 — non-git directory emits MALFORMED_REQUEST for cancel
  test('3.3D-CLI-016: `workflow cancel --json` from non-git directory emits not_a_git_repository', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        [
          'workflow',
          'cancel',
          '00000000-0000-0000-0000-000000000000',
          '--json',
          '--correlation-id',
          'corr-3d-016',
        ],
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
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-017 [P1] AC #5 — bare --correlation-id consuming --json on resume
  test('3.3D-CLI-017: bare `--correlation-id` cannot consume `--json` and bypass the resume envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-018 [P1] AC #5 — bare --correlation-id consuming --json on cancel
  test('3.3D-CLI-018: bare `--correlation-id` cannot consume `--json` and bypass the cancel envelope path', async () => {
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

  // 3.3D-CLI-019 [P1] AC #5 — bare --correlation-id consuming --json on retry
  test('3.3D-CLI-019: bare `--correlation-id` cannot consume `--json` and bypass the retry envelope path', async () => {
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

  // 3.3D-CLI-020 [P0] R2-F2 — retry --node --json emits MALFORMED_REQUEST with /node fieldError
  test('3.3D-CLI-020: `workflow retry <id> --node --json` emits MALFORMED_REQUEST with fieldErrors /node', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--node',
      '--json',
      '--correlation-id',
      'corr-3d-020',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(error?.retryable).toBe(false);
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors?.[0]?.path).toBe('/node');
    expect(fieldErrors?.[0]?.code).toBe('invalid_value');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-021 [P0] R3-F1 — retry --json --node (node without value) emits MALFORMED_REQUEST, not TypeError
  test('3.3D-CLI-021: `workflow retry <id> --json --node` emits MALFORMED_REQUEST with /node missing_value', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--node',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors?.[0]?.path).toBe('/node');
    expect(fieldErrors?.[0]?.code).toBe('missing_value');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-022 [P0] R3-F3 — retry --json --cwd /nonexistent emits MALFORMED_REQUEST with directory_not_found
  test('3.3D-CLI-022: `workflow retry --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e-3d',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-023 [P0] R3-F3 — retry --json from non-git directory emits not_a_git_repository
  test('3.3D-CLI-023: `workflow retry --json` from non-git directory emits not_a_git_repository', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        [
          'workflow',
          'retry',
          '00000000-0000-0000-0000-000000000000',
          '--json',
          '--correlation-id',
          'corr-3d-023',
        ],
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
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-024 [P0] R4-F1 — resume with extra positional args emits MALFORMED_REQUEST
  test('3.3D-CLI-024: `workflow resume <id> extra --json` emits MALFORMED_REQUEST with unexpected_positional', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      'extra-arg',
      '--json',
      '--correlation-id',
      'corr-3d-024',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(error?.retryable).toBe(false);
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors?.[0]?.path).toBe('/run-id');
    expect(fieldErrors?.[0]?.code).toBe('unexpected_positional');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-025 [P0] R4-F1 — cancel with extra positional args emits MALFORMED_REQUEST
  test('3.3D-CLI-025: `workflow cancel <id> extra --json` emits MALFORMED_REQUEST with unexpected_positional', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      'extra-arg',
      '--json',
      '--correlation-id',
      'corr-3d-025',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors?.[0]?.path).toBe('/run-id');
    expect(fieldErrors?.[0]?.code).toBe('unexpected_positional');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-026 [P0] R4-F1 — retry with extra positional args emits MALFORMED_REQUEST
  test('3.3D-CLI-026: `workflow retry <id> extra --json` emits MALFORMED_REQUEST with unexpected_positional', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      'extra-arg',
      '--json',
      '--correlation-id',
      'corr-3d-026',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toBeDefined();
    expect(fieldErrors?.[0]?.path).toBe('/run-id');
    expect(fieldErrors?.[0]?.code).toBe('unexpected_positional');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });
});
