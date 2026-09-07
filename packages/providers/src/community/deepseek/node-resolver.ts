import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BUNDLED_IS_BINARY } from '@archon/paths';

import { DeepseekProviderError } from './errors';

export interface DeepseekRuntimeFacts {
  isBinary: boolean;
  execPath: string;
  isNodeHost: boolean;
  platform: NodeJS.Platform;
  findNodeOnPath: (
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => string | undefined;
}

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function findNodeOnPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string | undefined {
  const lookupCmd = platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, ['node'], {
      encoding: 'utf-8',
      env: definedEnv(env),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultFacts(): DeepseekRuntimeFacts {
  return {
    isBinary: BUNDLED_IS_BINARY,
    execPath: process.execPath,
    isNodeHost: process.versions.bun === undefined,
    platform: process.platform,
    findNodeOnPath,
  };
}

function isUsableNodeBinary(
  path: string,
  platform: NodeJS.Platform
): 'missing' | 'not-file' | 'ok' {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return 'not-file';
    if (platform !== 'win32') accessSync(path, fsConstants.X_OK);
    return 'ok';
  } catch {
    return 'missing';
  }
}

function assertNodeBinary(path: string, sourceLabel: string, platform: NodeJS.Platform): string {
  const status = isUsableNodeBinary(path, platform);
  if (status === 'ok') return path;
  const reason =
    status === 'not-file'
      ? 'it is not an executable file'
      : platform === 'win32'
        ? 'the file does not exist'
        : 'the file does not exist or is not executable';
  throw new DeepseekProviderError(
    'deepseek_runtime_unavailable',
    `${sourceLabel} is set to "${path}" but ${reason}. Provide a Node.js executable via DEEPSEEK_NODE_BIN, assistants.deepseek.nodeBin, or PATH.`
  );
}

/**
 * Resolve a spawnable Node binary for DSH.
 * Precedence: DEEPSEEK_NODE_BIN → config nodeBin → host process.execPath (Node host) → PATH.
 */
export function resolveDeepseekNodeBinary(
  configNodeBin: string | undefined,
  env: Record<string, string | undefined> = process.env,
  facts: DeepseekRuntimeFacts = defaultFacts()
): string {
  if (env.DEEPSEEK_NODE_BIN) {
    return assertNodeBinary(env.DEEPSEEK_NODE_BIN, 'DEEPSEEK_NODE_BIN', facts.platform);
  }
  if (configNodeBin) {
    return assertNodeBinary(configNodeBin, 'assistants.deepseek.nodeBin', facts.platform);
  }
  if (facts.isNodeHost) {
    return assertNodeBinary(facts.execPath, 'process.execPath', facts.platform);
  }
  const fromPath = facts.findNodeOnPath(env, facts.platform);
  if (fromPath) {
    return assertNodeBinary(fromPath, 'PATH', facts.platform);
  }
  throw new DeepseekProviderError(
    'deepseek_runtime_unavailable',
    'A Node.js executable is required to run DeepSeek Harness. Set DEEPSEEK_NODE_BIN, configure assistants.deepseek.nodeBin, or install Node on PATH.'
  );
}

/**
 * Resolve the pinned DSH ACP entrypoint. Compiled binaries cannot spawn DSH from
 * Bun's embedded filesystem, so binary mode fails before package resolution.
 */
export function resolveBundledDshEntrypoint(isBinary: boolean = BUNDLED_IS_BINARY): string {
  if (isBinary) {
    throw new DeepseekProviderError(
      'deepseek_runtime_unavailable',
      'DeepSeek Harness cannot run from a compiled Archon binary because Node cannot execute DSH from the embedded filesystem. Use a source or npm install of Archon instead.'
    );
  }
  const resolved = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js');
  try {
    if (!statSync(resolved).isFile()) {
      throw new Error('not a regular file');
    }
  } catch (error) {
    throw new DeepseekProviderError(
      'deepseek_runtime_unavailable',
      `Resolved DSH entrypoint "${resolved}" is not a regular file.`,
      { cause: error }
    );
  }
  return resolved;
}
