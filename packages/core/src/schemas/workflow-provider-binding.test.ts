import { describe, test, expect } from 'bun:test';
import { workflowProviderBindingSchema } from './workflow-provider-binding';

describe('workflowProviderBindingSchema (Story 3.1)', () => {
  test('parses a full row with snake_case fields matching the DB columns 1:1', () => {
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      event_types: ['workflow.approval.requested'],
      transform: null,
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };

    const parsed = workflowProviderBindingSchema.parse(row);
    expect(parsed).toEqual(row);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'id',
        'provider',
        'name',
        'codebase_id',
        'event_route',
        'event_types',
        'transform',
        'state',
        'binding_version',
        'created_at',
        'updated_at',
      ].sort()
    );
  });

  test('accepts only external workflow event types', () => {
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      event_types: ['workflow.approval.requested'],
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };

    expect(workflowProviderBindingSchema.parse(row).event_types).toEqual([
      'workflow.approval.requested',
    ]);
    expect(() =>
      workflowProviderBindingSchema.parse({ ...row, event_types: ['workflow.unknown'] })
    ).toThrow();
  });

  test('state accepts all persisted state values', () => {
    for (const state of ['active', 'disabled', 'rotated']) {
      const row = {
        id: 'wpb-1',
        provider: 'archon',
        name: 'workflow-engine-primary',
        codebase_id: 'cb-1',
        event_route: 'https://hermes.example/events/workflow-engine',
        event_types: ['workflow.approval.requested'],
        state,
        binding_version: 1,
        created_at: '2026-07-11T11:48:27.000Z',
        updated_at: '2026-07-11T11:48:27.000Z',
      };
      expect(() => workflowProviderBindingSchema.parse(row)).not.toThrow();
    }
  });

  test('accepts PostgreSQL Date timestamp rows', () => {
    const timestamp = new Date('2026-07-11T11:48:27.000Z');
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      event_types: ['workflow.approval.requested'],
      state: 'active',
      binding_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const parsed = workflowProviderBindingSchema.parse(row);
    expect(parsed.created_at).toBe(timestamp);
    expect(parsed.updated_at).toBe(timestamp);
  });

  test('rejects a state outside the persisted lifecycle enum', () => {
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      event_types: ['workflow.approval.requested'],
      state: 'conflicting',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };
    expect(() => workflowProviderBindingSchema.parse(row)).toThrow();
  });

  test('rejects a row missing a required column (fail closed on corrupt data)', () => {
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      event_route: 'https://hermes.example/events/workflow-engine',
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    };
    expect(() => workflowProviderBindingSchema.parse(row)).toThrow();
  });

  test('strips private signing_secret from public binding projections', () => {
    const parsed = workflowProviderBindingSchema.parse({
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
      event_types: ['workflow.approval.requested'],
      signing_secret: 'local-test-value',
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    });

    expect('signing_secret' in parsed).toBe(false);
  });

  test('public projection parses transform and strips both private columns', () => {
    const parsed = workflowProviderBindingSchema.parse({
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://example.invalid/events',
      event_types: [],
      transform: {
        engine: 'jsonata',
        expression: '{ "ok": true }',
        timeoutMs: 50,
        stackDepth: 128,
        maxSequenceSize: 10_000,
        maxOutputBytes: 65_536,
      },
      delivery_headers: { Authorization: 'Bearer secret' },
      signing_secret: 'signing-value',
      state: 'active',
      binding_version: 1,
      created_at: '2026-07-11T11:48:27.000Z',
      updated_at: '2026-07-11T11:48:27.000Z',
    });
    expect(parsed.transform?.engine).toBe('jsonata');
    expect('delivery_headers' in parsed).toBe(false);
    expect('signing_secret' in parsed).toBe(false);
  });
});
