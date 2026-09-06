import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { access, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import * as exec from './exec';
import { fileAt, fileDiff, GitFileError, hasNulInFirst8k, parseUnifiedDiff } from './file-read';
import { GitPathError } from './git-path';
import { toWorktreePath } from './types';

const NUL_FIXTURE_BYTES = 1_048_577;
const HASH_RE = /^[a-f0-9]{64}$/;

describe('parseUnifiedDiff and hasNulInFirst8k', () => {
  test('does not invent a trailing context line or drop content that resembles a file header', () => {
    const stdout = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -0,0 +1,2 @@',
      '+++ literal-content',
      '+tail',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(stdout)).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        header: '@@ -0,0 +1,2 @@',
        changes: [
          { type: 'insert', content: '++ literal-content', newLine: 1 },
          { type: 'insert', content: 'tail', newLine: 2 },
        ],
      },
    ]);
  });

  test('keeps ordinary text lines that resemble git binary markers', () => {
    const stdout = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-Binary files are ordinary text here',
      '+GIT binary patch is ordinary text here too',
      '',
    ].join('\n');

    expect(parseUnifiedDiff(stdout)).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: '@@ -1 +1 @@',
        changes: [
          {
            type: 'delete',
            content: 'Binary files are ordinary text here',
            oldLine: 1,
          },
          {
            type: 'insert',
            content: 'GIT binary patch is ordinary text here too',
            newLine: 1,
          },
        ],
      },
    ]);
  });

  test('detects NUL only within the first 8192 bytes', () => {
    expect(hasNulInFirst8k(new Uint8Array([1, 0, 2]))).toBe(true);
    const late = new Uint8Array(9000).fill(1);
    late[8192] = 0;
    expect(hasNulInFirst8k(late)).toBe(false);
  });
});

