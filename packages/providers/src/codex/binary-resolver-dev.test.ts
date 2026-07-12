/**
 * Tests for the Codex binary resolver in dev mode (BUNDLED_IS_BINARY=false).
 * Separate file because binary-mode tests mock BUNDLED_IS_BINARY=true.
 */
import { describe, test, expect, mock, beforeEach, afterAll, spyOn } from 'bun:test';
import { createMockLogger } from '../test/mocks/logger';

mock.module('@archon/paths', () => ({
  createLogger: mock(() => createMockLogger()),
  BUNDLED_IS_BINARY: false,
  getArchonHome: mock(() => '/tmp/test-archon-home'),
}));

import * as resolver from './binary-resolver';

describe('resolveCodexBinaryPath (dev mode)', () => {
  const originalEnv = process.env.CODEX_BIN_PATH;
  let fileExistsSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    delete process.env.CODEX_BIN_PATH;
    fileExistsSpy?.mockRestore();
    fileExistsSpy = undefined;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.CODEX_BIN_PATH = originalEnv;
    } else {
      delete process.env.CODEX_BIN_PATH;
    }
    fileExistsSpy?.mockRestore();
  });

  test('returns undefined when BUNDLED_IS_BINARY is false', async () => {
    const result = await resolver.resolveCodexBinaryPath();
    expect(result).toBeUndefined();
  });

  test('returns undefined even with config path set', async () => {
    const result = await resolver.resolveCodexBinaryPath('/some/custom/path');
    expect(result).toBeUndefined();
  });

  test('honors CODEX_BIN_PATH when the file exists', async () => {
    process.env.CODEX_BIN_PATH = '/usr/local/bin/codex';
    fileExistsSpy = spyOn(resolver, 'fileExists').mockReturnValue(true);

    const result = await resolver.resolveCodexBinaryPath();

    expect(result).toBe('/usr/local/bin/codex');
  });

  test('throws when CODEX_BIN_PATH does not exist', async () => {
    process.env.CODEX_BIN_PATH = '/nonexistent/codex';
    fileExistsSpy = spyOn(resolver, 'fileExists').mockReturnValue(false);

    await expect(resolver.resolveCodexBinaryPath()).rejects.toThrow(
      'CODEX_BIN_PATH is set to "/nonexistent/codex" but the file does not exist'
    );
  });

  test('treats an empty CODEX_BIN_PATH as unset', async () => {
    process.env.CODEX_BIN_PATH = '';

    const result = await resolver.resolveCodexBinaryPath();

    expect(result).toBeUndefined();
  });
});
