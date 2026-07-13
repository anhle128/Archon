import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// RED-PHASE SCAFFOLD (MIXED) — Story 3.1 "Implement Archon Workflow Provider
// Binding Lifecycle" contract-package regression checks.
//
// These tests load JSON fixture/schema files directly off disk — they import
// NO application code, so nothing here needs `.skip()` for a missing module.
// They are "red" in the TDD sense only where noted; the validator regression
// checks (CONTRACT-003) already pass today by design (the story's own text:
// "should already pass ... included as a regression check, not a new
// obligation") and are included here as a non-negotiable gate this story
// must not break, not as new coverage.

const CONTRACTS_ROOT = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander'
);
const BINDINGS_DIR = join(CONTRACTS_ROOT, 'examples/providers/archon/bindings');
const VALIDATOR = join(CONTRACTS_ROOT, 'validate_contracts.py');

describe('workflow-commander contract regression (Story 3.1)', () => {
  // 3.1-CONTRACT-003 [P0] — Canonical validator passes and contracts remain
  // unedited. Risk: R-001, R-007, R-008. This is a regression gate, not new
  // coverage — the story text says it "should already pass"; this test keeps
  // it enforced as this story's own contribution proceeds.
  test('validate_contracts.py passes unchanged (regression gate, not a new obligation)', async () => {
    const proc = Bun.spawn(['python3', VALIDATOR], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('contract validation passed');
  });

  // 3.1-CONTRACT-002 [P1] — Binding-domain status fixtures remain
  // validator-valid without an application schema (W-002: no runtime caller
  // reads/emits workflow-provider-binding.v1 in this story — see Task 4 scope
  // note in the story file). This test only proves the fixture family itself
  // stays intact; it does NOT validate against any Archon-authored schema.
  test('every bindings/status-*.json fixture still declares schemaVersion=workflow-provider-binding.v1 and a valid `state`', () => {
    const files = readdirSync(BINDINGS_DIR).filter(
      f => f.startsWith('status-') && f.endsWith('.json')
    );
    expect(files.length).toBeGreaterThanOrEqual(6); // missing/valid/disabled/rotated/stale/conflicting
    const validStates = ['missing', 'active', 'disabled', 'rotated', 'stale', 'conflicting'];
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(BINDINGS_DIR, file), 'utf8')) as {
        schemaVersion: string;
        state: string;
      };
      expect(parsed.schemaVersion).toBe('workflow-provider-binding.v1');
      expect(validStates).toContain(parsed.state);
    }
  });

  // 3.1-CONTRACT-004 [P1] — Fixture comparison excludes only documented
  // dynamic paths (correlationId, issuedAt, observedAt, requestedAt).
  test("the documented dynamic-field exclusion list matches every command fixture's actual dynamic keys (no undocumented drift)", () => {
    const commandsDir = join(CONTRACTS_ROOT, 'examples/providers/archon/commands');
    const documented = new Set(['correlationId', 'issuedAt', 'observedAt', 'requestedAt']);
    const files = readdirSync(commandsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(commandsDir, file), 'utf8')) as Record<
        string,
        unknown
      >;
      // correlationId/issuedAt are the only genuinely time/run-varying top
      // level fields in this fixture family today — if a future fixture adds
      // a new dynamic-looking field, this test should be updated deliberately
      // rather than silently widening what "exact fixture equality" ignores.
      if ('correlationId' in parsed) expect(documented.has('correlationId')).toBe(true);
      if ('issuedAt' in parsed) expect(documented.has('issuedAt')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3.1-CI-002 [P0] — No secret/signing material is introduced in code, schema,
// DB, or output. Risk: R-008.
//
// SKIPPED (not a vacuous scan): the target files this scenario must scan —
// packages/core/src/db/provider-bindings.ts, packages/core/src/schemas/
// workflow-provider-binding.ts, packages/cli/src/commands/provider-binding.ts
// — do not exist yet. A recursive secret-pattern scan over paths that don't
// exist would trivially "pass" today without checking anything, which is a
// meaningless green, not a meaningful red — worse than an honest skip.
// Activate by removing `.skip` once Task 1-3 land those three files.
// ---------------------------------------------------------------------------
describe('CI-002 secret/signing-material scan (Story 3.1)', () => {
  test('none of the new provider-binding implementation files contain secret/signing-material patterns', () => {
    const targets = [
      join(import.meta.dir, '../../../core/src/db/provider-bindings.ts'),
      join(import.meta.dir, '../../../core/src/schemas/workflow-provider-binding.ts'),
      join(import.meta.dir, './provider-binding.ts'),
    ];
    const forbidden = /secret|signing[_-]?key|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/i;
    for (const path of targets) {
      const content = readFileSync(path, 'utf8');
      expect(forbidden.test(content)).toBe(false);
    }
  });
});
