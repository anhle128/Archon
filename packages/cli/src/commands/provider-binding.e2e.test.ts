import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// RED-PHASE E2E SCAFFOLD (EXECUTABLE) — Story 3.1 "Implement Archon Workflow
// Provider Binding Lifecycle" — first-party consumer surface: a real
// controller (Hermes) invokes `archon provider-binding <verb> ... --json` as
// a subprocess and parses stdout. This is the ONLY user/client surface this
// story exposes (CLI-only, no HTTP route, no Web UI — Dev Notes "Scope
// Boundary").
//
// Unlike packages/cli/src/commands/v2-workflow-discovery.e2e.test.ts (which
// left a `declare function runCli` placeholder because "this repo has no
// subprocess CLI e2e harness yet"), this file provides a REAL `runCli()` via
// `Bun.spawn` rather than a placeholder — the harness itself (cli.ts, Bun)
// already exists. What does NOT exist yet is the `provider-binding` route:
// today `bun cli.ts provider-binding status ...` hits the `default:` case in
// cli.ts's command switch ("Unknown command") instead of returning a
// parseable envelope. Per this skill's red-phase rules, `test.skip()` is used
// here (not left executable) specifically because that route/dependency seam
// is missing — remove `.skip` once Task 1's `case 'provider-binding':`
// dispatch lands in cli.ts (Dev Notes "CLI command file" / "New CLI flags").
// The `runCli()` helper needs no changes to activate.
//
// This file intentionally does NOT import `./provider-binding` — it drives
// the real CLI entry point as an operator would.

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

