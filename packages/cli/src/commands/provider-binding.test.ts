import { describe, test, expect, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// RED-PHASE SCAFFOLD (SKIPPED) — Story 3.1 "Implement Archon Workflow Provider
// Binding Lifecycle" (_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md).
//
// Target module `./provider-binding` (the CLI command file) does not exist
// yet (Task 1: create/status; Task 2: update; Task 3: rotate/disable; Task 4:
// malformed-input handling). Every test imports it dynamically INSIDE the
// (skipped) test body so the missing module is never resolved until a
// developer activates the test — a static import would crash the whole file.
//
// The `@archon/core/db/provider-bindings` mock below IS static and safe even
// though that module doesn't exist on disk yet: `mock.module()` registers an
// override for the specifier before Bun ever tries to resolve the real file
// (verified empirically against this Bun version), which is exactly what lets
// this scaffold pre-declare the DB-layer contract the CLI command will call.
//
// Activate by:
//   1. Adding packages/cli/src/commands/provider-binding.ts (create, status,
//      update, rotate, disable) per Dev Notes "Architecture & Conventions to
//      Follow" and "Contract Package" sections.
//   2. Wiring `provider`, `name`, `project-ref`, `route`, `correlation-id`
//      into cli.ts's parseArgs options map and the `case 'provider-binding':`
//      dispatch, next to `case 'workflow':` / `case 'isolation':`.
//   3. Removing `.skip` and switching the dynamic import to a static one.
//   4. Adding this file to its own isolated `bun test` line in
//      packages/cli/package.json's `test` script.

const CONTRACTS_DIR = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands'
);

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, name), 'utf8')) as Record<string, unknown>;
}

// Fields that are inherently dynamic per-invocation (correlationId when not
// supplied via --correlation-id, and every ISO timestamp) — excluded from
// exact-fixture-equality comparisons per the story's Testing Requirements.
const DYNAMIC_FIELDS = ['correlationId', 'issuedAt', 'observedAt', 'requestedAt'];

function stripDynamicFields(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  for (const key of DYNAMIC_FIELDS) delete copy[key];
  return copy;
}

const codebaseRow = {
  id: 'workflow-engine',
  name: 'workflow-engine',
  repository_url: 'https://github.com/oceanlabs/workflow-engine',
  default_cwd: '/repos/workflow-engine',
  default_branch: 'dev',
  ai_assistant_type: 'claude',
  commands: {},
  created_at: new Date('2026-07-11T11:48:27.000Z'),
  updated_at: new Date('2026-07-11T11:48:27.000Z'),
};

const bindingRow = {
  id: 'wpb-1',
  provider: 'archon',
  name: 'workflow-engine-primary',
  codebase_id: 'workflow-engine',
  event_route: 'https://hermes.example/events/workflow-engine',
  state: 'active',
  binding_version: 1,
  created_at: '2026-07-11T11:48:27.000Z',
  updated_at: '2026-07-11T11:48:27.000Z',
};

const mockCreateBinding = mock(() => Promise.resolve(bindingRow));
const mockUpdateBinding = mock(() => Promise.resolve(bindingRow));
const mockRotateBinding = mock(() =>
  Promise.resolve({
    ...bindingRow,
    state: 'rotated',
    binding_version: 2,
    previousVersion: 1,
    activeVersion: 2,
  })
);
const mockDisableBinding = mock(() =>
  Promise.resolve({ ...bindingRow, state: 'disabled', previousState: 'active' })
);
const mockGetBinding = mock(() => Promise.resolve(bindingRow));

mock.module('@archon/core/db/provider-bindings', () => ({
  createBinding: mockCreateBinding,
  updateBinding: mockUpdateBinding,
  rotateBinding: mockRotateBinding,
  disableBinding: mockDisableBinding,
  getBinding: mockGetBinding,
}));

mock.module('@archon/core/db/codebases', () => ({
  getCodebaseById: mock(() => Promise.resolve(codebaseRow)),
}));

mock.module('@archon/paths', () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    trace: mock(() => {}),
    fatal: mock(() => {}),
  })),
}));

