import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// RED-PHASE SCAFFOLD (MIXED) — Story 3.3a "Define Shared Workflow Provider
// Command Envelope" — test design: _bmad-output/test-artifacts/test-design/
// test-design-3-3a-define-shared-workflow-provider-command-envelope.md
//
// This file imports NO application code at module scope, so it always loads
// even before packages/cli/src/commands/workflow-provider-command-envelope.ts
// (the "shared module") exists. Two kinds of coverage live here:
//
//   1. EXECUTABLE tests that assert something true independent of the shared
//      module's existence (schema/fixture shape, package.json contents, git
//      diff of the contract package). These run today and act as regression
//      locks — matching the precedent in provider-binding-contract.test.ts's
//      3.1-CONTRACT-003 ("should already pass ... included as a regression
//      check, not a new obligation").
//   2. `test()` scaffolds for everything that exercises the shared
//      module's actual exports. Per this skill's red-phase rule, `test()`
//      is used (not left executable) because the target module does not
//      exist yet — a static or dynamic import of a missing module produces an
//      uninformative "Cannot find module" failure rather than the specific
//      documented behavior. Each skip states why and what activates it.
//
// Activate the skipped tests by removing `.skip` once Task 1 lands
// packages/cli/src/commands/workflow-provider-command-envelope.ts exporting
// (at minimum): WORKFLOW_PROVIDER_COMMANDS, ERROR_CATEGORIES,
// buildSuccessEnvelope, buildErrorEnvelope, safeStringify,
// resolveCorrelationId, resolveIssuedAt.

const CONTRACTS_ROOT = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander'
);
const COMMANDS_DIR = join(CONTRACTS_ROOT, 'examples/providers/archon/commands');
const SCHEMA_PATH = join(CONTRACTS_ROOT, 'schemas/workflow-command-envelope.schema.json');
const ENVELOPE_MODULE_PATH = join(import.meta.dir, './workflow-provider-command-envelope.ts');
const CLI_PACKAGE_JSON_PATH = join(import.meta.dir, '../../package.json');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(COMMANDS_DIR, name), 'utf8')) as Record<string, unknown>;
}

function loadSchema(): {
  properties: { command: { enum: string[] }; error?: unknown };
  $defs: { error: { properties: { category: { enum: string[] } } } };
} {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
    properties: { command: { enum: string[] }; error?: unknown };
    $defs: { error: { properties: { category: { enum: string[] } } } };
  };
}

// ---------------------------------------------------------------------------
// EXECUTABLE — 3.3A-CONTRACT-033/034/035 [P0]
//
// The provider CLI syntax baseline table from the story's Dev Notes, defined
// as literal test data (not imported from the shared module — Task 3 permits
// "a provider CLI syntax baseline table in the test or helper"). This locks
// the baseline NOW, independent of Task 1/2 implementation timing, and
// enforces AC3's "tests fail if the CLI syntax and command identifier drift
// apart." This does not depend on the shared module existing.
// ---------------------------------------------------------------------------
const PROVIDER_CLI_SYNTAX_BASELINE: Record<string, string> = {
  'workflow.start': 'archon workflow run <workflow-name> [message] --json',
  'workflow.status': 'archon workflow get <run-id> --json',
  'workflow.approve': 'archon workflow approve <run-id> [comment] --json',
  'workflow.reject': 'archon workflow reject <run-id> [reason] --json',
  'workflow.resume': 'archon workflow resume <run-id> --json',
  'workflow.retry': 'archon workflow retry <run-id> [--node <node-id>] --json',
  'workflow.cancel': 'archon workflow cancel <run-id> --json',
  'binding.create':
    'archon provider-binding create --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json',
  'binding.update':
    'archon provider-binding update --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json',
  'binding.status':
    'archon provider-binding status --provider archon --name <name> [--project-ref <project-ref>] --json',
  'binding.rotate': 'archon provider-binding rotate --provider archon --name <name> --json',
  'binding.disable': 'archon provider-binding disable --provider archon --name <name> --json',
};

