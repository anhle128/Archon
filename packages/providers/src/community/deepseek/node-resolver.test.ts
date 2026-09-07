import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { DeepseekProviderError } from './errors';
import {
  resolveBundledDshEntrypoint,
  resolveDeepseekNodeBinary,
  type DeepseekRuntimeFacts,
} from './node-resolver';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function makeFile(name: string, mode?: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-deepseek-node-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  if (mode !== undefined) await chmod(path, mode);
  return path;
}

function facts(
  overrides: Partial<DeepseekRuntimeFacts> & Pick<DeepseekRuntimeFacts, 'execPath'>
): DeepseekRuntimeFacts {
  return {
    isBinary: false,
    isNodeHost: true,
    platform: process.platform,
    findNodeOnPath: () => undefined,
    ...overrides,
  };
}

function expectSubtype(fn: () => unknown, subtype: string): DeepseekProviderError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DeepseekProviderError);
    const typed = error as DeepseekProviderError;
    expect(typed.subtype).toBe(subtype);
    return typed;
  }
  throw new Error(`expected DeepseekProviderError(${subtype})`);
}

describe('resolveDeepseekNodeBinary', () => {
  test('DEEPSEEK_NODE_BIN beats config, host Node, and PATH', async () => {
    const envBin = await makeFile('env-node', 0o755);
    const configBin = await makeFile('config-node', 0o755);
    const hostBin = await makeFile('host-node', 0o755);
    const pathBin = await makeFile('path-node', 0o755);
    expect(
      resolveDeepseekNodeBinary(
        configBin,
        { DEEPSEEK_NODE_BIN: envBin },
        facts({
          execPath: hostBin,
          findNodeOnPath: () => pathBin,
        })
      )
    ).toBe(envBin);
  });

  test('config nodeBin beats host Node and PATH', async () => {
    const configBin = await makeFile('config-node', 0o755);
    const hostBin = await makeFile('host-node', 0o755);
    const pathBin = await makeFile('path-node', 0o755);
    expect(
      resolveDeepseekNodeBinary(
        configBin,
        {},
        facts({
          execPath: hostBin,
          findNodeOnPath: () => pathBin,
        })
      )
    ).toBe(configBin);
  });

  test('host Node executable beats PATH', async () => {
    const hostBin = await makeFile('host-node', 0o755);
    const pathBin = await makeFile('path-node', 0o755);
    expect(
      resolveDeepseekNodeBinary(
        undefined,
        {},
        facts({
          execPath: hostBin,
          isNodeHost: true,
          findNodeOnPath: () => pathBin,
        })
      )
    ).toBe(hostBin);
  });

  test('PATH is used only when the host is not Node', async () => {
    const hostBin = await makeFile('host-node', 0o755);
    const pathBin = await makeFile('path-node', 0o755);
    expect(
      resolveDeepseekNodeBinary(
        undefined,
        {},
        facts({
          execPath: hostBin,
          isNodeHost: false,
          findNodeOnPath: () => pathBin,
        })
      )
    ).toBe(pathBin);
  });

  test('a nonexistent explicit Node path fails with its source label', () => {
    const missing = '/definitely/missing/deepseek-node';
    const envError = expectSubtype(
      () =>
        resolveDeepseekNodeBinary(
          undefined,
          { DEEPSEEK_NODE_BIN: missing },
          facts({
            execPath: '/unused',
          })
        ),
      'deepseek_runtime_unavailable'
    );
    expect(envError.message).toContain('DEEPSEEK_NODE_BIN');
    const configError = expectSubtype(
      () => resolveDeepseekNodeBinary(missing, {}, facts({ execPath: '/unused' })),
      'deepseek_runtime_unavailable'
    );
    expect(configError.message).toContain('assistants.deepseek.nodeBin');
  });

  test('explicit Node paths must be absolute', async () => {
    const absolute = await makeFile('relative-node', 0o755);
    const relativePath = relative(process.cwd(), absolute);
    const error = expectSubtype(
      () =>
        resolveDeepseekNodeBinary(
          undefined,
          { DEEPSEEK_NODE_BIN: relativePath },
          facts({
            execPath: '/unused',
          })
        ),
      'deepseek_runtime_unavailable'
    );
    expect(error.message).toContain('absolute path');
  });

  test('PATH resolution normalizes relative lookup output to an absolute path', async () => {
    const pathBin = await makeFile('path-node', 0o755);
    const relativePath = relative(process.cwd(), pathBin);
    expect(
      resolveDeepseekNodeBinary(
        undefined,
        {},
        facts({
          execPath: '/unused',
          isNodeHost: false,
          findNodeOnPath: () => relativePath,
        })
      )
    ).toBe(resolve(relativePath));
  });

  test('a non-executable POSIX explicit path fails with its source label', async () => {
    const nonExecutable = await makeFile('plain-node', 0o644);
    const error = expectSubtype(
      () =>
        resolveDeepseekNodeBinary(
          undefined,
          { DEEPSEEK_NODE_BIN: nonExecutable },
          facts({
            execPath: '/unused',
            platform: 'linux',
          })
        ),
      'deepseek_runtime_unavailable'
    );
    expect(error.message).toContain('DEEPSEEK_NODE_BIN');
  });

  test('Windows accepts a regular .exe or .cmd file without a POSIX execute-bit check', async () => {
    const exe = await makeFile('node.exe', 0o644);
    const cmd = await makeFile('node.cmd', 0o644);
    expect(
      resolveDeepseekNodeBinary(
        undefined,
        { DEEPSEEK_NODE_BIN: exe },
        facts({
          execPath: '/unused',
          platform: 'win32',
        })
      )
    ).toBe(exe);
    expect(
      resolveDeepseekNodeBinary(
        cmd,
        {},
        facts({
          execPath: '/unused',
          platform: 'win32',
        })
      )
    ).toBe(cmd);
  });
});

describe('resolveBundledDshEntrypoint', () => {
  test('source mode resolves an entry ending in @deepseek-ai/dsh/lib/bin.js', () => {
    const resolved = resolveBundledDshEntrypoint(false);
    expect(resolved.replaceAll('\\', '/')).toMatch(/@deepseek-ai\/dsh\/lib\/bin\.js$/);
  });

  test('binary mode throws deepseek_runtime_unavailable before package resolution', () => {
    const error = expectSubtype(
      () => resolveBundledDshEntrypoint(true),
      'deepseek_runtime_unavailable'
    );
    expect(error.message).toMatch(/source|npm|compiled|binary/i);
  });
});
