import { mock, describe, test, expect, beforeEach } from 'bun:test';
import { createQueryResult, mockPostgresDialect } from '../test/mocks/database';

// RED-PHASE SCAFFOLD (SKIPPED) — Story 3.1 "Implement Archon Workflow Provider
// Binding Lifecycle" (_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md).
//
// Target module `./provider-bindings` does not exist yet (Task 1/2/3). Every
// test below imports it dynamically INSIDE the (skipped) test body — Bun
// never evaluates a `test.skip()` callback, so the missing module is never
// resolved until a developer activates the test. The `./connection` mock
// below IS static because that module already exists; it mirrors
// `env-vars.test.ts` / `user-provider-key-store.test.ts` exactly (same
// factory shape) so this file stays compatible if ever run in the same Bun
// process as those.
//
// Activate by:
//   1. Adding packages/core/src/db/provider-bindings.ts (Task 1: createBinding,
//      getBinding; Task 2: updateBinding; Task 3: rotateBinding, disableBinding)
//      per the Dev Notes "Architecture & Conventions to Follow" section.
//   2. Removing `.skip` and switching the dynamic import to a static one.
//   3. Adding this file to its own isolated `bun test` line in
//      packages/core/package.json's `test` script (CLAUDE.md test-isolation
//      rule — do not fold it into a batch using a *different* `./connection`
//      mock shape).