describe('provider-binding CLI E2E — real subprocess (Story 3.1)', () => {
  test('malformed provider-binding JSON command still emits a single envelope outside a git repo', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['provider-binding', 'create', '--json'],
        cwd
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] as string) as {
        success: boolean;
        error: { code: string };
        execution: { exitCode: number };
      };
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('MALFORMED_REQUEST');
      expect(parsed.execution.exitCode).toBe(64);
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a missing string flag value does not swallow --json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        [
          'provider-binding',
          'create',
          '--provider',
          '--json',
          '--name',
          'workflow-engine-primary',
          '--project-ref',
          'workflow-engine',
          '--route',
          'https://hermes.example/events/workflow-engine',
        ],
        cwd
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] as string) as {
        provider: string;
        success: boolean;
        error: { code: string; details: { fieldErrors: Array<{ path: string; code: string }> } };
      };
      expect(exitCode).toBe(64);
      expect(parsed.provider).toBe('archon');
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('MALFORMED_REQUEST');
      expect(parsed.error.details.fieldErrors).toContainEqual({
        path: '/provider',
        code: 'required',
      });
      expect(stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('accepts --event-types with a valid workflow event type', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const { stdout, stderr } = await runCli(
        ['provider-binding', 'create', '--event-types', 'workflow.approval.requested', '--json'],
        cwd
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] as string) as {
        error?: { details?: { fieldErrors?: Array<{ path: string; code: string }> } };
      };
      expect(parsed.error?.details?.fieldErrors ?? []).not.toContainEqual({
        path: '/eventTypes',
        code: 'invalid',
      });
      expect(stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a missing --event-types value does not swallow --json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        [
          'provider-binding',
          'create',
          '--provider',
          'archon',
          '--name',
          'workflow-engine-primary',
          '--project-ref',
          'workflow-engine',
          '--route',
          'https://hermes.example/events/workflow-engine',
          '--event-types',
          '--json',
        ],
        cwd
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] as string) as {
        success: boolean;
        error: { code: string; details: { fieldErrors: Array<{ path: string; code: string }> } };
      };
      expect(exitCode).toBe(64);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('MALFORMED_REQUEST');
      expect(parsed.error.details.fieldErrors).toContainEqual({
        path: '/eventTypes',
        code: 'invalid',
      });
      expect(stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  for (const flag of ['--transform-file', '--receiver-headers-file'] as const) {
    test(`${flag} is parsed as a string option and a missing value never swallows --json`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
      try {
        const result = await runCli(['provider-binding', 'create', flag, '--json'], cwd);
        expect(result.stdout.trim().split('\n').filter(Boolean)).toHaveLength(1);
        expect(JSON.parse(result.stdout.trim())).toMatchObject({ success: false });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toBe('');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }

  test('unsupported provider-binding subcommand fails closed outside a git repo', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archon-provider-binding-no-git-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['provider-binding', 'remove', '--json'],
        cwd
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] as string) as {
        success: boolean;
        error: { details: { fieldErrors: Array<{ path: string; code: string }> } };
      };
      expect(exitCode).toBe(64);
      expect(parsed.success).toBe(false);
      expect(parsed.error.details.fieldErrors).toContainEqual({
        path: '/command',
        code: 'unsupported',
      });
      expect(stderr).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  // 3.1-CLI-007 [P0] — Actual argv for all five verbs emits one pure JSON
  // stdout document. Risk: R-002.
  //
  // NOTE: this asserts the DESIRED end state (a resolvable --project-ref).
  // Once implemented, activate this against a codebase actually registered
  // in the test DB (or point --cwd at a throwaway registered repo) rather
  // than assuming `workflow-engine` resolves in every environment.
  test.skip('`provider-binding status --provider archon --name x --json` prints exactly one JSON line and exits 0 or 1 (never crashes)', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'provider-binding',
      'status',
      '--provider',
      'archon',
      '--name',
      'workflow-engine-primary',
      '--json',
    ]);
    // --json discipline: stdout is EXACTLY the JSON payload, nothing else.
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0] as string)).not.toThrow();
    const parsed = JSON.parse(lines[0] as string) as { schemaVersion?: string };
    expect(parsed.schemaVersion).toBe('workflow-command-envelope.v1');
    // No Pino log lines leak into stderr in --json mode either.
    expect(stderr).toBe('');
    expect([0, 1]).toContain(exitCode);
  });

  for (const verb of ['create', 'update', 'rotate', 'disable'] as const) {
    // 3.1-CLI-007 [P0] continued — same purity guarantee for every mutating verb.
    test.skip(`\`provider-binding ${verb} --json\` prints exactly one JSON line, whatever the outcome`, async () => {
      const args = [
        'provider-binding',
        verb,
        '--provider',
        'archon',
        '--name',
        'workflow-engine-primary',
      ];
      if (verb === 'create' || verb === 'update') {
        args.push('--project-ref', 'workflow-engine', '--route', 'https://hermes.example/events/x');
      }
      args.push('--json');
      const { stdout, stderr } = await runCli(args);
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0] as string)).not.toThrow();
      expect(stderr).toBe('');
    });
  }

  // 3.1-CLI-008 [P0] — Actual malformed argv emits one failure document and
  // nonzero exit. Risk: R-002.
  test.skip('`provider-binding create --json` with no other flags emits exactly one failure JSON document and exits nonzero', async () => {
    const { stdout, stderr, exitCode } = await runCli(['provider-binding', 'create', '--json']);
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as { success: boolean; error: { code: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).not.toBe(0);
    expect(stderr).toBe('');
  });

  test.skip('an unsupported provider-binding subcommand (e.g. "remove") fails closed with a nonzero exit, not a silent no-op', async () => {
    const { exitCode, stdout } = await runCli(['provider-binding', 'remove', '--json']);
    expect(exitCode).not.toBe(0);
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout.trim()) as { success: boolean };
      expect(parsed.success).toBe(false);
    }
  });

  // 3.1-CLI-009 [P1] — New flags parse before/after the command name without
  // becoming positionals. Risk: R-004.
  test.skip('--provider/--name/--project-ref/--route/--correlation-id parse identically whether placed before or after "provider-binding status"', async () => {
    const before = await runCli([
      '--json',
      'provider-binding',
      'status',
      '--provider',
      'archon',
      '--name',
      'workflow-engine-primary',
    ]);
    const after = await runCli([
      'provider-binding',
      'status',
      '--provider',
      'archon',
      '--name',
      'workflow-engine-primary',
      '--json',
    ]);
    const beforeParsed = JSON.parse(before.stdout.trim()) as { bindingRef?: { name?: string } };
    const afterParsed = JSON.parse(after.stdout.trim()) as { bindingRef?: { name?: string } };
    // Both invocations must resolve the SAME binding name — if a flag value
    // were mis-parsed as a positional, `name`/`provider` would be undefined
    // or shifted, and the two calls would disagree.
    expect(beforeParsed.bindingRef?.name).toBe(afterParsed.bindingRef?.name);
  });
});