describe('provider-binding CLI command (Story 3.1)', () => {
  describe('exact fixture conformance', () => {
    // 3.1-CLI-001 [P0] — Create output exactly matches command fixture.
    // Risk: R-001, R-002. RC-05/06.
    test.skip('create --json stdout structurally matches binding-create-success.json (excluding dynamic fields)', async () => {
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      const spy = (line: string): void => {
        logs.push(line);
      };
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/workflow-engine',
        },
        { json: true, log: spy }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-create-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    // 3.1-CLI-002 [P0] — Update output exactly matches command fixture.
    test.skip('update --json stdout structurally matches binding-update-success.json', async () => {
      const { providerBindingUpdateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingUpdateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/workflow-engine',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-update-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    // 3.1-CLI-003 [P0] — Status output exactly matches command fixture
    // (the only command-family status fixture models the active/valid case).
    test.skip('status --json stdout structurally matches binding-status-success.json for an active binding', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-status-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    // 3.1-CLI-004 [P0] — Rotate output exactly matches command fixture.
    // Risk includes R-008 (version-only, never a secret).
    test.skip('rotate --json stdout structurally matches binding-rotate-success.json', async () => {
      const { providerBindingRotateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingRotateCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-rotate-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    // 3.1-CLI-005 [P0] — Disable output exactly matches command fixture.
    test.skip('disable --json stdout structurally matches binding-disable-success.json', async () => {
      const { providerBindingDisableCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingDisableCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-disable-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    // 3.1-CLI-006 [P0] — Malformed output exactly matches error fixture and
    // redaction (execution.stdoutRedacted/stderrRedacted: true).
    test.skip('create with missing --provider/--name matches error-malformed-request.json shape', async () => {
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        { projectRef: 'workflow-engine', route: 'https://hermes.example/events/x' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('error-malformed-request.json');
      expect(output.success).toBe(false);
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });
  });

  describe('CONTRACT-001 — every live command validates against the command-envelope schema', () => {
    // 3.1-CONTRACT-001 [P0] — Closed top-level schema; bindingRef required on
    // every binding.* success. Risk: R-001, R-010.
    test.skip('success envelopes contain no keys beyond the closed workflow-command-envelope.schema.json top level', async () => {
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/workflow-engine',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const allowedTopLevelKeys = new Set([
        'schemaVersion',
        'intendedProducer',
        'intendedConsumer',
        'owningSubproject',
        'provider',
        'command',
        'correlationId',
        'issuedAt',
        'success',
        'workflowRunRef',
        'bindingRef',
        'result',
        'error',
        'execution',
      ]);
      for (const key of Object.keys(output)) {
        expect(allowedTopLevelKeys.has(key)).toBe(true);
      }
      expect(output).toHaveProperty('bindingRef');
      expect(output).not.toHaveProperty('error');
      expect(output.schemaVersion).toBe('workflow-command-envelope.v1');
      expect(output.command).toBe('binding.create');
    });

    test.skip('failure envelopes require `error` and omit `result`', async () => {
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {},
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      expect(output.success).toBe(false);
      expect(output).toHaveProperty('error');
      expect(output).not.toHaveProperty('result');
      expect(output).not.toHaveProperty('workflowRunRef');
    });
  });

  describe('project-ref resolution', () => {
    // 3.1-UNIT-006 [P0] — Ratified project-ref maps to stored codebase and
    // emitted string reference. Risk: R-004. Uses the story's documented
    // recommendation ("--project-ref value is the codebase id") — see
    // Dev Notes "Project-Ref Resolution"; TD marks the underlying
    // canonicalization decision itself as pending ratification for R-004/RC-08.
    test.skip('--project-ref resolves to the codebase row and emits bindingRef.projectRef as "project:<name>"', async () => {
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/workflow-engine',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as {
        bindingRef: { projectRef: string };
      };
      expect(typeof output.bindingRef.projectRef).toBe('string');
      expect(output.bindingRef.projectRef).toMatch(/^project:/);
    });

    // 3.1-UNIT-007 [P0] — Unknown/ambiguous project-ref fails before
    // mutation and never auto-registers (unlike `workflow run`).
    test.skip('unresolvable --project-ref fails MALFORMED_REQUEST and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const codebasesMod = await import('@archon/core/db/codebases');
      (
        codebasesMod.getCodebaseById as unknown as { mockResolvedValueOnce: (v: unknown) => void }
      ).mockResolvedValueOnce(null);
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'no-such-project',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });
  });

  describe('status state matrix', () => {
    // 3.1-UNIT-017 [P1] — Status conflicting with path-mismatch detail.
    // Risk: R-004, R-005.
    test.skip('supplying a --project-ref that resolves to a different codebase than the stored one reports state=conflicting with {path:"/repositoryPath",code:"path-mismatch"}', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon', name: 'workflow-engine-primary', projectRef: 'a-different-project' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as {
        result: { state: string; conflicts?: unknown[] };
      };
      expect(output.result.state).toBe('conflicting');
      expect(output.result.conflicts).toContainEqual({
        path: '/repositoryPath',
        code: 'path-mismatch',
      });
    });

    // 3.1-UNIT-018 [P1] — Stale is representable without speculative
    // detection (W-001): the type must allow 'stale' but no live path here
    // ever emits it.
    test.skip('the status result type accepts "stale" as a legal value even though no code path in this story produces it', async () => {
      const module = await import('./provider-binding');
      // Compile/shape-level guard: the exported status-state union includes
      // 'stale'. Activated once the type is exported for inspection.
      expect(module).toHaveProperty('BINDING_STATUS_STATES');
      const states = (module as unknown as { BINDING_STATUS_STATES: readonly string[] })
        .BINDING_STATUS_STATES;
      expect(states).toContain('stale');
    });
  });

  describe('malformed input (fail closed before any write)', () => {
    // 3.1-UNIT-020 [P0] — Missing provider+name matches malformed fixture
    // field errors.
    test.skip('create with both --provider and --name missing returns fieldErrors for /provider and /name, and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        { projectRef: 'workflow-engine', route: 'https://hermes.example/events/x' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as {
        error: { code: string; details: { fieldErrors: Array<{ path: string; code: string }> } };
      };
      expect(output.error.code).toBe('MALFORMED_REQUEST');
      const paths = output.error.details.fieldErrors.map(e => e.path);
      expect(paths).toContain('/provider');
      expect(paths).toContain('/name');
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-021 [P1] — Missing provider alone fails on a non-create verb.
    test.skip('status with --name but no --provider fails MALFORMED_REQUEST', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { name: 'workflow-engine-primary' } as unknown as { provider: string; name: string },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean; error: { code: string } };
      expect(output.success).toBe(false);
      expect(output.error.code).toBe('MALFORMED_REQUEST');
    });

    // 3.1-UNIT-022 [P1] — Missing name alone fails on a non-create verb.
    test.skip('status with --provider but no --name fails MALFORMED_REQUEST', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon' } as unknown as { provider: string; name: string },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean; error: { code: string } };
      expect(output.success).toBe(false);
      expect(output.error.code).toBe('MALFORMED_REQUEST');
    });

    // 3.1-UNIT-023 [P1] — Create missing project-ref fails before work.
    test.skip('create without --project-ref fails MALFORMED_REQUEST and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-024 [P1] — Create missing route fails before work.
    test.skip('create without --route fails MALFORMED_REQUEST and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        { provider: 'archon', name: 'workflow-engine-primary', projectRef: 'workflow-engine' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-025 [P1] — Update missing project-ref fails before work.
    test.skip('update without --project-ref fails MALFORMED_REQUEST and never calls updateBinding', async () => {
      mockUpdateBinding.mockClear();
      const { providerBindingUpdateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingUpdateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockUpdateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-026 [P1] — Update missing route fails before work.
    test.skip('update without --route fails MALFORMED_REQUEST and never calls updateBinding', async () => {
      mockUpdateBinding.mockClear();
      const { providerBindingUpdateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingUpdateCommand(
        { provider: 'archon', name: 'workflow-engine-primary', projectRef: 'workflow-engine' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockUpdateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-027/028/029 [P1] — Whitespace provider/name/route follow
    // explicit validation and never silently alias. BLOCKED: Pre-Implementation
    // Decision #2 (canonicalization) is not yet ratified — see
    // test-design-epic-3.md R-012. Assert only the non-negotiable floor:
    // whitespace-only values must not be silently treated as valid identity.
    test.skip('a whitespace-only --provider is rejected before any write (never treated as a valid identity)', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: '   ',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    test.skip('a whitespace-only --name is rejected before any write', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: '   ',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    test.skip('a whitespace-only --route fails before mutation', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: '   ',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });
  });

  describe('metadata (correlation / timestamps)', () => {
    // 3.1-UNIT-032 [P1] — Supplied correlation ID is preserved.
    test.skip('a supplied --correlation-id is echoed verbatim in the envelope', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          correlationId: 'corr_fixed_test_value',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { correlationId: string };
      expect(output.correlationId).toBe('corr_fixed_test_value');
    });

    // 3.1-UNIT-033 [P1] — Generated correlation ID and timestamps have valid
    // formats when --correlation-id is omitted.
    test.skip('an omitted --correlation-id is auto-generated as a UUID and issuedAt is a valid ISO date-time', async () => {
      const { providerBindingStatusCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { correlationId: string; issuedAt: string };
      expect(output.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(new Date(output.issuedAt).toISOString()).toBe(output.issuedAt);
    });
  });

  describe('security / compatibility (no forbidden fields)', () => {
    // 3.1-UNIT-034 [P0] — Output contains no secret, actor, or
    // Hermes-specific field anywhere in the envelope tree. Risk: R-008, R-010.
    test.skip('recursively scanning the full envelope finds no "actor", "secret", or Hermes-internal key at any depth', async () => {
      const { providerBindingRotateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingRotateCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const forbidden = /^(actor|secret|profile|agent_name|agent|agent_provider)$/i;
      const walk = (value: unknown): void => {
        if (value && typeof value === 'object') {
          for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            expect(forbidden.test(key)).toBe(false);
            walk(v);
          }
        }
      };
      walk(output);
    });
  });

  describe('dependency / partial failure', () => {
    // 3.1-UNIT-035 [P1] — Codebase lookup rejection emits failure and writes
    // nothing.
    test.skip('a thrown codebase lookup error produces a failure envelope and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const codebasesMod = await import('@archon/core/db/codebases');
      (
        codebasesMod.getCodebaseById as unknown as { mockRejectedValueOnce: (v: unknown) => void }
      ).mockRejectedValueOnce(new Error('db unreachable'));
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    // 3.1-UNIT-036 [P1] — Binding write rejection emits failure and no
    // success.
    test.skip('a thrown createBinding error produces a failure envelope, not a success with defaulted fields', async () => {
      mockCreateBinding.mockRejectedValueOnce(new Error('unique constraint violation'));
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
    });

    // 3.1-UNIT-038 [P1] — Injected timeout error maps to a machine envelope.
    // W-004: no active enforcement/cancellation exists — this only proves the
    // MAPPING behavior if a timeout-shaped error ever surfaces from the DB.
    test.skip('a DB-layer timeout-shaped error maps to category="timeout" (not a generic 500-style message)', async () => {
      const timeoutError = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
      mockCreateBinding.mockRejectedValueOnce(timeoutError);
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { error: { category: string } };
      expect(output.error.category).toBe('timeout');
    });

    // 3.1-UNIT-039 [P1] — Non-serializable error data is sanitized to valid
    // JSON (circular refs / BigInt / functions in error.details must not
    // break JSON.stringify and must not leak raw stack traces).
    test.skip('an error carrying non-JSON-serializable data (e.g. a circular object) still produces one valid parseable JSON line', async () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const weirdError = Object.assign(new Error('weird'), { details: circular });
      mockCreateBinding.mockRejectedValueOnce(weirdError);
      const { providerBindingCreateCommand } = await import('./provider-binding');
      const logs: string[] = [];
      await providerBindingCreateCommand(
        {
          provider: 'archon',
          name: 'workflow-engine-primary',
          projectRef: 'workflow-engine',
          route: 'https://hermes.example/events/x',
        },
        { json: true, log: (line: string) => logs.push(line) }
      );
      expect(logs).toHaveLength(1);
      expect(() => JSON.parse(logs[0] as string)).not.toThrow();
    });
  });

  describe('scope regression', () => {
    // 3.1-UNIT-040 [P1] — Remove/unsupported command fails closed.
    test.skip('there is no "remove" subcommand — the CLI module does not export a removal handler', async () => {
      const module = await import('./provider-binding');
      expect(module).not.toHaveProperty('providerBindingRemoveCommand');
      expect(module).not.toHaveProperty('providerBindingDeleteCommand');
    });
  });
});
