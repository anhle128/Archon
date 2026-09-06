import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import {
  changedFiles,
  isGitWorkTree,
  parseNameStatusZ,
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

describe('parseNameStatusZ and commit changedFiles', () => {
  test('maps ordinary, added, deleted, and type-change letters', () => {
    const stdout =
      ['M', 'src/a.ts', 'A', 'new.ts', 'D', 'gone.ts', 'T', 'file.bin'].join('\0') + '\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'file.bin', status: 'M' },
      { path: 'gone.ts', status: 'D' },
      { path: 'new.ts', status: 'A' },
      { path: 'src/a.ts', status: 'M' },
    ]);
  });

  test('projects rename as old D plus new A and copy as new A', () => {
    const stdout = 'R100\0old-name.ts\0new-name.ts\0C100\0source.ts\0copy.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'copy.ts', status: 'A' },
      { path: 'new-name.ts', status: 'A' },
      { path: 'old-name.ts', status: 'D' },
    ]);
  });

  test('preserves spaces and newlines because records are NUL-delimited', () => {
    const stdout = 'A\0path with space.ts\0A\0line\nbreak.ts\0';
    expect(projectChangedFiles(parseNameStatusZ(stdout))).toEqual([
      { path: 'line\nbreak.ts', status: 'A' },
      { path: 'path with space.ts', status: 'A' },
    ]);
  });

  test('fails fast on malformed name-status records', () => {
    expect(() => parseNameStatusZ('M\0')).toThrow('Malformed git name-status output');
    expect(() => parseNameStatusZ('R100\0new.ts\0')).toThrow('Malformed git name-status output');
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

describe('commit changedFiles', () => {
  let root = '';
  let repoPath = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-commit-changed-files-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('lists a commit against its first parent including rename and special names', async () => {
    const workingPath = toWorktreePath(repoPath);
    await writeFile(join(repoPath, 'tracked.ts'), 'old\n');
    await writeFile(join(repoPath, '-dash.ts'), 'dash\n');
    await writeFile(join(repoPath, 'path with space.ts'), 'space\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'colon\n');
      await writeFile(join(repoPath, 'glob*.ts'), 'glob\n');
      await writeFile(join(repoPath, 'line\nbreak.ts'), 'newline\n');
    }
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'root']);
    const rootOid = (
      await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])
    ).stdout.trim();

    const rootFiles = await changedFiles(workingPath, { commit: rootOid });
    expect(rootFiles.files).toEqual(
      expect.arrayContaining([
        { path: '-dash.ts', status: 'A' },
        { path: 'path with space.ts', status: 'A' },
        { path: 'tracked.ts', status: 'A' },
        ...(process.platform === 'win32'
          ? []
          : [
              { path: ':colon.ts', status: 'A' as const },
              { path: 'glob*.ts', status: 'A' as const },
              { path: 'line\nbreak.ts', status: 'A' as const },
            ]),
      ])
    );
    expect(rootFiles.revision).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(repoPath, 'tracked.ts'), 'changed\n');
    await writeFile(join(repoPath, 'added-in-commit.ts'), 'new\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'changed colon\n');
    }
    await execFileAsync('git', ['-C', repoPath, 'rm', '-f', '--', '-dash.ts']);
    await execFileAsync('git', ['-C', repoPath, 'mv', 'path with space.ts', 'renamed space.ts']);
    await execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'delta']);
    const delta = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();

    const files = await changedFiles(workingPath, { commit: delta });
    expect(files.files).toEqual(
      expect.arrayContaining([
        { path: 'tracked.ts', status: 'M' },
        { path: 'added-in-commit.ts', status: 'A' },
        { path: '-dash.ts', status: 'D' },
        { path: 'path with space.ts', status: 'D' },
        { path: 'renamed space.ts', status: 'A' },
        ...(process.platform === 'win32' ? [] : [{ path: ':colon.ts', status: 'M' as const }]),
      ])
    );

    const now = await changedFiles(workingPath);
    expect(now.files.some(file => file.path === 'added-in-commit.ts')).toBe(false);

    await expect(changedFiles(workingPath, { commit: 'HEAD' })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
    await expect(changedFiles(workingPath, { commit: delta.slice(0, 7) })).rejects.toMatchObject({
      name: 'GitCommitRefError',
    });
  });

  test('lists a merge against the first parent only', async () => {
    const mergeRepoPath = join(root, 'merge-repo');
    await mkdir(mergeRepoPath);
    await execFileAsync('git', ['init', '-b', 'main', mergeRepoPath]);
    await execFileAsync('git', ['-C', mergeRepoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'config', 'user.name', 'Dev']);
    const workingPath = toWorktreePath(mergeRepoPath);
    await writeFile(join(mergeRepoPath, 'base.ts'), 'base\n');
    await execFileAsync('git', ['-C', mergeRepoPath, 'add', 'base.ts']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'commit', '-m', 'base']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'checkout', '-b', 'feature']);
    await writeFile(join(mergeRepoPath, 'feature.ts'), 'feature\n');
    await execFileAsync('git', ['-C', mergeRepoPath, 'add', 'feature.ts']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'commit', '-m', 'feature']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'checkout', 'main']);
    await writeFile(join(mergeRepoPath, 'mainline.ts'), 'main\n');
    await execFileAsync('git', ['-C', mergeRepoPath, 'add', 'mainline.ts']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'commit', '-m', 'mainline']);
    await execFileAsync('git', ['-C', mergeRepoPath, 'merge', '--no-ff', 'feature', '-m', 'merge']);
    const merge = (
      await execFileAsync('git', ['-C', mergeRepoPath, 'rev-parse', 'HEAD'])
    ).stdout.trim();

    const files = await changedFiles(workingPath, { commit: merge });
    expect(files.files).toEqual([{ path: 'feature.ts', status: 'A' }]);
  });
});
