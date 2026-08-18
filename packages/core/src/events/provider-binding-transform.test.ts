import { describe, expect, test } from 'bun:test';
import {
  ProviderBindingTransformError,
  normalizeProviderBindingTransform,
  validateProviderBindingTransform,
} from './provider-binding-transform';

function transform(expression: string) {
  return normalizeProviderBindingTransform({ engine: 'jsonata', expression });
}

describe('provider-binding JSONata policy', () => {
  test('normalizes defaults and rejects an oversized UTF-8 expression with a safe error', () => {
    expect(transform('{ "ok": true }')).toMatchObject({
      timeoutMs: 50,
      stackDepth: 128,
      maxSequenceSize: 10_000,
      maxOutputBytes: 65_536,
    });
    try {
      normalizeProviderBindingTransform({
        engine: 'jsonata',
        expression: 'é'.repeat(16_385),
      });
      throw new Error('expected normalization failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).toBe('TRANSFORM_CONFIG_INVALID');
      expect((error as Error).message).not.toContain('é');
    }
  });

  test('accepts canonical field selection and approved direct functions', () => {
    expect(() =>
      validateProviderBindingTransform(
        transform('{ "eventType": $uppercase(eventType), "runId": workflowRunRef.runId }')
      )
    ).not.toThrow();
  });

  test('rejects disallowed, unknown, dynamic, and aliased calls without source leakage', () => {
    for (const expression of [
      '$eval("1")',
      '$now()',
      '$millis()',
      '$random()',
      '$pad("x", 8)',
      '($f := $now; $f())',
      '($f := $uppercase; $f("x"))',
    ]) {
      try {
        validateProviderBindingTransform(transform(expression));
        throw new Error('expected policy failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderBindingTransformError);
        expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_FUNCTION_DISALLOWED');
        expect((error as Error).message).not.toContain(expression);
      }
    }
  });

  test('rejects partials, apply, lambdas, transform expressions, and regex AST nodes', () => {
    for (const expression of [
      '$string(?)',
      '"x" ~> $uppercase()',
      'function($x){$x}',
      'payload ~> |foo|{bar: 1}|',
      '$contains(eventType, /run/)',
    ]) {
      expect(() => validateProviderBindingTransform(transform(expression))).toThrow(
        /TRANSFORM_AST_DISALLOWED/
      );
    }
  });

  test('classifies syntax failures without token text', () => {
    try {
      validateProviderBindingTransform(transform('{'));
      throw new Error('expected compile failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderBindingTransformError);
      expect((error as ProviderBindingTransformError).code).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).toBe('TRANSFORM_COMPILE_FAILED');
      expect((error as Error).message).not.toContain('{');
    }
  });
});
