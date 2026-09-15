import { describe, expect, test } from 'bun:test';

import { buildDeepseekChildEnv } from './env';

describe('buildDeepseekChildEnv', () => {
  test('request DEEPSEEK_API_KEY beats ambient DEEPSEEK_API_KEY', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'ambient-key', PATH: '/usr/bin' },
      request: { DEEPSEEK_API_KEY: 'request-key' },
      permissionMode: 'workspace-write',
    });
    expect(env.DEEPSEEK_API_KEY).toBe('request-key');
    expect(env.PATH).toBe('/usr/bin');
  });

  test('config baseUrl beats request and ambient DEEPSEEK_BASE_URL', () => {
    const env = buildDeepseekChildEnv({
      ambient: {
        DEEPSEEK_API_KEY: 'k',
        DEEPSEEK_BASE_URL: 'https://ambient.example/v1',
      },
      request: { DEEPSEEK_BASE_URL: 'https://request.example/v1' },
      baseUrl: 'https://config.example/v1',
      permissionMode: 'workspace-write',
    });
    expect(env.DEEPSEEK_BASE_URL).toBe('https://config.example/v1');
  });

  test('request DEEPSEEK_BASE_URL beats ambient when config omits it', () => {
    const env = buildDeepseekChildEnv({
      ambient: {
        DEEPSEEK_API_KEY: 'k',
        DEEPSEEK_BASE_URL: 'https://ambient.example/v1',
      },
      request: { DEEPSEEK_BASE_URL: 'https://request.example/v1' },
      permissionMode: 'workspace-write',
    });
    expect(env.DEEPSEEK_BASE_URL).toBe('https://request.example/v1');
  });

  test('allows DSH-managed credentials when DEEPSEEK_API_KEY is absent', () => {
    const env = buildDeepseekChildEnv({
      ambient: { PATH: '/usr/bin' },
      permissionMode: 'workspace-write',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.DSH_PERMISSION_MODE).toBe('workspace-write');
    expect(Object.hasOwn(env, 'DEEPSEEK_API_KEY')).toBe(false);
  });

  test('default permission writes DSH_PERMISSION_MODE=workspace-write', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k' },
      permissionMode: 'workspace-write',
    });
    expect(env.DSH_PERMISSION_MODE).toBe('workspace-write');
  });

  test('explicit dangerous mode writes DSH_PERMISSION_MODE=danger-full-access', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k' },
      permissionMode: 'danger-full-access',
    });
    expect(env.DSH_PERMISSION_MODE).toBe('danger-full-access');
  });

  test('does not write DSH_PROVIDER_ROUTE', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k', HOME: '/tmp' },
      request: { ARCHON_RUN: '1' },
      permissionMode: 'workspace-write',
    });
    expect(Object.hasOwn(env, 'DSH_PROVIDER_ROUTE')).toBe(false);
  });

  test('filters undefined ambient entries and overlays request values', () => {
    const env = buildDeepseekChildEnv({
      ambient: { DEEPSEEK_API_KEY: 'k', DROP: undefined, KEEP: 'yes' },
      request: { KEEP: 'overridden' },
      permissionMode: 'workspace-write',
    });
    expect(Object.hasOwn(env, 'DROP')).toBe(false);
    expect(env.KEEP).toBe('overridden');
  });
});