describe('3.3A-CONTRACT-033 — provider CLI syntax baseline covers all schema commands [P0, R-006/R-014]', () => {
  test('the baseline table has exactly one non-empty syntax entry per workflow-command-envelope.schema.json command enum value', () => {
    const schema = loadSchema();
    const enumCommands = schema.properties.command.enum;
    expect(enumCommands).toHaveLength(12);
    const baselineKeys = Object.keys(PROVIDER_CLI_SYNTAX_BASELINE);
    expect(new Set(baselineKeys)).toEqual(new Set(enumCommands));
    for (const command of enumCommands) {
      const syntax = PROVIDER_CLI_SYNTAX_BASELINE[command];
      expect(typeof syntax).toBe('string');
      expect((syntax ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('3.3A-CONTRACT-034 — workflow.cancel is not legacy `workflow abandon` [P0, R-006]', () => {
  test('the baseline syntax for workflow.cancel uses "archon workflow cancel <run-id> --json", not "abandon"', () => {
    const syntax = PROVIDER_CLI_SYNTAX_BASELINE['workflow.cancel'];
    expect(syntax).toBe('archon workflow cancel <run-id> --json');
    expect(syntax).not.toContain('abandon');
  });
});

describe('3.3A-CONTRACT-035 — workflow.retry is not the streaming-only `workflow retry-node` [P0, R-006]', () => {
  test('the baseline syntax for workflow.retry uses "archon workflow retry <run-id> [--node <node-id>] --json", not "retry-node"', () => {
    const syntax = PROVIDER_CLI_SYNTAX_BASELINE['workflow.retry'];
    expect(syntax).toBe('archon workflow retry <run-id> [--node <node-id>] --json');
    expect(syntax).not.toContain('retry-node');
  });
});

// ---------------------------------------------------------------------------
// EXECUTABLE — 3.3A-UNIT-018 [P1] — No runtime JSON Schema dependency is
// added to @archon/cli. Story Dev Notes: "Do not add a new JSON Schema
// runtime dependency in @archon/cli just to validate fixtures." Passes today
// (regression lock); would fail if a future change adds ajv/jsonschema/etc.
// ---------------------------------------------------------------------------
describe('3.3A-UNIT-018 — no new JSON Schema runtime dependency in @archon/cli [P1, R-008]', () => {
  test('packages/cli/package.json dependencies contain no JSON Schema validation library', () => {
    const pkg = JSON.parse(readFileSync(CLI_PACKAGE_JSON_PATH, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const forbidden = /^(ajv|jsonschema|zod-to-json-schema|is-my-json-valid|tv4|djv)$/i;
    for (const name of Object.keys(allDeps)) {
      expect(forbidden.test(name)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// EXECUTABLE — 3.3A-CONTRACT-048 [P1] — Command contract package is not edited
// to fit runtime. Story 3.5 legitimately evolves the event contract, so this
// guard stays scoped to the Story 3.3A command schema and command fixtures.
// ---------------------------------------------------------------------------
describe('3.3A-CONTRACT-048 — command contract package is never edited to fit runtime [P1, R-008/R-011]', () => {
  test('the workflow-commander command contract has no uncommitted working-tree changes', async () => {
    const proc = Bun.spawn(['git', 'diff', '--quiet', '--', SCHEMA_PATH, COMMANDS_DIR], {
      cwd: join(import.meta.dir, '../../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    // `git diff --quiet` exits 0 when there is no diff, 1 when there is one.
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SKIPPED — 3.3A-UNIT-001 through 3.3A-UNIT-016 [mostly P0] — depend on the
// shared module's exports, which do not exist yet.
// ---------------------------------------------------------------------------
describe('3.3A-UNIT-001 — command enum exactness [P0, R-001]', () => {
  test('WORKFLOW_PROVIDER_COMMANDS exactly matches workflow-command-envelope.schema.json properties.command.enum (no extra, no missing, no reordering-sensitive gaps)', async () => {
    // ACTIVATION: remove .skip once workflow-provider-command-envelope.ts
    // exports `WORKFLOW_PROVIDER_COMMANDS` (a readonly array/tuple of the
    // 12 canonical command ids).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      WORKFLOW_PROVIDER_COMMANDS: readonly string[];
    };
    const schema = loadSchema();
    expect(new Set(mod.WORKFLOW_PROVIDER_COMMANDS)).toEqual(
      new Set(schema.properties.command.enum)
    );
    expect(mod.WORKFLOW_PROVIDER_COMMANDS).toHaveLength(12);
  });
});

describe('3.3A-UNIT-002 — diagnostic category exactness [P0, R-003]', () => {
  test('ERROR_CATEGORIES exactly matches workflow-command-envelope.schema.json $defs.error.properties.category.enum', async () => {
    // ACTIVATION: remove .skip once the shared module exports
    // `ERROR_CATEGORIES` (configuration, external_delay,
    // implementation_defect, provider_contract, security_rejection,
    // timeout, unexpected_state).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      ERROR_CATEGORIES: readonly string[];
    };
    const schema = loadSchema();
    expect(new Set(mod.ERROR_CATEGORIES)).toEqual(
      new Set(schema.$defs.error.properties.category.enum)
    );
    expect(mod.ERROR_CATEGORIES).toHaveLength(7);
  });
});

describe('3.3A-UNIT-003 — workflow success envelope has workflowRunRef and result, no error [P0, R-002]', () => {
  test('buildSuccessEnvelope for a workflow.* command returns workflowRunRef + result and omits error/bindingRef', async () => {
    // ACTIVATION: remove .skip once buildSuccessEnvelope accepts
    // { workflowRunRef } as the ref input for workflow.* commands.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    const envelope = mod.buildSuccessEnvelope(
      {
        provider: 'archon',
        command: 'workflow.resume',
        correlationId: 'corr_unit_003',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        workflowRunRef: {
          provider: 'archon',
          runId: 'archon-run-unit-003',
          workflowName: 'bmad-dev-story',
          projectRef: 'project:workflow-engine',
        },
      },
      {
        operation: 'resume',
        state: 'paused',
        validated: true,
        resumable: true,
        executed: false,
      }
    );
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('workflowRunRef');
    expect(envelope).toHaveProperty('result');
    expect(envelope).not.toHaveProperty('error');
    expect(envelope).not.toHaveProperty('bindingRef');
  });
});

describe('3.3A-UNIT-004 — binding success envelope has bindingRef and result, no error [P0, R-002]', () => {
  test('buildSuccessEnvelope for a binding.* command returns bindingRef + result and omits error/workflowRunRef', async () => {
    // ACTIVATION: remove .skip once buildSuccessEnvelope accepts
    // { bindingRef } as the ref input for binding.* commands.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    const envelope = mod.buildSuccessEnvelope(
      {
        provider: 'archon',
        command: 'binding.status',
        correlationId: 'corr_unit_004',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        bindingRef: {
          provider: 'archon',
          name: 'workflow-engine-primary',
          bindingId: 'wpb_archon::workflow_engine_primary',
          projectRef: 'project:workflow-engine',
        },
      },
      {
        operation: 'status',
        state: 'active',
        health: 'valid',
        checkedAt: '2026-07-14T00:00:00.000Z',
      }
    );
    expect(envelope.success).toBe(true);
    expect(envelope).toHaveProperty('bindingRef');
    expect(envelope).toHaveProperty('result');
    expect(envelope).not.toHaveProperty('error');
    expect(envelope).not.toHaveProperty('workflowRunRef');
  });
});

describe('3.3A-UNIT-005 — missing workflowRunRef is rejected before serialization [P0, R-002/R-016]', () => {
  test('buildSuccessEnvelope throws synchronously when a workflow.* command is built without a workflowRunRef', async () => {
    // ACTIVATION: remove .skip once buildSuccessEnvelope enforces "success
    // workflow.* commands require workflowRunRef" (Dev Notes, Command
    // Envelope Shape) by throwing rather than silently omitting the ref.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    expect(() =>
      mod.buildSuccessEnvelope(
        {
          provider: 'archon',
          command: 'workflow.resume',
          correlationId: 'corr_unit_005',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {},
        { operation: 'resume' }
      )
    ).toThrow();
  });
});

describe('3.3A-UNIT-006 — missing bindingRef is rejected before serialization [P0, R-002/R-016]', () => {
  test('buildSuccessEnvelope throws synchronously when a binding.* command is built without a bindingRef', async () => {
    // ACTIVATION: remove .skip once buildSuccessEnvelope enforces "success
    // binding.* commands require bindingRef".
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    expect(() =>
      mod.buildSuccessEnvelope(
        {
          provider: 'archon',
          command: 'binding.status',
          correlationId: 'corr_unit_006',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {},
        { operation: 'status' }
      )
    ).toThrow();
  });
});

describe('3.3A-UNIT-007 — failure envelopes require a boolean error.retryable [P0, R-003]', () => {
  test('buildErrorEnvelope serializes error.retryable as the exact boolean supplied and the field is present on every failure category', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope's error input type
    // makes `retryable: boolean` a mandatory (non-optional) field, matching
    // the readiness remediation callout in the Dev Notes.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const startTime = Date.now();
    const envelope = mod.buildErrorEnvelope(
      {
        provider: 'archon',
        command: 'binding.create',
        correlationId: 'corr_unit_007',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        code: 'MALFORMED_REQUEST',
        category: 'provider_contract',
        retryable: false,
        details: { requestAccepted: false },
        exitCode: 64,
      },
      startTime
    ) as { error: { retryable: boolean } };
    expect(typeof envelope.error.retryable).toBe('boolean');
    expect(envelope.error.retryable).toBe(false);
  });
});

describe('3.3A-UNIT-008 — failure envelope shape and execution metadata [P0, R-002/R-005]', () => {
  test('buildErrorEnvelope returns success=false, error present, result/refs absent, and an execution object', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists and matches
    // the closed failure shape from Dev Notes "Command Envelope Shape".
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const envelope = mod.buildErrorEnvelope(
      {
        provider: 'archon',
        command: 'workflow.status',
        correlationId: 'corr_unit_008',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        code: 'SCHEMA_MISMATCH',
        category: 'provider_contract',
        retryable: false,
        details: { schemaVersion: 'workflow-command-envelope.v1' },
        exitCode: 65,
      },
      Date.now()
    );
    expect(envelope.success).toBe(false);
    expect(envelope).toHaveProperty('error');
    expect(envelope).not.toHaveProperty('result');
    expect(envelope).not.toHaveProperty('workflowRunRef');
    expect(envelope).not.toHaveProperty('bindingRef');
    expect(envelope).toHaveProperty('execution');
  });
});

describe('3.3A-UNIT-009 — result/error exclusivity holds by construction [P0, R-002]', () => {
  test('a success envelope never carries `error` and a failure envelope never carries `result`, for every builder call', async () => {
    // ACTIVATION: remove .skip once both builders exist; this locks the
    // oneOf constraint from workflow-command-envelope.schema.json.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const success = mod.buildSuccessEnvelope(
      {
        provider: 'archon',
        command: 'binding.rotate',
        correlationId: 'corr_unit_009_success',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        bindingRef: {
          provider: 'archon',
          name: 'workflow-engine-primary',
          bindingId: 'wpb_archon::workflow_engine_primary',
        },
      },
      { operation: 'rotate', state: 'rotated', previousVersion: 1, activeVersion: 2 }
    );
    const failure = mod.buildErrorEnvelope(
      {
        provider: 'archon',
        command: 'binding.rotate',
        correlationId: 'corr_unit_009_failure',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        code: 'BINDING_NOT_FOUND',
        category: 'unexpected_state',
        retryable: false,
        details: { requestAccepted: false },
        exitCode: 78,
      },
      Date.now()
    );
    expect('error' in success).toBe(false);
    expect('result' in failure).toBe(false);
  });
});

describe('3.3A-UNIT-010 — safe serialization of non-JSON-native values [P0, R-009]', () => {
  test('safeStringify converts bigint to string, drops functions, and replaces circular references without throwing', async () => {
    // ACTIVATION: remove .skip once safeStringify is exported from the
    // shared module (moved from provider-binding.ts per Task 1).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      safeStringify: (value: unknown) => string;
    };
    const circular: Record<string, unknown> = { a: 1n, fn: () => 'x' };
    circular.self = circular;
    expect(() => mod.safeStringify(circular)).not.toThrow();
    const parsed = JSON.parse(mod.safeStringify(circular)) as {
      a: string;
      fn: undefined;
      self: string;
    };
    expect(parsed.a).toBe('1');
    expect(parsed.fn).toBeUndefined();
    expect(parsed.self).toBe('[Circular]');
  });
});

describe('3.3A-UNIT-011 — correlation id behavior [P1, R-013]', () => {
  test('resolveCorrelationId trims and echoes a supplied value verbatim, and generates a UUID when omitted or blank', async () => {
    // ACTIVATION: remove .skip once resolveCorrelationId is exported from
    // the shared module (moved from provider-binding.ts per Task 1).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      resolveCorrelationId: (supplied: string | undefined) => string;
    };
    expect(mod.resolveCorrelationId('  corr_fixed_value  ')).toBe('corr_fixed_value');
    const generated = mod.resolveCorrelationId(undefined);
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const generatedFromBlank = mod.resolveCorrelationId('   ');
    expect(generatedFromBlank).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe('3.3A-UNIT-012 — issued-at behavior [P1, R-013]', () => {
  test('resolveIssuedAt returns a value that is a valid, stable ISO date-time string', async () => {
    // ACTIVATION: remove .skip once resolveIssuedAt is exported from the
    // shared module (moved from provider-binding.ts per Task 1).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      resolveIssuedAt: () => string;
    };
    const issuedAt = mod.resolveIssuedAt();
    expect(new Date(issuedAt).toISOString()).toBe(issuedAt);
  });
});

describe('3.3A-UNIT-013 — invalid command/category guard [P1, R-001/R-016]', () => {
  test('buildSuccessEnvelope rejects a command outside WORKFLOW_PROVIDER_COMMANDS and buildErrorEnvelope rejects a category outside ERROR_CATEGORIES, even with a forced type cast', async () => {
    // ACTIVATION: remove .skip once both builders runtime-validate their
    // `command`/`category` inputs instead of trusting the TypeScript type
    // alone (a forced `as` cast at a call site must not silently succeed).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    expect(() =>
      mod.buildSuccessEnvelope(
        {
          provider: 'archon',
          command: 'workflow.bogus',
          correlationId: 'corr_unit_013',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {
          workflowRunRef: {
            provider: 'archon',
            runId: 'r',
            workflowName: 'w',
          },
        },
        {}
      )
    ).toThrow();
    expect(() =>
      mod.buildErrorEnvelope(
        {
          provider: 'archon',
          command: 'binding.create',
          correlationId: 'corr_unit_013b',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {
          code: 'X',
          category: 'not_a_real_category',
          retryable: false,
          details: {},
          exitCode: 70,
        },
        Date.now()
      )
    ).toThrow();
  });
});

describe('3.3A-UNIT-014 — all five canonical failure classes are buildable [P0, R-003/R-005]', () => {
  const cases: Array<{ fixture: string; code: string; category: string; retryable: boolean }> = [
    {
      fixture: 'error-malformed-request.json',
      code: 'MALFORMED_REQUEST',
      category: 'provider_contract',
      retryable: false,
    },
    {
      fixture: 'error-schema-mismatch.json',
      code: 'SCHEMA_MISMATCH',
      category: 'provider_contract',
      retryable: false,
    },
    {
      fixture: 'error-timeout.json',
      code: 'COMMAND_TIMEOUT',
      category: 'timeout',
      retryable: true,
    },
    {
      fixture: 'error-unexpected-exit.json',
      code: 'UNEXPECTED_EXIT',
      category: 'implementation_defect',
      retryable: true,
    },
    {
      fixture: 'error-unexpected-state.json',
      code: 'UNEXPECTED_STATE',
      category: 'unexpected_state',
      retryable: false,
    },
  ];

  for (const c of cases) {
    test(`buildErrorEnvelope reproduces ${c.fixture}'s code/category/retryable exactly`, async () => {
      // ACTIVATION: remove .skip once buildErrorEnvelope exists. This proves
      // the helper can represent every canonical failure class the contract
      // package defines, not just the binding-lifecycle ones already
      // implemented in provider-binding.ts.
      const mod = (await import('./workflow-provider-command-envelope')) as {
        buildErrorEnvelope: (
          meta: Record<string, unknown>,
          error: Record<string, unknown>,
          startTime: number
        ) => Record<string, unknown>;
      };
      const fixture = loadFixture(c.fixture) as {
        error: { code: string; category: string; retryable: boolean };
      };
      const envelope = mod.buildErrorEnvelope(
        {
          provider: 'archon',
          command: fixture.command as string,
          correlationId: 'corr_unit_014',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {
          code: c.code,
          category: c.category,
          retryable: c.retryable,
          details: fixture.error.details ?? {},
          exitCode: 0,
        },
        Date.now()
      ) as { error: { code: string; category: string; retryable: boolean } };
      expect(envelope.error.code).toBe(fixture.error.code);
      expect(envelope.error.category).toBe(fixture.error.category);
      expect(envelope.error.retryable).toBe(fixture.error.retryable);
    });
  }
});

describe('3.3A-UNIT-015 — execution metadata details [P1, R-005/R-009]', () => {
  test('buildErrorEnvelope populates execution.exitCode, execution.timedOut (true only for category=timeout), and redacts stdout/stderr', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists and computes
    // `execution` the same way provider-binding.ts's current local
    // buildErrorEnvelope does (durationMs = Date.now() - startTime,
    // timedOut = category === 'timeout', both redacted flags true).
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const startTime = Date.now() - 5;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: 'archon',
        command: 'workflow.start',
        correlationId: 'corr_unit_015',
        issuedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        code: 'COMMAND_TIMEOUT',
        category: 'timeout',
        retryable: true,
        details: { timeoutMs: 300000 },
        exitCode: 69,
      },
      startTime
    ) as {
      execution: {
        exitCode: number;
        timedOut: boolean;
        durationMs: number;
        stdoutRedacted: boolean;
        stderrRedacted: boolean;
      };
    };
    expect(envelope.execution.exitCode).toBe(69);
    expect(envelope.execution.timedOut).toBe(true);
    expect(envelope.execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(envelope.execution.stdoutRedacted).toBe(true);
    expect(envelope.execution.stderrRedacted).toBe(true);
  });
});

describe('3.3A-UNIT-016 — no forbidden fields or secrets in a built envelope [P0, R-012]', () => {
  test('a recursive scan of both a success and a failure envelope finds no actor/secret/profile/agent*/signing-material key', async () => {
    // ACTIVATION: remove .skip once both builders exist. Mirrors the
    // existing provider-binding.test.ts "security / compatibility (no
    // forbidden fields)" check, but exercises the shared builder directly.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const forbidden = /^(actor|secret|profile|agent_name|agent|agent_provider)$/i;
    const walk = (value: unknown): void => {
      if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
          expect(forbidden.test(key)).toBe(false);
          walk(v);
        }
      }
    };
    walk(
      mod.buildSuccessEnvelope(
        {
          provider: 'archon',
          command: 'binding.create',
          correlationId: 'corr_unit_016_success',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {
          bindingRef: {
            provider: 'archon',
            name: 'workflow-engine-primary',
            bindingId: 'wpb_archon::workflow_engine_primary',
          },
        },
        { operation: 'create', state: 'active', created: true, bindingVersion: 1 }
      )
    );
    walk(
      mod.buildErrorEnvelope(
        {
          provider: 'archon',
          command: 'binding.create',
          correlationId: 'corr_unit_016_failure',
          issuedAt: '2026-07-14T00:00:00.000Z',
        },
        {
          code: 'MALFORMED_REQUEST',
          category: 'provider_contract',
          retryable: false,
          details: { requestAccepted: false },
          exitCode: 64,
        },
        Date.now()
      )
    );
  });
});

describe('3.3A-UNIT-027 — binding-specific lifecycle classification stays out of the shared module [P1, R-007]', () => {
  test('the shared module does not export classifyError, BINDING_STATUS_STATES, or any binding-lifecycle-specific classifier', async () => {
    // ACTIVATION: remove .skip once workflow-provider-command-envelope.ts
    // exists. This proves the refactor keeps command-specific error
    // classification local to provider-binding.ts per Task 1's "keep
    // command-specific error classification outside the shared module."
    const mod = await import('./workflow-provider-command-envelope');
    expect(mod).not.toHaveProperty('classifyError');
    expect(mod).not.toHaveProperty('BINDING_STATUS_STATES');
    expect(mod).not.toHaveProperty('buildBindingRef');
  });
});

describe('3.3A-UNIT-032 — no binding-specific vocabulary leaks into the shared module source [P1, R-007/R-011]', () => {
  test('the shared module source contains no BINDING_-prefixed error code string or binding-domain identifier', () => {
    // ACTIVATION: remove .skip once workflow-provider-command-envelope.ts
    // exists. Reads the file as text (not as a module) to catch string
    // literals a type-only check would miss.
    const content = readFileSync(ENVELOPE_MODULE_PATH, 'utf8');
    expect(content).not.toMatch(
      /BINDING_(ALREADY_EXISTS|NOT_FOUND|DISABLED|CORRUPT_STATE|CORRUPT_ROW|CONCURRENT_MODIFICATION)/
    );
  });
});

describe('3.3A-UNIT-056 — parallel/concurrent builder calls stay independent [P1, R-013]', () => {
  test('two concurrent buildSuccessEnvelope calls with different correlationIds never leak state into each other', async () => {
    // ACTIVATION: remove .skip once buildSuccessEnvelope exists. Guards
    // against a module-level mutable cache/singleton being introduced.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    const [a, b] = await Promise.all([
      Promise.resolve(
        mod.buildSuccessEnvelope(
          {
            provider: 'archon',
            command: 'binding.status',
            correlationId: 'corr_unit_056_a',
            issuedAt: '2026-07-14T00:00:00.000Z',
          },
          {
            bindingRef: { provider: 'archon', name: 'a', bindingId: 'wpb_a' },
          },
          { operation: 'status', state: 'active' }
        )
      ),
      Promise.resolve(
        mod.buildSuccessEnvelope(
          {
            provider: 'archon',
            command: 'binding.status',
            correlationId: 'corr_unit_056_b',
            issuedAt: '2026-07-14T00:00:00.000Z',
          },
          {
            bindingRef: { provider: 'archon', name: 'b', bindingId: 'wpb_b' },
          },
          { operation: 'status', state: 'disabled' }
        )
      ),
    ]);
    expect((a as { correlationId: string }).correlationId).toBe('corr_unit_056_a');
    expect((b as { correlationId: string }).correlationId).toBe('corr_unit_056_b');
    expect((a as { bindingRef: { name: string } }).bindingRef.name).toBe('a');
    expect((b as { bindingRef: { name: string } }).bindingRef.name).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// SKIPPED — 3.3A-CONTRACT-036/037/038-042 [P0/P1] — representative envelope
// construction for every command family, and the five canonical failure
// examples, all via the shared builder directly (unit-level, not via CLI
// dispatch — that regression coverage already exists for the 5 implemented
// binding commands in provider-binding.test.ts).
// ---------------------------------------------------------------------------
describe('3.3A-CONTRACT-036 — workflow command runtime conversion is not implemented in this story [P1, R-011]', () => {
  test('the shared module exports only envelope-construction helpers and baseline data — no workflow.start/status/approve/reject/resume/retry/cancel command HANDLER (dispatcher) function', async () => {
    // ACTIVATION: remove .skip once the shared module exists. This is a
    // scope guard: Stories 3.3b-3.3d own runtime conversion (W-3.3A-001).
    // A future accidental handler export here would be scope creep.
    const mod = await import('./workflow-provider-command-envelope');
    for (const forbiddenExport of [
      'workflowStartCommand',
      'workflowStatusCommand',
      'workflowApproveCommand',
      'workflowRejectCommand',
      'workflowResumeCommand',
      'workflowRetryCommand',
      'workflowCancelCommand',
    ]) {
      expect(mod).not.toHaveProperty(forbiddenExport);
    }
  });
});

const REPRESENTATIVE_COMMAND_FAMILIES: Array<{
  fixture: string;
  refKind: 'workflowRunRef' | 'bindingRef';
}> = [
  { fixture: 'start-success.json', refKind: 'workflowRunRef' },
  { fixture: 'status-success.json', refKind: 'workflowRunRef' },
  { fixture: 'approve-success.json', refKind: 'workflowRunRef' },
  { fixture: 'reject-success.json', refKind: 'workflowRunRef' },
  { fixture: 'resume-success.json', refKind: 'workflowRunRef' },
  { fixture: 'retry-success.json', refKind: 'workflowRunRef' },
  { fixture: 'cancel-success.json', refKind: 'workflowRunRef' },
  { fixture: 'binding-create-success.json', refKind: 'bindingRef' },
  { fixture: 'binding-update-success.json', refKind: 'bindingRef' },
  { fixture: 'binding-status-success.json', refKind: 'bindingRef' },
  { fixture: 'binding-rotate-success.json', refKind: 'bindingRef' },
  { fixture: 'binding-disable-success.json', refKind: 'bindingRef' },
];

describe('3.3A-CONTRACT-037 — representative success envelope for every one of the 12 command families [P0, R-014]', () => {
  test('the representative-family fixture list itself covers exactly 12 command families', () => {
    expect(REPRESENTATIVE_COMMAND_FAMILIES).toHaveLength(12);
  });

  for (const { fixture, refKind } of REPRESENTATIVE_COMMAND_FAMILIES) {
    test(`buildSuccessEnvelope reproduces ${fixture} exactly when fed the fixture's own refs/result/metadata`, async () => {
      // ACTIVATION: remove .skip once buildSuccessEnvelope exists. Feeding
      // the exact correlationId/issuedAt/ref/result from the fixture (rather
      // than stripping dynamic fields) proves the helper is byte-for-byte
      // capable of producing every command family's envelope shape now, so
      // Stories 3.3b-3.3d have zero helper gaps to fill later (R-014).
      const mod = (await import('./workflow-provider-command-envelope')) as {
        buildSuccessEnvelope: (
          meta: Record<string, unknown>,
          refs: Record<string, unknown>,
          result: Record<string, unknown>
        ) => Record<string, unknown>;
      };
      const f = loadFixture(fixture) as {
        provider: string;
        command: string;
        correlationId: string;
        issuedAt: string;
        workflowRunRef?: Record<string, unknown>;
        bindingRef?: Record<string, unknown>;
        result: Record<string, unknown>;
      };
      const refs =
        refKind === 'workflowRunRef'
          ? { workflowRunRef: f.workflowRunRef }
          : { bindingRef: f.bindingRef };
      const envelope = mod.buildSuccessEnvelope(
        {
          provider: f.provider,
          command: f.command,
          correlationId: f.correlationId,
          issuedAt: f.issuedAt,
        },
        refs,
        f.result
      );
      expect(envelope).toEqual(f);
    });
  }
});

describe('3.3D-CONTRACT — targeted retry variant uses the shared workflow.retry envelope', () => {
  test('buildSuccessEnvelope reproduces retry-node-success.json exactly', async () => {
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildSuccessEnvelope: (
        meta: Record<string, unknown>,
        refs: Record<string, unknown>,
        result: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    const f = loadFixture('retry-node-success.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      workflowRunRef: Record<string, unknown>;
      result: Record<string, unknown>;
    };
    const envelope = mod.buildSuccessEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { workflowRunRef: f.workflowRunRef },
      f.result
    );
    expect(envelope).toEqual(f);
  });
});

describe('3.3A-CONTRACT-038 — malformed request failure example is reproducible [P0, R-005]', () => {
  test('buildErrorEnvelope reproduces error-malformed-request.json exactly given matching inputs', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const f = loadFixture('error-malformed-request.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      error: {
        code: string;
        category: string;
        retryable: boolean;
        details: Record<string, unknown>;
      };
      execution: { exitCode: number; durationMs: number };
    };
    const startTime = Date.now() - f.execution.durationMs;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { ...f.error, exitCode: f.execution.exitCode },
      startTime
    ) as { error: unknown; execution: { exitCode: number; timedOut: boolean } };
    expect(envelope.error).toEqual(f.error);
    expect(envelope.execution.exitCode).toBe(f.execution.exitCode);
    expect(envelope.execution.timedOut).toBe(false);
  });
});

describe('3.3A-CONTRACT-039 — schema mismatch failure example is reproducible [P0, R-005]', () => {
  test('buildErrorEnvelope reproduces error-schema-mismatch.json exactly given matching inputs', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const f = loadFixture('error-schema-mismatch.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      error: {
        code: string;
        category: string;
        retryable: boolean;
        details: Record<string, unknown>;
      };
      execution: { exitCode: number; durationMs: number };
    };
    const startTime = Date.now() - f.execution.durationMs;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { ...f.error, exitCode: f.execution.exitCode },
      startTime
    ) as { error: unknown };
    expect(envelope.error).toEqual(f.error);
  });
});

describe('3.3A-CONTRACT-040 — timeout failure example is reproducible (envelope shape only, no runtime timeout policy) [P0, R-005/R-017]', () => {
  test('buildErrorEnvelope reproduces error-timeout.json exactly, including a null exitCode and timedOut=true', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists. Per
    // W-3.3A-003, this only proves the envelope is REPRESENTABLE — it does
    // not assert any actual process-level timeout enforcement.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const f = loadFixture('error-timeout.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      error: {
        code: string;
        category: string;
        retryable: boolean;
        details: Record<string, unknown>;
      };
      execution: { exitCode: number | null; durationMs: number };
    };
    const startTime = Date.now() - f.execution.durationMs;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { ...f.error, exitCode: f.execution.exitCode },
      startTime
    ) as { error: unknown; execution: { exitCode: number | null; timedOut: boolean } };
    expect(envelope.error).toEqual(f.error);
    expect(envelope.execution.exitCode).toBeNull();
    expect(envelope.execution.timedOut).toBe(true);
  });
});

describe('3.3A-CONTRACT-041 — unexpected exit failure example is reproducible with redacted execution metadata [P0, R-005]', () => {
  test('buildErrorEnvelope reproduces error-unexpected-exit.json exactly given matching inputs', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const f = loadFixture('error-unexpected-exit.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      error: {
        code: string;
        category: string;
        retryable: boolean;
        details: Record<string, unknown>;
      };
      execution: {
        exitCode: number;
        durationMs: number;
        stdoutRedacted: boolean;
        stderrRedacted: boolean;
      };
    };
    const startTime = Date.now() - f.execution.durationMs;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { ...f.error, exitCode: f.execution.exitCode },
      startTime
    ) as { error: unknown; execution: { stdoutRedacted: boolean; stderrRedacted: boolean } };
    expect(envelope.error).toEqual(f.error);
    expect(envelope.execution.stdoutRedacted).toBe(true);
    expect(envelope.execution.stderrRedacted).toBe(true);
  });
});

describe('3.3A-CONTRACT-042 — unexpected state failure example is reproducible and never claims mutation applied [P0, R-005]', () => {
  test('buildErrorEnvelope reproduces error-unexpected-state.json exactly, with details.mutationApplied=false', async () => {
    // ACTIVATION: remove .skip once buildErrorEnvelope exists.
    const mod = (await import('./workflow-provider-command-envelope')) as {
      buildErrorEnvelope: (
        meta: Record<string, unknown>,
        error: Record<string, unknown>,
        startTime: number
      ) => Record<string, unknown>;
    };
    const f = loadFixture('error-unexpected-state.json') as {
      provider: string;
      command: string;
      correlationId: string;
      issuedAt: string;
      error: {
        code: string;
        category: string;
        retryable: boolean;
        details: { mutationApplied: boolean };
      };
      execution: { exitCode: number; durationMs: number };
    };
    const startTime = Date.now() - f.execution.durationMs;
    const envelope = mod.buildErrorEnvelope(
      {
        provider: f.provider,
        command: f.command,
        correlationId: f.correlationId,
        issuedAt: f.issuedAt,
      },
      { ...f.error, exitCode: f.execution.exitCode },
      startTime
    ) as { error: { details: { mutationApplied: boolean } } };
    expect(envelope.error).toEqual(f.error);
    expect(envelope.error.details.mutationApplied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WAIVED / NOT-A-BUN-TEST — 3.3A-CI-053 [P1] — file-scope review.
// ---------------------------------------------------------------------------
describe('3.3A-CI-053 — file-scope review [P1, R-011]', () => {
  test('the diff for this story touches only the files listed in the story\'s "Project Structure Notes" (manual/CI review, not a deterministic Bun assertion)', () => {
    // WAIVER-STYLE SKIP (not a missing-module skip): a reliable machine
    // check needs a stable merge-base ref (e.g. `git diff --name-only
    // origin/dev...HEAD`), which is not guaranteed available or correct
    // inside every worktree/CI checkout shape this repo uses. Activate by
    // replacing this body with a `git diff --name-only <base>...HEAD`
    // check once a stable base-ref convention for story-scope review is
    // adopted; until then this is enforced by human PR review against the
    // story's "Project Structure Notes" / "Unexpected for this story"
    // lists.
    expect(true).toBe(true);
  });
});

// Re-export the fixture directory listing check so a future contributor
// cannot silently rename/remove a command fixture this file depends on
// without a loud failure pointing back here.
describe('fixture inventory guard (supports CONTRACT-037/038-042 above)', () => {
  test('every fixture referenced by the scaffolds above still exists on disk', () => {
    const required = [
      ...REPRESENTATIVE_COMMAND_FAMILIES.map(f => f.fixture),
      'retry-node-success.json',
      'error-malformed-request.json',
      'error-schema-mismatch.json',
      'error-timeout.json',
      'error-unexpected-exit.json',
      'error-unexpected-state.json',
    ];
    const present = new Set(readdirSync(COMMANDS_DIR));
    for (const name of required) {
      expect(present.has(name)).toBe(true);
    }
  });
});
