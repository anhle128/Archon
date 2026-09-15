import { describe, expect, test } from 'bun:test';

import { AskHumanAwaitingError, AskHumanPauseFailedError } from '../../types';
import {
  classifyDevinAcpError,
  collectDevinSecretValues,
  DevinProviderError,
  isAskHumanControlError,
  redactDevinSecrets,
  toDevinErrorResult,
} from './errors';

describe('DevinProviderError', () => {
  test('carries subtype and name', () => {
    const error = new DevinProviderError('devin_binary_missing', 'no devin');
    expect(error.name).toBe('DevinProviderError');
    expect(error.subtype).toBe('devin_binary_missing');
    expect(error.message).toBe('no devin');
  });
});

describe('classifyDevinAcpError', () => {
  test('returns existing provider errors unchanged', () => {
    const error = new DevinProviderError('devin_aborted', 'x');
    expect(classifyDevinAcpError(error, 'devin_acp_error')).toBe(error);
  });

  test('returns AskHuman control errors unchanged', () => {
    const awaiting = new AskHumanAwaitingError('call_1', 'node', 'run');
    const failed = new AskHumanPauseFailedError('call_1', 'node', 'run', 'db down');
    expect(classifyDevinAcpError(awaiting, 'devin_acp_error')).toBe(awaiting);
    expect(classifyDevinAcpError(failed, 'devin_acp_error')).toBe(failed);
    expect(isAskHumanControlError(awaiting)).toBe(true);
    expect(isAskHumanControlError(new Error('plain'))).toBe(false);
  });

  test('maps JSON-RPC -32000 to devin_not_logged_in with a login hint', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Authentication required'), { code: -32000 }),
      'devin_acp_error'
    );
    expect(result).toBeInstanceOf(DevinProviderError);
    expect((result as DevinProviderError).subtype).toBe('devin_not_logged_in');
    expect(result.message).toContain('devin auth login');
  });

  test('maps session_not_found to devin_session_load_failed', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Session not found'), {
        code: -32016,
        data: { 'cognition.ai/errorKind': 'session_not_found' },
      }),
      'devin_acp_error'
    ) as DevinProviderError;
    expect(result.subtype).toBe('devin_session_load_failed');
    expect(result.message).toContain('Session not found');
  });

  test('maps a model lookup failure to devin_unsupported_model using the ACP detail', () => {
    const result = classifyDevinAcpError(
      Object.assign(new Error('Resource not found'), {
        code: -32002,
        data: { uri: 'Model not found: opus. Available models: claude-opus-5-medium' },
      }),
      'devin_acp_error'
    ) as DevinProviderError;
    expect(result.subtype).toBe('devin_unsupported_model');
    expect(result.message).toBe('Model not found: opus. Available models: claude-opus-5-medium');
  });

  test('falls back to the caller subtype with the original message', () => {
    const result = classifyDevinAcpError(new Error('boom'), 'devin_session_load_failed');
    expect(result).toMatchObject({ subtype: 'devin_session_load_failed', message: 'boom' });
  });
});

describe('secret redaction', () => {
  test('collects only secret-named env values of usable length', () => {
    expect(
      collectDevinSecretValues({
        DEVIN_API_TOKEN: 'tok-1234567890',
        PATH: '/usr/bin',
        SHORT_SECRET: 'ab',
        GITHUB_TOKEN: 'ghp_abcdef',
      })
    ).toEqual(['tok-1234567890', 'ghp_abcdef']);
  });

  test('redacts longest secrets first', () => {
    expect(
      redactDevinSecrets('x tok-12345 y tok-12345-long', ['tok-12345', 'tok-12345-long'])
    ).toBe('x [REDACTED] y [REDACTED]');
  });

  test('toDevinErrorResult produces a terminal redacted result without session or usage', () => {
    const result = toDevinErrorResult(
      new DevinProviderError('devin_spawn_failed', 'spawn failed: tok-12345'),
      ['tok-12345']
    );
    expect(result).toEqual({
      type: 'result',
      isError: true,
      errorSubtype: 'devin_spawn_failed',
      errors: ['spawn failed: [REDACTED]'],
    });
    expect(toDevinErrorResult(new Error('plain'), []).errorSubtype).toBe('devin_acp_error');
  });
});
