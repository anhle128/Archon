import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { containLivePath, GitPathError, parseGitFilePath } from './git-path';

describe('parseGitFilePath', () => {
  test('accepts server-issued special relative names', () => {
    for (const path of [
      ':colon.ts',
      '-dash.ts',
      'foo*.ts',
      'path with space.ts',
      'line\nbreak.ts',
      'src/a.ts',
    ]) {
      expect(parseGitFilePath(path)).toBe(path);
    }
  });

  test('rejects empty, NUL, POSIX absolute, Windows absolute, and dot-dot segments', () => {
    for (const path of [
      '',
      'a\0b',
      '/etc/passwd',
      '\\\\server\\share',
      'C:\\Windows\\x',
      '../x',
      'a/../x',
      'a\\..\\x',
    ]) {
      expect(() => parseGitFilePath(path)).toThrow(GitPathError);
    }
  });
});

describe('containLivePath', () => {
  let root = '';
  let checkout = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-path-'));
    checkout = join(root, 'checkout');
    await mkdir(checkout);
    await writeFile(join(checkout, 'inside.ts'), 'ok\n');
    await mkdir(join(root, 'outside'));
    await writeFile(join(root, 'outside', 'secret.txt'), 'nope\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns the canonical file beneath the canonical checkout', async () => {
    const path = await containLivePath(checkout, 'inside.ts');
    expect(path.endsWith('inside.ts')).toBe(true);
  });

  test.skipIf(process.platform === 'win32')('rejects a symlink that resolves outside', async () => {
    await symlink(join(root, 'outside'), join(checkout, 'escape'));
    await expect(containLivePath(checkout, 'escape/secret.txt')).rejects.toMatchObject({
      name: 'GitPathError',
      code: 'escape',
    });
  });
});
