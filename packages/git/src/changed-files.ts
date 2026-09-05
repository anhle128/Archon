import { createHash } from 'crypto';

import { execFileAsync } from './exec';
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
  workingPath: RepoPath | WorktreePath
): Promise<ChangedFilesResult> {
  const status = await execFileAsync('git', [
    '-C',
    workingPath,
    '--literal-pathspecs',
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
