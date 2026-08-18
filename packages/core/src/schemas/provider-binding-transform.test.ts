import { describe, expect, test } from 'bun:test';
import {
  jsonataProviderBindingTransformSchema,
  providerBindingTransformSchema,
} from './provider-binding-transform';

describe('providerBindingTransformSchema', () => {
  test('applies every JSONata default', () => {
    expect(
      providerBindingTransformSchema.parse({
        engine: 'jsonata',
        expression: '{ "eventType": eventType }',
      })
    ).toEqual({
      engine: 'jsonata',
      expression: '{ "eventType": eventType }',
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
  });

  test('rejects empty expressions, unknown engines, non-positive limits, and every hard-cap overflow', () => {
    const base = { engine: 'jsonata' as const, expression: '{ "ok": true }' };
    expect(() => providerBindingTransformSchema.parse({ ...base, expression: '' })).toThrow();
    expect(() => providerBindingTransformSchema.parse({ engine: 'jq', expression: '.' })).toThrow();
    for (const patch of [
      { timeoutMs: 0 },
      { timeoutMs: 201 },
      { stackDepth: 0 },
      { stackDepth: 513 },
      { maxSequenceSize: 0 },
      { maxSequenceSize: 100_001 },
      { maxOutputBytes: 0 },
      { maxOutputBytes: 262_145 },
    ]) {
      expect(() => jsonataProviderBindingTransformSchema.parse({ ...base, ...patch })).toThrow();
    }
  });
});
