import { mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, test } from 'bun:test';

import {
  canonicalDirectory,
  resolveTerminalTarget,
  type ResolveTerminalTargetDeps,
  type TerminalIsolationRow,
  type TerminalRunRow,
} from './target';

function runRow(overrides: Partial<TerminalRunRow> = {}): TerminalRunRow {
  return {
    working_path: '/workspace/app',
    metadata: {},
    ...overrides,
  };
}

function containerEnv(overrides: Partial<TerminalIsolationRow> = {}): TerminalIsolationRow {
  return {
    provider: 'container',
    status: 'active',
    metadata: { containerName: 'archon-run-1', containerId: 'stale-id' },
    ...overrides,
  };
}

interface TrackedDeps extends ResolveTerminalTargetDeps {
  inspected: string[];
  canonicalized: string[];
}

function deps(overrides: Partial<ResolveTerminalTargetDeps> = {}): TrackedDeps {
  const inspected: string[] = [];
  const canonicalized: string[] = [];
  return {
    inspected,
    canonicalized,
    async getIsolationEnvById(_id: string): Promise<TerminalIsolationRow | null> {
      return null;
    },
    async canonicalDirectory(path: string): Promise<string | null> {
      canonicalized.push(path);
      return `/canonical${path}`;
    },
    async inspectContainer(handle: string): Promise<'running' | 'stopped' | 'missing'> {
      inspected.push(handle);
      return 'running';
    },
    async resolveContainerShell(_handle: string): Promise<'/bin/bash' | '/bin/sh'> {
      return '/bin/bash';
    },
    resolveHostShell(): string {
      return '/usr/bin/bash';
    },
    ...overrides,
  };
}

