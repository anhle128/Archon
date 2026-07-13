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
        'state',
        'binding_version',
        'created_at',
        'updated_at',
      ].sort()
    );
  });

  test('state accepts all persisted state values', () => {
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

  test('accepts PostgreSQL Date timestamp rows', () => {
    const timestamp = new Date('2026-07-11T11:48:27.000Z');
    const row = {
      id: 'wpb-1',
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebase_id: 'cb-1',
      event_route: 'https://hermes.example/events/workflow-engine',
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
});
