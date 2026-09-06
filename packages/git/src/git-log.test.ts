import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileAsync } from './exec';
import {
  GIT_LOG_MAX_COMMITS,
  gitLogResultFromStdout,
  isEmptyHistoryError,
  log,
  parseGitLogZ,
} from './git-log';
import { toWorktreePath } from './types';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const SHA256_OID = 'd'.repeat(64);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function record(oid: string, parents: readonly string[], subject: string): string {
  return `${oid}\0${parents.join(' ')}\0Ada\0${'2026-09-06T18:09:18-07:00'}\0${subject}\0`;
}

describe('parseGitLogZ', () => {
  test('parses one commit with two parents', () => {
    const stdout = record(OID_C, [OID_A, OID_B], 'merge feature');

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_C,
        parents: [OID_A, OID_B],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18-07:00',
        subject: 'merge feature',
      },
    ]);
  });

  test('parses a root commit with empty parents', () => {
    const stdout = `${OID_A}\0\0Ada\0${'2026-09-06T18:09:18Z'}\0init\0`;

    expect(parseGitLogZ(stdout)).toEqual([
      {
        oid: OID_A,
        parents: [],
        authorName: 'Ada',
        authorDate: '2026-09-06T18:09:18Z',
        subject: 'init',
      },
    ]);
  });

  test('accepts full SHA-256 object names', () => {
    expect(parseGitLogZ(record(SHA256_OID, [], 'sha256 root'))[0]?.oid).toBe(SHA256_OID);
  });

  test('fails fast on incomplete, non-hex, and mixed-length object names', () => {
    expect(() => parseGitLogZ(`${OID_A}\0`)).toThrow('Malformed git log output');
    expect(() => parseGitLogZ(`not-an-oid\0\0Ada\0${'2026-09-06T00:00:00Z'}\0x\0`)).toThrow(
      'Malformed git log output'
    );
    expect(() => parseGitLogZ(record(SHA256_OID, [OID_A], 'mixed'))).toThrow(
      'Malformed git log output'
    );
  });
});

describe('gitLogResultFromStdout', () => {
  test('does not claim truncation when the repository has exactly 500 returned commits', () => {
    const stdout = Array.from({ length: GIT_LOG_MAX_COMMITS }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      return record(oid, [], `commit-${String(index)}`);
    }).join('');

    const result = gitLogResultFromStdout(stdout);

    expect(result.commits).toHaveLength(500);
    expect(result.truncated).toBe(false);
  });

  test('uses the 501st record only as a truncation sentinel', () => {
    const stdout = Array.from({ length: GIT_LOG_MAX_COMMITS + 1 }, (_, index) => {
      const oid = index.toString(16).padStart(40, '0');
      return record(oid, [], `commit-${String(index)}`);
    }).join('');

    const result = gitLogResultFromStdout(stdout);

    expect(result.commits).toHaveLength(500);
    expect(result.commits[499]?.subject).toBe('commit-499');
    expect(result.commits.some(commit => commit.subject === 'commit-500')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  test('returns the stable empty-content fingerprint without claiming truncation', () => {
    expect(gitLogResultFromStdout('')).toEqual({
      commits: [],
      revision: EMPTY_SHA256,
      truncated: false,
    });
  });
});

describe('isEmptyHistoryError', () => {
  test('detects unborn and missing HEAD wording', () => {
    expect(
      isEmptyHistoryError(
        Object.assign(new Error('x'), { stderr: 'does not have any commits yet' })
      )
    ).toBe(true);
    expect(
      isEmptyHistoryError(Object.assign(new Error("ambiguous argument 'HEAD'"), { stderr: '' }))
    ).toBe(true);
    expect(
      isEmptyHistoryError(
        Object.assign(new Error('x'), {
          stderr: 'unknown revision or path not in the working tree',
        })
      )
    ).toBe(true);
    expect(isEmptyHistoryError(new Error('Permission denied'))).toBe(false);
  });
});

describe('log', () => {
  let root = '';
  let repoPath = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archon-git-log-'));
    repoPath = join(root, 'repo');
    await mkdir(repoPath);
    await execFileAsync('git', ['init', repoPath]);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.email', 'dev@example.com']);
    await execFileAsync('git', ['-C', repoPath, 'config', 'user.name', 'Dev']);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('returns an empty list for an unborn repository', async () => {
    const result = await log(toWorktreePath(repoPath));
    expect(result.commits).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  test('includes merge parents and commits that never landed on dev', async () => {
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'base']);
    await execFileAsync('git', ['-C', repoPath, 'branch', 'dev']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-b', 'feature']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'feature work']);
    await execFileAsync('git', ['-C', repoPath, 'checkout', '-']);
    await execFileAsync('git', ['-C', repoPath, 'commit', '--allow-empty', '-m', 'run work']);
    await execFileAsync('git', ['-C', repoPath, 'merge', 'feature', '-m', 'merge feature']);

    const result = await log(toWorktreePath(repoPath));
    const subjects = result.commits.map(commit => commit.subject);

    expect(subjects).toContain('merge feature');
    expect(subjects).toContain('feature work');
    expect(subjects).toContain('run work');
    expect(subjects).toContain('base');

    const merge = result.commits.find(commit => commit.subject === 'merge feature');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.parents[0]).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    expect(merge?.parents[1]).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    expect(result.truncated).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);

    const { stdout: devOnly } = await execFileAsync('git', [
      '-C',
      repoPath,
      'log',
      '--format=%s',
      'dev',
    ]);
    expect(devOnly).toContain('base');
    expect(devOnly).not.toContain('run work');
    expect(devOnly).not.toContain('feature work');
  });
});