describe('canonicalDirectory', () => {
  test('returns the realpath of a directory and null for files or missing paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archon-terminal-'));
    const file = join(dir, 'file.txt');
    await writeFile(file, 'x');
    try {
      expect(await canonicalDirectory(dir)).toBe(await realpath(dir));
      expect(await canonicalDirectory(file)).toBeNull();
      expect(await canonicalDirectory(join(dir, 'missing'))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveTerminalTarget', () => {
  test('host worktree and non-Git folder both return the canonical path and host shell', async () => {
    const worktree = deps();
    expect(
      await resolveTerminalTarget(runRow({ working_path: '/worktrees/run-1' }), worktree)
    ).toEqual({
      kind: 'host',
      cwd: '/canonical/worktrees/run-1',
      shell: '/usr/bin/bash',
    });

    const folder = deps();
    expect(await resolveTerminalTarget(runRow({ working_path: '/ops/folder' }), folder)).toEqual({
      kind: 'host',
      cwd: '/canonical/ops/folder',
      shell: '/usr/bin/bash',
    });
  });

  test('missing, blank, or non-directory working_path returns no_checkout', async () => {
    expect(await resolveTerminalTarget(runRow({ working_path: null }), deps())).toEqual({
      kind: 'unavailable',
      reason: 'no_checkout',
    });
    expect(await resolveTerminalTarget(runRow({ working_path: '   ' }), deps())).toEqual({
      kind: 'unavailable',
      reason: 'no_checkout',
    });
    expect(
      await resolveTerminalTarget(runRow(), deps({ canonicalDirectory: async () => null }))
    ).toEqual({
      kind: 'unavailable',
      reason: 'no_checkout',
    });
  });

  test('container row prefers containerName over a stale containerId', async () => {
    const tracked = deps({
      getIsolationEnvById: async () =>
        containerEnv({
          metadata: { containerName: 'archon-run-1', containerId: 'stale-id' },
        }),
    });
    expect(
      await resolveTerminalTarget(runRow({ metadata: { isolation_env_id: 'env-1' } }), tracked)
    ).toEqual({
      kind: 'container',
      cwd: '/workspace/app',
      handle: 'archon-run-1',
      shell: '/bin/bash',
    });
    expect(tracked.inspected).toEqual(['archon-run-1']);
  });

  test('running container returns run working_path, stable handle, and probed shell', async () => {
    const tracked = deps({
      getIsolationEnvById: async () =>
        containerEnv({
          metadata: {
            containerName: 'archon-run-1',
            working_path: '/isolation/path',
          },
        }),
      resolveContainerShell: async () => '/bin/sh',
    });
    expect(
      await resolveTerminalTarget(
        runRow({ working_path: '/workspace/app', metadata: { isolation_env_id: 'env-1' } }),
        tracked
      )
    ).toEqual({
      kind: 'container',
      cwd: '/workspace/app',
      handle: 'archon-run-1',
      shell: '/bin/sh',
    });
    expect(tracked.canonicalized).toEqual([]);
  });

  test('stopped container returns container_stopped', async () => {
    expect(
      await resolveTerminalTarget(
        runRow({ metadata: { isolation_env_id: 'env-1' } }),
        deps({
          getIsolationEnvById: async () => containerEnv(),
          inspectContainer: async () => 'stopped',
        })
      )
    ).toEqual({ kind: 'unavailable', reason: 'container_stopped' });
  });

  test('destroyed or missing container row, missing handle, or container marker without env id returns container_missing without probing host', async () => {
    const missingRow = deps({ getIsolationEnvById: async () => null });
    expect(
      await resolveTerminalTarget(
        runRow({ metadata: { isolation_env_id: 'env-1', isolation: 'container' } }),
        missingRow
      )
    ).toEqual({ kind: 'unavailable', reason: 'container_missing' });
    expect(missingRow.canonicalized).toEqual([]);

    const destroyed = deps({
      getIsolationEnvById: async () => containerEnv({ status: 'destroyed' }),
    });
    expect(
      await resolveTerminalTarget(runRow({ metadata: { isolation_env_id: 'env-1' } }), destroyed)
    ).toEqual({ kind: 'unavailable', reason: 'container_missing' });
    expect(destroyed.canonicalized).toEqual([]);

    const noHandle = deps({
      getIsolationEnvById: async () => containerEnv({ metadata: {} }),
    });
    expect(
      await resolveTerminalTarget(runRow({ metadata: { isolation_env_id: 'env-1' } }), noHandle)
    ).toEqual({ kind: 'unavailable', reason: 'container_missing' });
    expect(noHandle.canonicalized).toEqual([]);

    const markerOnly = deps();
    expect(
      await resolveTerminalTarget(runRow({ metadata: { isolation: 'container' } }), markerOnly)
    ).toEqual({ kind: 'unavailable', reason: 'container_missing' });
    expect(markerOnly.canonicalized).toEqual([]);

    const inspectMissing = deps({
      getIsolationEnvById: async () => containerEnv(),
      inspectContainer: async () => 'missing',
    });
    expect(
      await resolveTerminalTarget(
        runRow({ metadata: { isolation_env_id: 'env-1' } }),
        inspectMissing
      )
    ).toEqual({ kind: 'unavailable', reason: 'container_missing' });
    expect(inspectMissing.canonicalized).toEqual([]);
  });

  test('vm and remote rows return unsupported_provider', async () => {
    for (const provider of ['vm', 'remote']) {
      const tracked = deps({
        getIsolationEnvById: async () => ({ provider, status: 'active', metadata: {} }),
      });
      expect(
        await resolveTerminalTarget(runRow({ metadata: { isolation_env_id: 'env-1' } }), tracked)
      ).toEqual({ kind: 'unavailable', reason: 'unsupported_provider' });
      expect(tracked.canonicalized).toEqual([]);
    }
  });

  test('worktree isolation row continues through host directory resolution', async () => {
    expect(
      await resolveTerminalTarget(
        runRow({ metadata: { isolation_env_id: 'env-1' } }),
        deps({
          getIsolationEnvById: async () => ({
            provider: 'worktree',
            status: 'active',
            metadata: {},
          }),
        })
      )
    ).toEqual({
      kind: 'host',
      cwd: '/canonical/workspace/app',
      shell: '/usr/bin/bash',
    });
  });

  test('missing isolation row on a non-container-marked worktree run continues through host resolution', async () => {
    expect(
      await resolveTerminalTarget(
        runRow({ metadata: { isolation_env_id: 'env-1' } }),
        deps({ getIsolationEnvById: async () => null })
      )
    ).toEqual({
      kind: 'host',
      cwd: '/canonical/workspace/app',
      shell: '/usr/bin/bash',
    });
  });

  test('unrecognized provider returns unsupported_provider without probing the host path', async () => {
    const tracked = deps({
      getIsolationEnvById: async () => ({
        provider: 'lambda',
        status: 'active',
        metadata: {},
      }),
    });
    expect(
      await resolveTerminalTarget(runRow({ metadata: { isolation_env_id: 'env-1' } }), tracked)
    ).toEqual({ kind: 'unavailable', reason: 'unsupported_provider' });
    expect(tracked.canonicalized).toEqual([]);
  });

  test('forged containerId on run metadata is never inspected', async () => {
    const tracked = deps();
    await resolveTerminalTarget(runRow({ metadata: { containerId: 'forged-id' } }), tracked);
    expect(tracked.inspected).toEqual([]);
  });
});
