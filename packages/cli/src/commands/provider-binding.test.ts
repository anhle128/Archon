import { describe, test, expect, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACTS_DIR = join(
  import.meta.dir,
  '../../../../_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands'
);

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, name), 'utf8')) as Record<string, unknown>;
}

const DYNAMIC_FIELDS = [
  'correlationId',
  'issuedAt',
  'observedAt',
  'requestedAt',
  'checkedAt',
  'durationMs',
];

function stripDynamicFields(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  for (const key of DYNAMIC_FIELDS) delete copy[key];
  for (const [key, value] of Object.entries(copy)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      copy[key] = stripDynamicFields(value as Record<string, unknown>);
    }
  }
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
  deriveBindingId: mock((provider: string, name: string) => {
    const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_');
    return `wpb_${sanitize(provider)}::${sanitize(name)}`;
  }),
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

import {
  providerBindingCreateCommand,
  providerBindingUpdateCommand,
  providerBindingStatusCommand,
  providerBindingRotateCommand,
  providerBindingDisableCommand,
  BINDING_STATUS_STATES,
} from './provider-binding';

describe('provider-binding CLI command (Story 3.1)', () => {
  describe('exact fixture conformance', () => {
    test('create --json stdout structurally matches binding-create-success.json (excluding dynamic fields)', async () => {
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

    test('update --json stdout structurally matches binding-update-success.json', async () => {
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

    test('status --json stdout structurally matches binding-status-success.json for an active binding', async () => {
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-status-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    test('rotate --json stdout structurally matches binding-rotate-success.json', async () => {
      const logs: string[] = [];
      await providerBindingRotateCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-rotate-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    test('disable --json stdout structurally matches binding-disable-success.json', async () => {
      const logs: string[] = [];
      await providerBindingDisableCommand(
        { provider: 'archon', name: 'workflow-engine-primary' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as Record<string, unknown>;
      const fixture = loadFixture('binding-disable-success.json');
      expect(stripDynamicFields(output)).toEqual(stripDynamicFields(fixture));
    });

    test('create with missing --provider/--name matches error-malformed-request.json shape', async () => {
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
    test('success envelopes contain no keys beyond the closed workflow-command-envelope.schema.json top level', async () => {
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

    test('failure envelopes require `error` and omit `result`', async () => {
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
    test('--project-ref resolves to the codebase row and emits bindingRef.projectRef as "project:<name>"', async () => {
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

    test('unresolvable --project-ref fails MALFORMED_REQUEST and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
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
    test('supplying a --project-ref that resolves to a different codebase reports state=conflicting', async () => {
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

    test('the status result type accepts "stale" as a legal value', () => {
      expect(BINDING_STATUS_STATES).toContain('stale');
    });
  });

  describe('malformed input (fail closed before any write)', () => {
    test('create with both --provider and --name missing returns fieldErrors for /provider and /name', async () => {
      mockCreateBinding.mockClear();
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

    test('status with --name but no --provider fails MALFORMED_REQUEST', async () => {
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { name: 'workflow-engine-primary' } as unknown as { provider: string; name: string },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean; error: { code: string } };
      expect(output.success).toBe(false);
      expect(output.error.code).toBe('MALFORMED_REQUEST');
    });

    test('status with --provider but no --name fails MALFORMED_REQUEST', async () => {
      const logs: string[] = [];
      await providerBindingStatusCommand(
        { provider: 'archon' } as unknown as { provider: string; name: string },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean; error: { code: string } };
      expect(output.success).toBe(false);
      expect(output.error.code).toBe('MALFORMED_REQUEST');
    });

    test('create without --project-ref fails MALFORMED_REQUEST', async () => {
      mockCreateBinding.mockClear();
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

    test('create without --route fails MALFORMED_REQUEST', async () => {
      mockCreateBinding.mockClear();
      const logs: string[] = [];
      await providerBindingCreateCommand(
        { provider: 'archon', name: 'workflow-engine-primary', projectRef: 'workflow-engine' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockCreateBinding).not.toHaveBeenCalled();
    });

    test('update without --project-ref fails MALFORMED_REQUEST', async () => {
      mockUpdateBinding.mockClear();
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

    test('update without --route fails MALFORMED_REQUEST', async () => {
      mockUpdateBinding.mockClear();
      const logs: string[] = [];
      await providerBindingUpdateCommand(
        { provider: 'archon', name: 'workflow-engine-primary', projectRef: 'workflow-engine' },
        { json: true, log: (line: string) => logs.push(line) }
      );
      const output = JSON.parse(logs.join('\n')) as { success: boolean };
      expect(output.success).toBe(false);
      expect(mockUpdateBinding).not.toHaveBeenCalled();
    });

    test('a whitespace-only --provider is rejected before any write', async () => {
      mockCreateBinding.mockClear();
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

    test('a whitespace-only --name is rejected before any write', async () => {
      mockCreateBinding.mockClear();
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

    test('a whitespace-only --route fails before mutation', async () => {
      mockCreateBinding.mockClear();
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
    test('a supplied --correlation-id is echoed verbatim in the envelope', async () => {
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

    test('an omitted --correlation-id is auto-generated as a UUID and issuedAt is a valid ISO date-time', async () => {
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
    test('recursively scanning the full envelope finds no "actor", "secret", or Hermes-internal key', async () => {
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
    test('a thrown codebase lookup error produces a failure envelope and never calls createBinding', async () => {
      mockCreateBinding.mockClear();
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

    test('a thrown createBinding error produces a failure envelope, not a success', async () => {
      mockCreateBinding.mockRejectedValueOnce(new Error('unique constraint violation'));
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

    test('a DB-layer timeout-shaped error maps to category="timeout"', async () => {
      const timeoutError = Object.assign(new Error('statement timeout'), { code: 'ETIMEDOUT' });
      mockCreateBinding.mockRejectedValueOnce(timeoutError);
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

    test('an error carrying non-JSON-serializable data still produces one valid parseable JSON line', async () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const weirdError = Object.assign(new Error('weird'), { details: circular });
      mockCreateBinding.mockRejectedValueOnce(weirdError);
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
    test('there is no "remove" subcommand', async () => {
      const module = await import('./provider-binding');
      expect(module).not.toHaveProperty('providerBindingRemoveCommand');
      expect(module).not.toHaveProperty('providerBindingDeleteCommand');
    });
  });
});
