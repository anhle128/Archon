import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

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

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const CLI_ENTRY = join(import.meta.dir, '..', 'cli.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string = REPO_ROOT): Promise<CliResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
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
});
