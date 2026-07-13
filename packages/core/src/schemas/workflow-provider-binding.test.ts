import { describe, test, expect } from 'bun:test';

// RED-PHASE SCAFFOLD (SKIPPED) — Story 3.1 "Implement Archon Workflow Provider
// Binding Lifecycle" (_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md).
//
// Target module `./workflow-provider-binding` does not exist yet (Task 1).
// A static `import` here would fail module resolution and crash the whole
// file before any test runs, so the schema is imported dynamically INSIDE
// each skipped test body — Bun never evaluates a `test.skip()` callback, so
// the missing module never gets resolved until the test is activated.
//
// Activate by:
//   1. Adding packages/core/src/schemas/workflow-provider-binding.ts per the
//      Dev Notes "Architecture & Conventions to Follow" section — mirror
//      packages/core/src/schemas/env-var.ts exactly: camelCase schema
//      variable name (`workflowProviderBindingSchema`), snake_case row
//      fields matching the DB columns 1:1, `z` from `@hono/zod-openapi`.
//   2. Re-exporting it from packages/core/src/schemas/index.ts.
//   3. Removing `.skip` and switching the dynamic import to a static one.

describe('workflowProviderBindingSchema (Story 3.1)', () => {
  // 3.1-UNIT-001 [P1] — Row schema mirrors the exact snake_case DB row.
  // Risk: R-007. AC: AC1. Level: Unit.
  test.skip('parses a full row with snake_case fields matching the DB columns 1:1', async () => {
    const { workflowProviderBindingSchema } = await import('./workflow-provider-binding');

    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };

    const parsed = workflowProviderBindingSchema.parse(row);
    expect(parsed).toEqual(row);
    // The row shape must round-trip 1:1 — no camelCase aliasing of DB columns
    // (only the exported schema *variable name* is camelCase, per convention).
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'id',
        'provider',
        'name',
        'codebase_id',
        'event_route',
        'state',
        'binding_version',
        'created_at',
        'updated_at',
      ].sort()
    );
  });

  test.skip('state accepts all contract-defined values, including the response-only "stale"/"missing"/"conflicting" states', async () => {
    // Known Contract Gap #2 (Dev Notes): the `state` type must be ABLE to
    // represent 'stale' so status-response code compiles/validates, even
    // though nothing persists a row with state='stale' in this story. The
    // persisted states remain 'active' | 'disabled' | 'rotated' only
    // (DB Design Proposal) — 'missing' / 'conflicting' / 'malformed' are
    // response-only and never appear on a stored row.
    const { workflowProviderBindingSchema } = await import('./workflow-provider-binding');

    for (const state of ['active', 'disabled', 'rotated']) {
      const row = {
        id: 'wpb-1',
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebase_id: 'cb-1',
        event_route: 'https://hermes.example/events/workflow-engine',
        state,
        binding_version: 1,
        created_at: '2026-07-11T11:48:27.000Z',
        updated_at: '2026-07-11T11:48:27.000Z',
      };
      expect(() => workflowProviderBindingSchema.parse(row)).not.toThrow();
    }
  });

  test.skip('rejects a row missing a required column (fail closed on corrupt data)', async () => {
    const { workflowProviderBindingSchema } = await import('./workflow-provider-binding');
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      // codebase_id intentionally omitted
      event_route: 'https://hermes.example/events/workflow-engine',
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };
    expect(() => workflowProviderBindingSchema.parse(row)).toThrow();
  });
});
