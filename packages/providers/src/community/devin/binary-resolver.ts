import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { DevinProviderError } from './errors';

export interface DevinRuntimeFacts {
  platform: NodeJS.Platform;
  findOnPath: (
    env: Record<string, string | undefined>,
    platform: NodeJS.Platform
  ) => string | undefined;
}

export interface DevinReadiness {
  binaryPath?: string;
  loggedIn: boolean;
  ready: boolean;
}

const INSTALL_HINT =
  'Install the Devin CLI (https://docs.devin.ai/cli) and put `devin` on PATH, or set DEVIN_BIN_PATH or assistants.devin.binaryPath to its absolute path.';

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function findDevinOnPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string | undefined {
  const lookupCmd = platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, ['devin'], {
      encoding: 'utf-8',
      env: definedEnv(env),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = output.split(/\r?\n/)[0]?.trim();
    if (!first) return undefined;
    return isAbsolute(first) ? first : resolve(first);
  } catch {
    return undefined;
  }
}

function defaultFacts(): DevinRuntimeFacts {
  return { platform: process.platform, findOnPath: findDevinOnPath };
}

function isUsableExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertBinary(path: string, sourceLabel: string, platform: NodeJS.Platform): string {
  if (!isAbsolute(path)) {
    throw new DevinProviderError(
      'devin_binary_missing',
      `${sourceLabel} is set to "${path}" but must be an absolute path. ${INSTALL_HINT}`
    );
  }
  if (!isUsableExecutable(path, platform)) {
    throw new DevinProviderError(
      'devin_binary_missing',
      `${sourceLabel} is set to "${path}" but it is not an executable file. ${INSTALL_HINT}`
    );
  }
  return path;
}

/** Precedence: DEVIN_BIN_PATH → assistants.devin.binaryPath → PATH. */
export function resolveDevinBinary(
  configBinaryPath: string | undefined,
  env: Record<string, string | undefined> = process.env,
  facts: DevinRuntimeFacts = defaultFacts()
): string {
  if (env.DEVIN_BIN_PATH) return assertBinary(env.DEVIN_BIN_PATH, 'DEVIN_BIN_PATH', facts.platform);
  if (configBinaryPath) {
    return assertBinary(configBinaryPath, 'assistants.devin.binaryPath', facts.platform);
  }
  const fromPath = facts.findOnPath(env, facts.platform);
  if (fromPath) return assertBinary(fromPath, 'PATH', facts.platform);
  throw new DevinProviderError('devin_binary_missing', `Devin CLI was not found. ${INSTALL_HINT}`);
}

/**
 * Where `devin auth login` stores the shared machine login. Only the file's
 * existence is ever read — never its contents.
 */
export function devinCredentialsPath(
  env: Record<string, string | undefined> = process.env
): string {
  const dataHome =
    env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
      ? env.XDG_DATA_HOME
      : join(env.HOME && env.HOME.length > 0 ? env.HOME : homedir(), '.local', 'share');
  return join(dataHome, 'devin', 'credentials.toml');
}

/** Status-only readiness for the Agents settings card. Never throws, never reads secrets. */
export function checkDevinReadiness(
  env: Record<string, string | undefined> = process.env,
  facts: DevinRuntimeFacts = defaultFacts()
): DevinReadiness {
  let binaryPath: string | undefined;
  try {
    binaryPath = resolveDevinBinary(undefined, env, facts);
  } catch {
    binaryPath = undefined;
  }
  const loggedIn = existsSync(devinCredentialsPath(env));
  return {
    ...(binaryPath !== undefined ? { binaryPath } : {}),
    loggedIn,
    ready: binaryPath !== undefined && loggedIn,
  };
}

export function assertDevinLoggedIn(env: Record<string, string | undefined> = process.env): void {
  if (existsSync(devinCredentialsPath(env))) return;
  throw new DevinProviderError(
    'devin_not_logged_in',
    'Devin CLI is not logged in on this machine. Run `devin auth login` on the Archon host, then retry.'
  );
}
