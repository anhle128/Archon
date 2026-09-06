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
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      // Windows: a timed-out git child can keep the temp tree busy (EBUSY).
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
    }
  });

  test('lists special filenames and changes the revision when porcelain changes', async () => {
    // `: *` and newline are reserved/illegal in Windows filenames. Path
    // parsing still covers those names in git-path.test.ts without touching disk.
    const portableSpecials = [
      { name: '-dash.ts', path: '-dash.ts' },
      { name: 'path with space.ts', path: 'path with space.ts' },
    ];
    const posixOnlySpecials =
      process.platform === 'win32'
        ? []
        : [
            { name: ':colon.ts', path: ':colon.ts' },
            { name: 'foo*.ts', path: 'foo*.ts' },
            { name: 'line\nbreak.ts', path: 'line\nbreak.ts' },
          ];

    for (const file of [...portableSpecials, ...posixOnlySpecials]) {
      await writeFile(join(repoPath, file.name), 'x\n');
    }

    const first = await changedFiles(toWorktreePath(repoPath));

    expect(first.files).toEqual(
      [...portableSpecials, ...posixOnlySpecials]
        .map(file => ({ path: file.path, status: 'A' as const }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    );
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'z-new.ts'), 'x\n');
    const second = await changedFiles(toWorktreePath(repoPath));
    expect(second.revision).not.toBe(first.revision);
  });

  test('distinguishes a git work tree from a plain directory', async () => {
    expect(await isGitWorkTree(toWorktreePath(repoPath))).toBe(true);
    expect(await isGitWorkTree(toWorktreePath(plainPath))).toBe(false);
  });

  describe('does not refresh the git index while reading changes', () => {
    let readOnlyRepoPath = '';
    let trackedPath = '';
    let indexPath = '';

    // Fixture setup is in beforeAll so the timed test is only utimes + status.
    // Six git spawns in the test body exceeded Bun's 5000 ms default on
    // windows-latest under parallel package load (5016 ms).
    beforeAll(async () => {
      readOnlyRepoPath = join(root, 'read-only-repo');
      trackedPath = join(readOnlyRepoPath, 'tracked.ts');
      indexPath = join(readOnlyRepoPath, '.git', 'index');
      await mkdir(readOnlyRepoPath);
      await execFileAsync('git', ['init', '-b', 'main', readOnlyRepoPath]);
      await writeFile(trackedPath, 'unchanged\n');
      await execFileAsync('git', ['-C', readOnlyRepoPath, 'add', '--', 'tracked.ts']);
      await execFileAsync('git', [
        '-C',
        readOnlyRepoPath,
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test User',
        'commit',
        '-m',
        'initial',
      ]);
    });

    test('leaves the index bytes unchanged after a racy mtime', async () => {
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
});
