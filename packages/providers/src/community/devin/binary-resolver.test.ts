import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertDevinLoggedIn,
  checkDevinReadiness,
  devinCredentialsPath,
  resolveDevinBinary,
  type DevinRuntimeFacts,
} from './binary-resolver';
import { DevinProviderError } from './errors';

let dir: string;
let fakeBin: string;

function facts(found?: string): DevinRuntimeFacts {
  return { platform: process.platform, findOnPath: () => found };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'archon-devin-bin-'));
  fakeBin = join(dir, 'devin');
  writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') chmodSync(fakeBin, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveDevinBinary', () => {
  test('DEVIN_BIN_PATH beats config which beats PATH', () => {
    expect(resolveDevinBinary('/nope', { DEVIN_BIN_PATH: fakeBin }, facts('/also-nope'))).toBe(
      fakeBin
    );
    expect(resolveDevinBinary(fakeBin, {}, facts('/also-nope'))).toBe(fakeBin);
    expect(resolveDevinBinary(undefined, {}, facts(fakeBin))).toBe(fakeBin);
  });

  test('rejects relative env paths and unusable files', () => {
    expect(() => resolveDevinBinary(undefined, { DEVIN_BIN_PATH: 'devin' }, facts())).toThrow(
      /DEVIN_BIN_PATH is set to "devin" but must be an absolute path/
    );
    expect(() => resolveDevinBinary(join(dir, 'missing'), {}, facts())).toThrow(DevinProviderError);
  });

  test('throws devin_binary_missing with install guidance when nothing resolves', () => {
    try {
      resolveDevinBinary(undefined, {}, facts(undefined));
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DevinProviderError);
      expect((error as DevinProviderError).subtype).toBe('devin_binary_missing');
      expect((error as Error).message).toContain('Install the Devin CLI');
    }
  });
});

describe('login readiness', () => {
  test('credentials path honors XDG_DATA_HOME and falls back to ~/.local/share', () => {
    expect(devinCredentialsPath({ XDG_DATA_HOME: '/xdg' })).toBe(
      join('/xdg', 'devin', 'credentials.toml')
    );
    expect(devinCredentialsPath({ HOME: '/home/u' })).toBe(
      join('/home/u', '.local', 'share', 'devin', 'credentials.toml')
    );
  });

  test('checkDevinReadiness reports binary + login without throwing', () => {
    const dataHome = join(dir, 'data');
    mkdirSync(join(dataHome, 'devin'), { recursive: true });
    const env = { DEVIN_BIN_PATH: fakeBin, XDG_DATA_HOME: dataHome };
    expect(checkDevinReadiness(env, facts())).toEqual({
      binaryPath: fakeBin,
      loggedIn: false,
      ready: false,
    });
    writeFileSync(join(dataHome, 'devin', 'credentials.toml'), '');
    expect(checkDevinReadiness(env, facts())).toEqual({
      binaryPath: fakeBin,
      loggedIn: true,
      ready: true,
    });
    expect(checkDevinReadiness({ XDG_DATA_HOME: dataHome }, facts(undefined))).toEqual({
      loggedIn: true,
      ready: false,
    });
  });

  test('assertDevinLoggedIn throws devin_not_logged_in when the credentials file is absent', () => {
    expect(() => assertDevinLoggedIn({ XDG_DATA_HOME: join(dir, 'empty') })).toThrow(
      /Run `devin auth login` on the Archon host/
    );
  });
});
