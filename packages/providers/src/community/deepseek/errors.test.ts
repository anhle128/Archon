import { describe, expect, test } from 'bun:test';

import { DeepseekProviderError, redactDeepseekSecrets, toDeepseekErrorResult } from './errors';

describe('redactDeepseekSecrets', () => {
  test('replaces every occurrence of each secret', () => {
    expect(redactDeepseekSecrets('a SECRET then SECRET', ['SECRET'])).toBe(
      'a [REDACTED] then [REDACTED]'
    );
  });
});

describe('toDeepseekErrorResult', () => {
  test('preserves a known DeepseekProviderError subtype', () => {
    const result = toDeepseekErrorResult(
      new DeepseekProviderError('deepseek_missing_api_key', 'DEEPSEEK_API_KEY is missing.'),
      []
    );
    expect(result).toEqual({
      type: 'result',
      isError: true,
      errorSubtype: 'deepseek_missing_api_key',
      errors: ['DEEPSEEK_API_KEY is missing.'],
    });
  });

  test('maps unknown errors to deepseek_acp_error', () => {
    expect(toDeepseekErrorResult(new Error('boom'), []).errorSubtype).toBe('deepseek_acp_error');
    expect(toDeepseekErrorResult('plain failure', []).errorSubtype).toBe('deepseek_acp_error');
  });

  test('replaces every occurrence of the actual API key', () => {
    const secret = 'sk-live-example-token';
    const result = toDeepseekErrorResult(
      new DeepseekProviderError(
        'deepseek_spawn_failed',
        `spawn failed with ${secret} then ${secret}`
      ),
      [secret]
    );
    expect(result).toEqual({
      type: 'result',
      isError: true,
      errorSubtype: 'deepseek_spawn_failed',
      errors: ['spawn failed with [REDACTED] then [REDACTED]'],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test('does not synthesize tokens, usage, cost, or session id', () => {
    const result = toDeepseekErrorResult(new Error('boom'), []);
    expect(result).not.toHaveProperty('tokens');
    expect(result).not.toHaveProperty('usageBreakdown');
    expect(result).not.toHaveProperty('modelUsage');
    expect(result).not.toHaveProperty('cost');
    expect(result).not.toHaveProperty('sessionId');
  });
});
