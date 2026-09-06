import { describe, expect, test } from 'bun:test';

import { resolveRunCheckout } from './checkout-gate';

type GateInput = Parameters<typeof resolveRunCheckout>[0];

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    run: { conversation_id: 'conv-1', working_path: '/checkout' },
    getConversationById: async () => ({ isolation_env_id: null }),
    getIsolationEnvById: async () => null,
    pathExists: async () => true,
    realpathFn: async path => path,
    isGitWorkTree: async () => true,
    ...overrides,
  };
}

describe('resolveRunCheckout', () => {
  test('returns run_not_found before database or filesystem work', async () => {
    let lookupCount = 0;
    const result = await resolveRunCheckout(
      input({
        run: null,
        getConversationById: async () => {
          lookupCount += 1;
          return null;
        },
      })
    );

    expect(result).toEqual({ kind: 'run_not_found' });
    expect(lookupCount).toBe(0);
  });

  test('returns container before checking a null or stale host path', async () => {
    let pathProbeCount = 0;
    const result = await resolveRunCheckout(
      input({
        run: { conversation_id: 'conv-1', working_path: null },
        getConversationById: async () => ({ isolation_env_id: 'env-1' }),
        getIsolationEnvById: async () => ({ provider: 'container' }),
        pathExists: async () => {
          pathProbeCount += 1;
          return false;
        },
      })
    );

    expect(result).toEqual({ kind: 'empty', emptyReason: 'container' });
    expect(pathProbeCount).toBe(0);
  });

  test('falls through when conversation, env id, or env row is missing', async () => {
    expect(await resolveRunCheckout(input({ getConversationById: async () => null }))).toEqual({
      kind: 'ready',
      workingPath: '/checkout',
    });

    expect(
      await resolveRunCheckout(
        input({ getConversationById: async () => ({ isolation_env_id: null }) })
      )
    ).toEqual({ kind: 'ready', workingPath: '/checkout' });

    expect(
      await resolveRunCheckout(
        input({
          getConversationById: async () => ({ isolation_env_id: 'missing' }),
          getIsolationEnvById: async () => null,
        })
      )
    ).toEqual({ kind: 'ready', workingPath: '/checkout' });
  });

  test('returns no_checkout for null, missing, unresolvable, and non-git paths', async () => {
    expect(
      await resolveRunCheckout(input({ run: { conversation_id: 'conv-1', working_path: null } }))
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });

    expect(await resolveRunCheckout(input({ pathExists: async () => false }))).toEqual({
      kind: 'empty',
      emptyReason: 'no_checkout',
    });

    expect(
      await resolveRunCheckout(
        input({
          realpathFn: async () => {
            throw new Error('gone');
          },
        })
      )
    ).toEqual({ kind: 'empty', emptyReason: 'no_checkout' });

    expect(await resolveRunCheckout(input({ isGitWorkTree: async () => false }))).toEqual({
      kind: 'empty',
      emptyReason: 'no_checkout',
    });
  });

  test('returns the canonical realpath to the caller', async () => {
    const result = await resolveRunCheckout(
      input({ realpathFn: async () => '/canonical/checkout' })
    );

    expect(result).toEqual({ kind: 'ready', workingPath: '/canonical/checkout' });
  });

  test('only container is CAP-6 before the host probe', async () => {
    for (const provider of ['worktree', 'vm', 'remote', 'future-provider']) {
      const result = await resolveRunCheckout(
        input({
          getConversationById: async () => ({ isolation_env_id: 'env-1' }),
          getIsolationEnvById: async () => ({ provider }),
        })
      );
      expect(result).toEqual({ kind: 'ready', workingPath: '/checkout' });
    }
  });
});
