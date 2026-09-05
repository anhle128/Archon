import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import {
  changedFiles,
  isGitWorkTree,
  parsePorcelainV1Z,
  projectChangedFiles,
} from './changed-files';
import { toWorktreePath } from './types';

describe('parsePorcelainV1Z and projectChangedFiles', () => {
  test('maps ordinary, untracked, deleted, type-change, and every unmerged state', () => {
    const stdout =
      [
        ' M src/a.ts',
        '?? new.ts',
        'D  gone.ts',
        'T  file.bin',
        'DD both-deleted.ts',
        'AA both-added.ts',
        'UU conflict.ts',
      ].join('\0') + '\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'both-added.ts', status: 'M' },
      { path: 'both-deleted.ts', status: 'M' },
      { path: 'conflict.ts', status: 'M' },
      { path: 'file.bin', status: 'M' },
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects rename as old D plus new A and copy as new A', () => {
    const stdout = 'R  new-name.ts\0old-name.ts\0C  copy.ts\0source.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('uses the provisional deletion-before-addition precedence for compound states', () => {
    const stdout = 'AD staged-then-deleted.ts\0MM twice-modified.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'staged-then-deleted.ts', status: 'D' },
      { path: 'twice-modified.ts', status: 'M' },
    ]);
  });

  test('preserves spaces and newlines because records are NUL-delimited', () => {
    const stdout = '?? path with space.ts\0?? line\nbreak.ts\0';

    expect(projectChangedFiles(parsePorcelainV1Z(stdout))).toEqual([
      { path: 'line\nbreak.ts', status: 'A' },
      { path: 'path with space.ts', status: 'A' },
    ]);
  });

  test('fails fast on malformed porcelain records', () => {
    expect(() => parsePorcelainV1Z('??\0')).toThrow('Malformed git status output');
    expect(() => parsePorcelainV1Z('R  new.ts\0')).toThrow('Malformed git status output');
  });
});

describe('changedFiles and isGitWorkTree', () => {
  let root = '';
  let repoPath = '';
  let plainPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-changed-files-'));
    repoPath = join(root, 'repo');
    plainPath = join(root, 'plain');
    await mkdir(repoPath);
    await mkdir(plainPath);
    await execFileAsync('git', ['init', repoPath]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists special filenames and changes the revision when porcelain changes', async () => {
    await writeFile(join(repoPath, ':colon.ts'), 'x\n');
    await writeFile(join(repoPath, '-dash.ts'), 'x\n');
    await writeFile(join(repoPath, 'foo*.ts'), 'x\n');
    await writeFile(join(repoPath, 'line\nbreak.ts'), 'x\n');

    const first = await changedFiles(toWorktreePath(repoPath));

    expect(first.files).toEqual([
      { path: '-dash.ts', status: 'A' },
      { path: ':colon.ts', status: 'A' },
      { path: 'foo*.ts', status: 'A' },
      { path: 'line\nbreak.ts', status: 'A' },
    ]);
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'z-new.ts'), 'x\n');
    const second = await changedFiles(toWorktreePath(repoPath));
    expect(second.revision).not.toBe(first.revision);
  });

  test('distinguishes a git work tree from a plain directory', async () => {
    expect(await isGitWorkTree(toWorktreePath(repoPath))).toBe(true);
    expect(await isGitWorkTree(toWorktreePath(plainPath))).toBe(false);
  });

  test('does not refresh the git index while reading changes', async () => {
    const readOnlyRepoPath = join(root, 'read-only-repo');
    const trackedPath = join(readOnlyRepoPath, 'tracked.ts');
    await mkdir(readOnlyRepoPath);
    await execFileAsync('git', ['init', readOnlyRepoPath]);
    await execFileAsync('git', [
      '-C',
      readOnlyRepoPath,
      'config',
      'user.email',
      'test@example.com',
    ]);
    await execFileAsync('git', ['-C', readOnlyRepoPath, 'config', 'user.name', 'Test User']);
    await writeFile(trackedPath, 'unchanged\n');
    await execFileAsync('git', ['-C', readOnlyRepoPath, 'add', '--', 'tracked.ts']);
    await execFileAsync('git', ['-C', readOnlyRepoPath, 'commit', '-m', 'initial']);

    const indexPath = join(readOnlyRepoPath, '.git', 'index');
    const indexBefore = await readFile(indexPath);
    const future = new Date(Date.now() + 60_000);
    await utimes(trackedPath, future, future);

    expect(await changedFiles(toWorktreePath(readOnlyRepoPath))).toEqual({
      files: [],
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readFile(indexPath)).toEqual(indexBefore);
  });
});
