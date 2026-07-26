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
// DB, or output. Risk: R-008. Story 3.1's three target files now exist, so
// this scan runs for real (not vacuously) on all of them.
//
// 3.3A-CI-049 [P0, R-012] extends this same scan to the new Story 3.3a shared
// envelope module. That file does not exist yet
// (packages/cli/src/commands/workflow-provider-command-envelope.ts), so this
// test is RED today via a genuine `readFileSync` ENOENT — not a vacuous pass
// — and turns green the moment Task 1 creates the file without secret
// material in it. Do not remove this target to make the test pass; create
// the file instead.
// ---------------------------------------------------------------------------
describe('CI-002 / 3.3A-CI-049 secret/signing-material scan (Stories 3.1 and 3.3a)', () => {
  test('public provider-binding files do not expose signing secret fields or raw signing material', () => {
    const publicTargets = [
      join(import.meta.dir, '../../../core/src/schemas/workflow-provider-binding.ts'),
      join(import.meta.dir, './provider-binding.ts'),
      join(import.meta.dir, './workflow-provider-command-envelope.ts'),
    ];
    const rawMaterial = /sk-|ghp_|whsec_|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/i;
    const publicSecretField = /signing_secret|secretRef/i;
    for (const path of publicTargets) {
      const content = readFileSync(path, 'utf8');
      expect(rawMaterial.test(content)).toBe(false);
      expect(publicSecretField.test(content)).toBe(false);
    }

    const privateDbTarget = join(import.meta.dir, '../../../core/src/db/provider-bindings.ts');
    const privateDbContent = readFileSync(privateDbTarget, 'utf8');
    const rawPrivateMaterial =
      /sk-|ghp_|whsec_|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/i;
    expect(rawPrivateMaterial.test(privateDbContent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3.3A-UNIT-017 [P1, R-008] — Production CLI code does not import
// `_bmad-output` planning artifacts, fixtures, schemas, or validator scripts
// at runtime (Dev Notes: "Production CLI code should not import `_bmad-output`
// planning artifacts at runtime; use typed constants in source and test them
// against the contract schema.").
//
// RED via genuine ENOENT until Task 1 creates
// packages/cli/src/commands/workflow-provider-command-envelope.ts — this is
// intentionally not `.skip()`-ed because the scan mechanism (readFileSync +
// regex) already exists as a boundary; only the target file is missing, and
// a missing-file failure here is a meaningful, not vacuous, red signal.
// ---------------------------------------------------------------------------
describe('3.3A-UNIT-017 no production _bmad-output import in the shared envelope module', () => {
  test('workflow-provider-command-envelope.ts does not import from `_bmad-output`', () => {
    const path = join(import.meta.dir, './workflow-provider-command-envelope.ts');
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('_bmad-output');
  });
});

// ---------------------------------------------------------------------------
// 3.3A-UNIT-031 [P1, R-004] — Duplicate local envelope helpers are removed
// from provider-binding.ts once it consumes the shared module (Task 2:
// "Remove the duplicated local buildSuccessEnvelope, buildErrorEnvelope,
// safeStringify, resolveCorrelationId, and resolveIssuedAt implementations
// from provider-binding.ts.").
//
// RED TODAY (not skipped): provider-binding.ts currently defines all five of
// these locally (Story 3.1's intentional temporary duplication per W-007).
// This is an executable regression lock, not a missing-module scaffold — the
// target file already exists, so this test genuinely fails right now and
// will pass only once Task 2's refactor deletes the local definitions in
// favor of importing them from workflow-provider-command-envelope.ts.
// ---------------------------------------------------------------------------
describe('3.3A-UNIT-031 provider-binding.ts no longer defines its own envelope helpers after the refactor', () => {
  test('provider-binding.ts source contains no local buildSuccessEnvelope/buildErrorEnvelope/safeStringify/resolveCorrelationId/resolveIssuedAt function declarations', () => {
    const content = readFileSync(join(import.meta.dir, './provider-binding.ts'), 'utf8');
    const localHelperDeclarations = [
      'function buildSuccessEnvelope(',
      'function buildErrorEnvelope(',
      'function safeStringify(',
      'function resolveCorrelationId(',
      'function resolveIssuedAt(',
    ];
    for (const declaration of localHelperDeclarations) {
      expect(content).not.toContain(declaration);
    }
  });
});