const mockQuery = mock(() => Promise.resolve(createQueryResult([])));
mock.module('./connection', () => ({
  pool: { query: mockQuery },
  getDialect: () => mockPostgresDialect,
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

function bindingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wpb-1',
    provider: 'archon',
    name: 'workflow-engine-primary',
    codebase_id: 'cb-1',
    event_route: 'https://hermes.example/events/workflow-engine',
    state: 'active',
    binding_version: 1,
    created_at: '2026-07-11T11:48:27.000Z',
    updated_at: '2026-07-11T11:48:27.000Z',
    ...overrides,
  };
}

describe('provider-bindings db layer (Story 3.1)', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  describe('createBinding()', () => {
    // 3.1-UNIT-002 [P0] — Create persists registered identity and route using
    // insert-only conflict behavior. Risk: R-003, R-004. AC: AC1.
    test.skip('inserts provider/name/codebase_id/event_route with ON CONFLICT DO NOTHING (never DO UPDATE)', async () => {
      const { createBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));

      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/workflow-engine',
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO remote_agent_workflow_provider_bindings');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
      expect(params).toContain('archon');
      expect(params).toContain('workflow-engine-primary');
      expect(params).toContain('cb-1');
      expect(params).toContain('https://hermes.example/events/workflow-engine');
    });

    // 3.1-UNIT-003 [P0] — Create-existing fails without mutation. Risk: R-003.
    test.skip('rejects with BINDING_ALREADY_EXISTS when rowCount is 0 (row already present) and issues no further write', async () => {
      const { createBinding } = await import('./provider-bindings');
      // ON CONFLICT DO NOTHING with an existing row returns rowCount 0.
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(
        createBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/workflow-engine',
        })
      ).rejects.toThrow(/BINDING_ALREADY_EXISTS/);

      // Exactly the one INSERT attempt — no fallback UPDATE/upsert query.
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateBinding()', () => {
    // 3.1-UNIT-004 [P0] — Update-existing changes intended metadata only.
    // Risk: R-003, R-004. AC: AC2.
    test.skip('issues UPDATE ... WHERE provider=$1 AND name=$2 and never inserts', async () => {
      const { updateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1)); // UPDATE
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ event_route: 'https://hermes.example/events/v2' })], 1)
      ); // follow-up SELECT

      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });

      const [updateSql, updateParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).not.toContain('INSERT INTO');
      expect(updateSql).toMatch(/WHERE\s+provider\s*=\s*\$\d+\s+AND\s+name\s*=\s*\$\d+/);
      expect(updateParams).toContain('https://hermes.example/events/v2');
    });

    // 3.1-UNIT-005 [P0] — Update-missing never inserts. Risk: R-003.
    test.skip('rejects with BINDING_NOT_FOUND when rowCount is 0 and issues no INSERT fallback', async () => {
      const { updateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0)); // UPDATE affected 0 rows

      await expect(
        updateBinding({
          provider: 'archon',
          name: 'nonexistent-binding',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/v2',
        })
      ).rejects.toThrow(/BINDING_NOT_FOUND/);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('INSERT INTO');
    });

    // Regression proving create/update never race into an upsert: an update
    // performed after a create must not make a subsequent create on the same
    // (provider,name) succeed (i.e., update never silently "resets" the row
    // to a creatable state).
    test.skip('create on an already-created (provider,name) still fails after an update was performed', async () => {
      const { createBinding, updateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1)); // initial create
      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v1',
      });

      mockQuery.mockResolvedValueOnce(createQueryResult([], 1)); // UPDATE
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1)); // SELECT
      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });

      mockQuery.mockResolvedValueOnce(createQueryResult([], 0)); // second create: ON CONFLICT DO NOTHING, rowCount 0
      await expect(
        createBinding({
          provider: 'archon',
          name: 'workflow-engine-primary',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/v3',
        })
      ).rejects.toThrow(/BINDING_ALREADY_EXISTS/);
    });

    // 3.1-UNIT-008 [P0] — Event route round-trips across create and update.
    // Risk: R-004. The route is opaque to this story — it must survive both
    // operations unmangled and distinctly (not silently reused/dropped).
    test.skip('the exact event route from create is superseded by the exact event route from a subsequent update — never merged or dropped', async () => {
      const { createBinding, updateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow()], 1));
      await createBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v1',
      });
      const createParams = mockQuery.mock.calls[0]?.[1] as unknown[];
      expect(createParams).toContain('https://hermes.example/events/v1');

      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ event_route: 'https://hermes.example/events/v2' })], 1)
      );
      await updateBinding({
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/v2',
      });
      const updateParams = mockQuery.mock.calls[1]?.[1] as unknown[];
      expect(updateParams).toContain('https://hermes.example/events/v2');
      expect(updateParams).not.toContain('https://hermes.example/events/v1');
    });
  });

  describe('rotateBinding()', () => {
    // 3.1-UNIT-009 [P1] — Rotate uses update-then-select and increments one
    // version. Risk: R-006, R-008. No UPDATE ... RETURNING (SQLite can't).
    test.skip('increments binding_version by exactly 1, sets state=rotated, via UPDATE then a separate SELECT (no RETURNING)', async () => {
      const { rotateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1)); // UPDATE
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'rotated', binding_version: 2 })], 1)
      ); // SELECT

      const result = await rotateBinding('archon', 'workflow-engine-primary');

      const [updateSql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE remote_agent_workflow_provider_bindings');
      expect(updateSql).toContain('binding_version = binding_version + 1');
      expect(updateSql).not.toContain('RETURNING');
      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('SELECT');
      expect(result).toMatchObject({ previousVersion: 1, activeVersion: 2 });
    });

    // 3.1-UNIT-010 [P1] — Rotate-before-create fails not found. Risk: R-009.
    test.skip('rejects with BINDING_NOT_FOUND when the UPDATE affects zero rows', async () => {
      const { rotateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(rotateBinding('archon', 'never-created')).rejects.toThrow(/BINDING_NOT_FOUND/);
      // Never falls through to the follow-up SELECT when the UPDATE found nothing.
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    // 3.1-UNIT-037 [P1] — Post-mutation SELECT failure reports uncertainty,
    // not stale success. Risk: R-006, R-011.
    test.skip('when the UPDATE commits but the follow-up SELECT throws, the caller sees an explicit uncertain-outcome error, not a stale/default success value', async () => {
      const { rotateBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1)); // UPDATE succeeds
      mockQuery.mockRejectedValueOnce(new Error('connection reset')); // SELECT fails

      await expect(rotateBinding('archon', 'workflow-engine-primary')).rejects.toThrow(
        /uncertain|connection reset/i
      );
    });
  });

  describe('disableBinding()', () => {
    // 3.1-UNIT-011 [P1] — Disable retains the row (no DELETE). Risk: R-009.
    test.skip('issues UPDATE ... SET state = disabled, never DELETE', async () => {
      const { disableBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })], 1));

      await disableBinding('archon', 'workflow-engine-primary');

      const calledSql = mockQuery.mock.calls.map(c => (c as [string, unknown[]])[0]).join('\n');
      expect(calledSql).toContain("state = 'disabled'");
      expect(calledSql).not.toContain('DELETE FROM remote_agent_workflow_provider_bindings');
    });

    // 3.1-UNIT-012 [P1] — Disable-before-create fails not found. Risk: R-009.
    test.skip('rejects with BINDING_NOT_FOUND when the UPDATE affects zero rows', async () => {
      const { disableBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([], 0));

      await expect(disableBinding('archon', 'never-created')).rejects.toThrow(/BINDING_NOT_FOUND/);
    });
  });

  describe('getBinding() — status read path', () => {
    // 3.1-UNIT-013 [P1] — Status missing. Risk: R-005.
    test.skip('returns null when no row matches (provider,name)', async () => {
      const { getBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([]));

      expect(await getBinding('archon', 'never-created')).toBeNull();
    });

    // 3.1-UNIT-014 [P1] — Status active/valid. Risk: R-005.
    test.skip('returns the row unmodified when state=active', async () => {
      const { getBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'active' })]));

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'active', binding_version: 1 });
    });

    // 3.1-UNIT-015 [P1] — Status disabled/not-ready. Risk: R-005.
    test.skip('returns the row unmodified when state=disabled', async () => {
      const { getBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ state: 'disabled' })]));

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'disabled' });
    });

    // 3.1-UNIT-016 [P1] — Status rotated/ready with active version. Risk: R-005.
    test.skip('returns the row unmodified when state=rotated, carrying the current binding_version', async () => {
      const { getBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'rotated', binding_version: 3 })])
      );

      const row = await getBinding('archon', 'workflow-engine-primary');
      expect(row).toMatchObject({ state: 'rotated', binding_version: 3 });
    });

    // 3.1-UNIT-019 [P1] — Corrupt persisted state fails closed. Risk: R-005, R-011.
    test.skip('throws (fails closed) rather than returning a row whose state is outside the persisted enum', async () => {
      const { getBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(
        createQueryResult([bindingRow({ state: 'not-a-real-state' })])
      );

      await expect(getBinding('archon', 'workflow-engine-primary')).rejects.toThrow();
    });
  });

  describe('boundary / canonicalization (Story 3.1)', () => {
    // 3.1-UNIT-030 [P1] — Unicode/separator values round-trip or fail
    // deterministically. Risk: R-012.
    // BLOCKED: Pre-Implementation Decision #2 (empty/whitespace handling and
    // canonicalization for provider/name/route; "no silent normalization may
    // alias identities") is not yet ratified per test-design-epic-3.md
    // ("Blocked on decision", R-004/R-012). Implement once ratified — do not
    // guess a canonicalization rule.
    test.skip('Unicode-normalization-equivalent name values are treated as distinct identities unless canonicalization is ratified', async () => {
      const { createBinding } = await import('./provider-bindings');
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ name: 'café' })], 1));
      mockQuery.mockResolvedValueOnce(createQueryResult([bindingRow({ name: 'café' })], 1)); // NFD-equivalent

      await createBinding({
        provider: 'archon',
        name: 'café',
        codebaseId: 'cb-1',
        eventRoute: 'https://hermes.example/events/a',
      });
      // Per the ratified canonicalization rule (TBD), this SECOND create must
      // either (a) succeed as a distinct binding if no normalization is
      // applied, or (b) fail BINDING_ALREADY_EXISTS if NFC-normalization is
      // ratified as the identity rule. Whichever is decided, the two must
      // never silently alias to different behavior each call.
      await expect(
        createBinding({
          provider: 'archon',
          name: 'café',
          codebaseId: 'cb-1',
          eventRoute: 'https://hermes.example/events/b',
        })
      ).resolves.toBeDefined();
    });

    // 3.1-UNIT-031 [P1] — Normalization-collision candidates cannot share a
    // live binding ID. Risk: R-012.
    test.skip('two distinct (provider,name) pairs never derive the same bindingId', async () => {
      const { deriveBindingId } = await import('./provider-bindings');
      const a = deriveBindingId('archon', 'workflow-engine-primary');
      const b = deriveBindingId('archon', 'workflow_engine-primary'); // hyphen/underscore collision candidate
      expect(a).not.toBe(b);
    });
  });
});