describe('fileAt and fileDiff', () => {
  let root = '';
  let repoPath = '';
  let outsidePath = '';
  let nulFixture: Uint8Array;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-file-read-'));
    repoPath = join(root, 'repo');
    outsidePath = join(root, 'outside');
    await mkdir(repoPath);
    await mkdir(outsidePath);
    await writeFile(join(outsidePath, 'secret.txt'), 'nope\n');
    await exec.execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'test@example.com']);
    await exec.execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Test User']);

    await writeFile(join(repoPath, 'tracked.ts'), 'old line\n');
    await writeFile(join(repoPath, '-dash.ts'), 'dash-head\n');
    await writeFile(join(repoPath, 'path with space.ts'), 'space-head\n');
    // `: *` and newline are reserved/illegal in Windows filenames.
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'colon-head\n');
      await writeFile(join(repoPath, 'foo*.ts'), 'glob-head\n');
      await writeFile(join(repoPath, 'line\nbreak.ts'), 'nl-head\n');
    }
    await writeFile(join(repoPath, 'inside.ts'), 'target-contents\n');
    await writeFile(join(repoPath, 'textconv.ts'), 'textconv-head\n');
    await symlink('inside.ts', join(repoPath, 'in-link.ts'));

    nulFixture = new Uint8Array(NUL_FIXTURE_BYTES);
    nulFixture[0] = 0;
    nulFixture[1] = 1;
    nulFixture[NUL_FIXTURE_BYTES - 1] = 7;
    await writeFile(join(repoPath, 'nul-1mb.bin'), nulFixture);

    await exec.execFileAsync('git', ['-C', repoPath, 'add', '-A']);
    await exec.execFileAsync('git', ['-C', repoPath, 'commit', '-m', 'initial']);

    await writeFile(join(repoPath, 'tracked.ts'), 'new line\n');
    if (process.platform !== 'win32') {
      await writeFile(join(repoPath, ':colon.ts'), 'colon-work\n');
      await writeFile(join(repoPath, 'foo*.ts'), 'glob-work\n');
    }
    await writeFile(join(repoPath, 'added.ts'), 'added-body\n');
    await writeFile(join(repoPath, 'textconv.ts'), 'textconv-worktree\n');
    await writeFile(join(repoPath, 'nul-new.bin'), new Uint8Array([0, 2, 3]));
    await rm(join(repoPath, '-dash.ts'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('HEAD returns committed tracked.ts bytes through ls-tree and cat-file', async () => {
    const result = await fileAt(toWorktreePath(repoPath), 'tracked.ts', {
      kind: 'tree',
      treeIsh: 'HEAD',
    });
    expect(Buffer.from(result.bytes).toString()).toBe('old line\n');
    expect(result.path).toBe('tracked.ts');
    expect(result.binary).toBe(false);
    expect(result.contentHash).toMatch(HASH_RE);
  });

  test('worktree returns modified tracked.ts and added-file bytes', async () => {
    const tracked = await fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'worktree' });
    expect(Buffer.from(tracked.bytes).toString()).toBe('new line\n');

    const added = await fileAt(toWorktreePath(repoPath), 'added.ts', { kind: 'worktree' });
    expect(Buffer.from(added.bytes).toString()).toBe('added-body\n');
  });

  test('HEAD returns deleted -dash.ts content', async () => {
    const result = await fileAt(toWorktreePath(repoPath), '-dash.ts', {
      kind: 'tree',
      treeIsh: 'HEAD',
    });
    expect(Buffer.from(result.bytes).toString()).toBe('dash-head\n');
  });

  test('leading-dash and spaces remain literal pathspecs', async () => {
    const workingPath = toWorktreePath(repoPath);
    expect(
      Buffer.from(
        (await fileAt(workingPath, '-dash.ts', { kind: 'tree', treeIsh: 'HEAD' })).bytes
      ).toString()
    ).toBe('dash-head\n');
    expect(
      Buffer.from(
        (await fileAt(workingPath, 'path with space.ts', { kind: 'tree', treeIsh: 'HEAD' })).bytes
      ).toString()
    ).toBe('space-head\n');
  });

  test.skipIf(process.platform === 'win32')(
    'colon, glob, and newline names remain literal pathspecs',
    async () => {
      const workingPath = toWorktreePath(repoPath);
      expect(
        Buffer.from(
          (await fileAt(workingPath, ':colon.ts', { kind: 'tree', treeIsh: 'HEAD' })).bytes
        ).toString()
      ).toBe('colon-head\n');
      expect(
        Buffer.from((await fileAt(workingPath, ':colon.ts', { kind: 'worktree' })).bytes).toString()
      ).toBe('colon-work\n');
      expect(
        Buffer.from(
          (await fileAt(workingPath, 'foo*.ts', { kind: 'tree', treeIsh: 'HEAD' })).bytes
        ).toString()
      ).toBe('glob-head\n');
      expect(
        Buffer.from((await fileAt(workingPath, 'foo*.ts', { kind: 'worktree' })).bytes).toString()
      ).toBe('glob-work\n');
      expect(
        Buffer.from(
          (await fileAt(workingPath, 'line\nbreak.ts', { kind: 'tree', treeIsh: 'HEAD' })).bytes
        ).toString()
      ).toBe('nl-head\n');
    }
  );

  test.skipIf(process.platform === 'win32')(
    'in-checkout symlink returns the git blob target string',
    async () => {
      const workingPath = toWorktreePath(repoPath);
      const worktree = await fileAt(workingPath, 'in-link.ts', { kind: 'worktree' });
      expect(Buffer.from(worktree.bytes).toString()).toBe('inside.ts');

      const head = await fileAt(workingPath, 'in-link.ts', { kind: 'tree', treeIsh: 'HEAD' });
      expect(Buffer.from(head.bytes).toString()).toBe('inside.ts');
    }
  );

  test.skipIf(process.platform === 'win32')(
    'symlink resolving outside rejects fileAt and fileDiff with GitPathError',
    async () => {
      await symlink(join(outsidePath, 'secret.txt'), join(repoPath, 'escape-link'));
      await expect(
        fileAt(toWorktreePath(repoPath), 'escape-link', { kind: 'worktree' })
      ).rejects.toMatchObject({ name: 'GitPathError', code: 'escape' });
      await expect(fileDiff(toWorktreePath(repoPath), 'escape-link')).rejects.toBeInstanceOf(
        GitPathError
      );
    }
  );

  test.skipIf(process.platform === 'win32')(
    'rejects a worktree path swapped outward between containment and open',
    async () => {
      const fsPromises = await import('fs/promises');
      const originalOpen = fsPromises.open;
      const candidate = join(repoPath, 'race.ts');
      await writeFile(candidate, 'inside\n');
      const openSpy = spyOn(fsPromises, 'open').mockImplementation(
        async (...args: Parameters<typeof originalOpen>): ReturnType<typeof originalOpen> => {
          await rm(candidate);
          await symlink(join(outsidePath, 'secret.txt'), candidate);
          return originalOpen(...args);
        }
      );
      try {
        await expect(
          fileAt(toWorktreePath(repoPath), 'race.ts', { kind: 'worktree' })
        ).rejects.toMatchObject({ name: 'GitPathError', code: 'escape' });
      } finally {
        openSpy.mockRestore();
        await rm(candidate, { force: true });
      }
    }
  );

  test('missing worktree and tree files reject with GitFileError not_found', async () => {
    await expect(
      fileAt(toWorktreePath(repoPath), 'missing.ts', { kind: 'worktree' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'not_found' });
    await expect(
      fileAt(toWorktreePath(repoPath), 'added.ts', { kind: 'tree', treeIsh: 'HEAD' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'not_found' });
  });

  test('missing or invalid tree-ish rejects with GitFileError invalid_ref', async () => {
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: 'not-a-ref' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'invalid_ref' });
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: '' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'invalid_ref' });
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: 'HEAD:tracked.ts' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'invalid_ref' });
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: '-HEAD' })
    ).rejects.toMatchObject({ name: 'GitFileError', code: 'invalid_ref' });
  });

  test('fileDiff reports HEAD-to-worktree delete and insert lines for Now/live/M', async () => {
    const result = await fileDiff(toWorktreePath(repoPath), 'tracked.ts');
    expect(result).toMatchObject({
      path: 'tracked.ts',
      status: 'M',
      scope: 'now',
      ref: 'live',
      cursor: '',
      truncated: false,
      binary: false,
    });
    expect(result.hunks.length).toBeGreaterThan(0);
    const changes = result.hunks.flatMap(hunk => hunk.changes);
    expect(changes).toContainEqual({ type: 'delete', content: 'old line', oldLine: 1 });
    expect(changes).toContainEqual({ type: 'insert', content: 'new line', newLine: 1 });
  });

  test.skipIf(process.platform === 'win32')(
    'fileDiff disables configured textconv commands',
    async () => {
      const marker = join(root, 'textconv-ran');
      const textconv = join(root, 'textconv.sh');
      await writeFile(textconv, `#!/bin/sh\ntouch "${marker}"\ncat "$1"\n`);
      await chmod(textconv, 0o700);
      await writeFile(join(repoPath, '.gitattributes'), 'textconv.ts diff=archon-review\n');
      await exec.execFileAsync('git', [
        '-C',
        repoPath,
        'config',
        'diff.archon-review.textconv',
        textconv,
      ]);

      const result = await fileDiff(toWorktreePath(repoPath), 'textconv.ts');

      expect(result.binary).toBe(false);
      expect(result.hunks.length).toBeGreaterThan(0);
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  test('NUL file returns binary true and no hunks', async () => {
    const result = await fileDiff(toWorktreePath(repoPath), 'nul-new.bin');
    expect(result.binary).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  test('committed 1048577-byte NUL fixture returns every byte', async () => {
    const result = await fileAt(toWorktreePath(repoPath), 'nul-1mb.bin', {
      kind: 'tree',
      treeIsh: 'HEAD',
    });
    expect(result.bytes.byteLength).toBe(NUL_FIXTURE_BYTES);
    expect(result.bytes).toEqual(nulFixture);
    expect(result.binary).toBe(true);
  });

  test('contentHash is 64 lowercase hex and changes when bytes change', async () => {
    const head = await fileAt(toWorktreePath(repoPath), 'tracked.ts', {
      kind: 'tree',
      treeIsh: 'HEAD',
    });
    const work = await fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'worktree' });
    expect(head.contentHash).toMatch(HASH_RE);
    expect(work.contentHash).toMatch(HASH_RE);
    expect(head.contentHash).not.toBe(work.contentHash);
  });

  test('tree reads use literal-pathspecs ls-tree then cat-file blob and never HEAD:path', async () => {
    const originalAsync = exec.execFileAsync;
    const originalBuffer = exec.execFileBufferAsync;
    const asyncSpy = spyOn(exec, 'execFileAsync').mockImplementation(
      (cmd: string, args: string[], options?: Parameters<typeof originalAsync>[2]) =>
        originalAsync(cmd, args, options)
    );
    const bufferSpy = spyOn(exec, 'execFileBufferAsync').mockImplementation(
      (cmd: string, args: string[], options?: Parameters<typeof originalBuffer>[2]) =>
        originalBuffer(cmd, args, options)
    );
    try {
      await fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: 'HEAD' });
      const allArgs = [...asyncSpy.mock.calls, ...bufferSpy.mock.calls].map(
        (call: readonly unknown[]) => call[1] as string[]
      );
      const flat = allArgs.flat();
      expect(flat).toContain('--literal-pathspecs');
      expect(flat).toContain('ls-tree');
      expect(flat).toContain('cat-file');
      expect(
        allArgs.some((args: string[]) => {
          const dash = args.indexOf('--');
          return dash >= 0 && args[dash + 1] === 'tracked.ts';
        })
      ).toBe(true);
      expect(flat.some((arg: string) => arg.includes('HEAD:'))).toBe(false);
    } finally {
      asyncSpy.mockRestore();
      bufferSpy.mockRestore();
    }
  });

  test('invalid_ref is distinct from GitFileError not_found', async () => {
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: 'not-a-ref' })
    ).rejects.not.toMatchObject({ code: 'not_found' });
    await expect(
      fileAt(toWorktreePath(repoPath), 'tracked.ts', { kind: 'tree', treeIsh: 'not-a-ref' })
    ).rejects.toBeInstanceOf(GitFileError);
  });
});
