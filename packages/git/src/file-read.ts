import { createHash } from 'crypto';
import { lstat, readFile, readlink } from 'fs/promises';
import { join } from 'path';

import * as exec from './exec';
import { containLivePath, GitPathError, parseGitFilePath } from './git-path';
import type { RepoPath, WorktreePath } from './types';

export type DiffChange =
  | { type: 'normal'; content: string; oldLine: number; newLine: number }
  | { type: 'insert'; content: string; newLine: number }
  | { type: 'delete'; content: string; oldLine: number };

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  changes: DiffChange[];
}

export interface FileAtResult {
  path: string;
  bytes: Uint8Array;
  binary: boolean;
  contentHash: string;
}

export interface FileDiffResult {
  path: string;
  status: 'M';
  scope: 'now';
  ref: 'live';
  hunks: DiffHunk[];
  cursor: '';
  truncated: false;
  binary: boolean;
}

export type FileAtSource = { kind: 'worktree' } | { kind: 'tree'; treeIsh: string };
type GitFileErrorCode = 'not_found' | 'invalid_ref';

export class GitFileError extends Error {
  readonly code: GitFileErrorCode;

  constructor(code: GitFileErrorCode) {
    super('Git file read failed');
    this.name = 'GitFileError';
    this.code = code;
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hasNulInFirst8k(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(8192, bytes.byteLength)).includes(0);
}

export function parseUnifiedDiff(stdout: string): DiffHunk[] {
  if (stdout.includes('Binary files ') || stdout.includes('GIT binary patch')) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of stdout.split('\n')) {
    const match = HUNK_RE.exec(line);
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? '1'),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? '1'),
        header: line,
        changes: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      current.changes.push({ type: 'insert', content: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.changes.push({ type: 'delete', content: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.changes.push({ type: 'normal', content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

export async function fileAt(
  workingPath: RepoPath | WorktreePath,
  relativePath: string,
  source: FileAtSource
): Promise<FileAtResult> {
  const path = parseGitFilePath(relativePath);
  let bytes: Uint8Array;
  if (source.kind === 'worktree') {
    const candidate = join(workingPath, path);
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(candidate);
    } catch (error) {
      if (isMissing(error)) throw new GitFileError('not_found');
      throw error;
    }
    let canonical: string;
    try {
      canonical = await containLivePath(workingPath, path);
    } catch (error) {
      if (isMissing(error)) throw new GitFileError('not_found');
      throw error;
    }
    const buffer = entry.isSymbolicLink()
      ? Buffer.from(await readlink(candidate))
      : await readFile(canonical);
    bytes = new Uint8Array(buffer);
  } else {
    if (
      source.treeIsh.length === 0 ||
      source.treeIsh.includes('\0') ||
      source.treeIsh.includes(':') ||
      source.treeIsh.startsWith('-')
    ) {
      throw new GitFileError('invalid_ref');
    }
    let listing: { stdout: string };
    try {
      listing = await exec.execFileAsync('git', [
        '-C',
        workingPath,
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        source.treeIsh,
        '--',
        path,
      ]);
    } catch {
      throw new GitFileError('invalid_ref');
    }
    const record = listing.stdout.split('\0').find((value: string): boolean => value.length > 0);
    const tab = record?.indexOf('\t') ?? -1;
    const meta = tab >= 0 ? record?.slice(0, tab).split(' ') : undefined;
    const listedPath = tab >= 0 ? record?.slice(tab + 1) : undefined;
    const blobOid = meta?.[2];
    if (meta?.[1] !== 'blob' || blobOid === undefined || listedPath !== path) {
      throw new GitFileError('not_found');
    }
    const blob = await exec.execFileBufferAsync(
      'git',
      ['-C', workingPath, 'cat-file', 'blob', blobOid],
      { maxBuffer: Number.POSITIVE_INFINITY }
    );
    bytes = new Uint8Array(blob.stdout);
  }
  return {
    path,
    bytes,
    binary: hasNulInFirst8k(bytes),
    contentHash: hashBytes(bytes),
  };
}

async function probeBinary(
  workingPath: RepoPath | WorktreePath,
  path: string,
  source: FileAtSource
): Promise<boolean> {
  try {
    return (await fileAt(workingPath, path, source)).binary;
  } catch (error) {
    if (error instanceof GitPathError) throw error;
    if (error instanceof GitFileError && error.code === 'not_found') return false;
    throw error;
  }
}

export async function fileDiff(
  workingPath: RepoPath | WorktreePath,
  relativePath: string
): Promise<FileDiffResult> {
  const path = parseGitFilePath(relativePath);
  const binary =
    (await probeBinary(workingPath, path, { kind: 'worktree' })) ||
    (await probeBinary(workingPath, path, { kind: 'tree', treeIsh: 'HEAD' }));
  if (binary) {
    return {
      path,
      status: 'M',
      scope: 'now',
      ref: 'live',
      hunks: [],
      cursor: '',
      truncated: false,
      binary: true,
    };
  }
  const diff = await exec.execFileAsync('git', [
    '-C',
    workingPath,
    '--no-optional-locks',
    '--literal-pathspecs',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--text',
    '-U3',
    'HEAD',
    '--',
    path,
  ]);
  return {
    path,
    status: 'M',
    scope: 'now',
    ref: 'live',
    hunks: parseUnifiedDiff(diff.stdout),
    cursor: '',
    truncated: false,
    binary: false,
  };
}
