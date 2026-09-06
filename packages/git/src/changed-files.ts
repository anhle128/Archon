import { createHash } from 'crypto';

import { execFileAsync } from './exec';
import { parseGitObjectId, resolveCommitParents } from './git-oid';
import type { RepoPath, WorktreePath } from './types';

export type ChangedFileStatus = 'M' | 'A' | 'D';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
}

export interface PorcelainEntry {
  xy: string;
  path: string;
  origPath?: string;
}

export interface ChangedFilesResult {
  files: ChangedFile[];
  revision: string;
}

export interface ChangedFilesRequest {
  commit?: string;
}

function isRenameOrCopy(xy: string): boolean {
  return xy.includes('R') || xy.includes('C');
}

const UNMERGED_STATES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function parsePorcelainV1Z(stdout: string): PorcelainEntry[] {
  const records = stdout.split('\0');
  const entries: PorcelainEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === '') continue;
    if (record === undefined || record.length < 4 || record[2] !== ' ') {
      throw new Error('Malformed git status output');
    }

    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (path.length === 0) throw new Error('Malformed git status output');

    if (isRenameOrCopy(xy)) {
      const origPath = records[index + 1];
      if (!origPath) throw new Error('Malformed git status output');
      entries.push({ xy, path, origPath });
      index += 1;
      continue;
    }

    entries.push({ xy, path });
  }

  return entries;
}

export function parseNameStatusZ(stdout: string): PorcelainEntry[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < records.length; ) {
    const status = records[index] ?? '';
    if (status.length === 0) throw new Error('Malformed git name-status output');
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const origPath = records[index + 1];
      const path = records[index + 2];
      if (!origPath || !path) throw new Error('Malformed git name-status output');
      entries.push({ xy: code, path, origPath });
      index += 3;
      continue;
    }
    const path = records[index + 1];
    if (!path) throw new Error('Malformed git name-status output');
    entries.push({ xy: code === 'U' ? 'UU' : code, path });
    index += 2;
  }
  return entries;
}

function projectStatus(xy: string): ChangedFileStatus {
  if (UNMERGED_STATES.has(xy) || xy.includes('T')) return 'M';
  if (xy.includes('D')) return 'D';
  if (xy === '??' || xy.includes('A')) return 'A';
  return 'M';
}

export function projectChangedFiles(entries: readonly PorcelainEntry[]): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const entry of entries) {
    if (entry.xy === '!!') continue;

    if (entry.xy.includes('R')) {
      if (!entry.origPath) throw new Error('Malformed git status output');
      files.push({ path: entry.origPath, status: 'D' });
      files.push({ path: entry.path, status: 'A' });
      continue;
    }

    if (entry.xy.includes('C')) {
      files.push({ path: entry.path, status: 'A' });
      continue;
    }

    files.push({ path: entry.path, status: projectStatus(entry.xy) });
  }

  return files.sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return left.status < right.status ? -1 : left.status > right.status ? 1 : 0;
  });
}

export async function isGitWorkTree(workingPath: RepoPath | WorktreePath): Promise<boolean> {
  try {
    const result = await execFileAsync('git', [
      '-C',
      workingPath,
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    return result.stdout.trim() === 'true';
  } catch {
    // Intentional CAP-6 probe: missing, unreadable, and non-git paths are unavailable checkouts.
    return false;
  }
}

export async function changedFiles(
  workingPath: RepoPath | WorktreePath,
  request?: ChangedFilesRequest
): Promise<ChangedFilesResult> {
  if (request?.commit !== undefined) {
    const commit = parseGitObjectId(request.commit);
    const parents = await resolveCommitParents(workingPath, commit);
    const args =
      parents[0] === undefined
        ? [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '--no-commit-id',
            '--root',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            commit,
          ]
        : [
            '-C',
            workingPath,
            '--literal-pathspecs',
            '--no-optional-locks',
            'diff-tree',
            '--no-commit-id',
            '-r',
            '--name-status',
            '-z',
            '-M',
            '-C',
            parents[0],
            commit,
          ];
    const status = await execFileAsync('git', args);
    return {
      files: projectChangedFiles(parseNameStatusZ(status.stdout)),
      revision: createHash('sha256')
        .update(commit)
        .update('\0')
        .update(status.stdout)
        .digest('hex'),
    };
  }

  const status = await execFileAsync('git', [
    '-C',
    workingPath,
    '--literal-pathspecs',
    '--no-optional-locks',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);

  let headSha = '';
  try {
    const head = await execFileAsync('git', ['-C', workingPath, 'rev-parse', '--verify', 'HEAD']);
    headSha = head.stdout.trim();
  } catch {
    // Intentional safe fallback: an unborn repository has status data but no HEAD commit.
  }

  return {
    files: projectChangedFiles(parsePorcelainV1Z(status.stdout)),
    revision: createHash('sha256').update(headSha).update('\0').update(status.stdout).digest('hex'),
  };
}
