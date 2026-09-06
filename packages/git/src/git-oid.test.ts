import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { execFileAsync } from './exec';
import { GitCommitRefError, parseGitObjectId, resolveCommitParents } from './git-oid';
import { toWorktreePath } from './types';

describe('parseGitObjectId', () => {
  test('accepts full SHA-1 and SHA-256 object names', () => {
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);
    expect(parseGitObjectId(sha1)).toBe(sha1);
    expect(parseGitObjectId(sha256)).toBe(sha256);
  });

  test('rejects empty, short, uppercase, live, HEAD, and peel syntax', () => {
    for (const value of [
      '',
      'abc',
      'A'.repeat(40),
      'live',
      'HEAD',
      'origin/dev',
      `${'a'.repeat(40)}:path`,
    ]) {
      expect(() => parseGitObjectId(value)).toThrow(GitCommitRefError);
    }
  });
});

describe('resolveCommitParents', () => {
  let root = '';
  let repoPath = '';
  let rootOid = '';
  let childOid = '';
  let blobOid = '';
  let unreachableOid = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-oid-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', '-b', 'main', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'root']);
    rootOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(repoPath, 'loose-blob.txt'), 'not a commit\n');
    blobOid = (
      await execFileAsync('git', ['-C', repoPath, 'hash-object', '-w', 'loose-blob.txt'])
    ).stdout.trim();
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'child']);
    childOid = (await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout.trim();
    unreachableOid = (
      await execFileAsync('git', [
        '-C',
        repoPath,
        'commit-tree',
        `${childOid}^{tree}`,
        '-p',
        rootOid,
        '-m',
        'unreachable sibling',
      ])
    ).stdout.trim();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns no parents for a reachable root and the exact parent for a reachable child', async () => {
    expect(await resolveCommitParents(toWorktreePath(repoPath), rootOid)).toEqual([]);
    expect(await resolveCommitParents(toWorktreePath(repoPath), childOid)).toEqual([rootOid]);
  });

  test('rejects a missing object, a non-commit object, and an unreachable commit', async () => {
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), 'a'.repeat(40))
    ).rejects.toBeInstanceOf(GitCommitRefError);
    await expect(resolveCommitParents(toWorktreePath(repoPath), blobOid)).rejects.toBeInstanceOf(
      GitCommitRefError
    );
    await expect(
      resolveCommitParents(toWorktreePath(repoPath), unreachableOid)
    ).rejects.toBeInstanceOf(GitCommitRefError);
  });
});
