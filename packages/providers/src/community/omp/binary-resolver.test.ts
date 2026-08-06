import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveOmpBinaryPath } from './binary-resolver';

const originalEnvPath = process.env.OMP_BIN_PATH;

async function makeExecutable(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-omp-'));
  const path = join(dir, process.platform === 'win32' ? 'omp.exe' : 'omp');
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('resolveOmpBinaryPath', () => {
  afterEach(() => {
    if (originalEnvPath === undefined) delete process.env.OMP_BIN_PATH;
    else process.env.OMP_BIN_PATH = originalEnvPath;
  });

  test('prefers OMP_BIN_PATH over config', async () => {
    const path = await makeExecutable();
    process.env.OMP_BIN_PATH = path;
    try {
      await expect(resolveOmpBinaryPath('/different/omp')).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('uses the config path when the env override is absent', async () => {
    delete process.env.OMP_BIN_PATH;
    const path = await makeExecutable();
    try {
      await expect(resolveOmpBinaryPath(path, {})).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('rejects an invalid explicit path with an actionable label', async () => {
    await expect(
      resolveOmpBinaryPath(undefined, { OMP_BIN_PATH: '/definitely/missing/omp' })
    ).rejects.toThrow('OMP_BIN_PATH');
  });
});
