import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveGrokBinaryPath } from './binary-resolver';

const originalEnvPath = process.env.GROK_BIN_PATH;

async function makeExecutable(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-grok-'));
  const path = join(dir, process.platform === 'win32' ? 'grok.exe' : 'grok');
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('resolveGrokBinaryPath', () => {
  afterEach(() => {
    if (originalEnvPath === undefined) delete process.env.GROK_BIN_PATH;
    else process.env.GROK_BIN_PATH = originalEnvPath;
  });

  test('prefers GROK_BIN_PATH over config', async () => {
    const path = await makeExecutable();
    process.env.GROK_BIN_PATH = path;
    try {
      await expect(resolveGrokBinaryPath('/different/grok')).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('uses the config path when the env override is absent', async () => {
    delete process.env.GROK_BIN_PATH;
    const path = await makeExecutable();
    try {
      await expect(resolveGrokBinaryPath(path, {})).resolves.toBe(path);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  test('rejects an invalid explicit path with an actionable label', async () => {
    await expect(
      resolveGrokBinaryPath(undefined, { GROK_BIN_PATH: '/definitely/missing/grok' })
    ).rejects.toThrow('GROK_BIN_PATH');
  });
});
