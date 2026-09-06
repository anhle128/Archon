import { createHash } from 'crypto';

import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const GIT_LOG_MAX_COMMITS = 500;

const FULL_OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface GitLogCommit {
  oid: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface GitLogResult {
  commits: GitLogCommit[];
  revision: string;
  truncated: boolean;
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const err = error as Error & { stderr?: string };
  return `${err.message} ${err.stderr ?? ''}`;
}

export function isEmptyHistoryError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('does not have any commits yet') ||
    text.includes('unknown revision or path not in the working tree') ||
    text.includes("ambiguous argument 'HEAD'")
  );
}

export function parseGitLogZ(stdout: string): GitLogCommit[] {
  const records = stdout.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  if (records.length % 5 !== 0) throw new Error('Malformed git log output');

  const commits: GitLogCommit[] = [];
  for (let index = 0; index < records.length; index += 5) {
    const oid = records[index] ?? '';
    const parentsRaw = records[index + 1] ?? '';
    const authorName = records[index + 2] ?? '';
    const authorDate = records[index + 3] ?? '';
    const subject = records[index + 4] ?? '';
    if (!FULL_OID_RE.test(oid)) throw new Error('Malformed git log output');
    const parents = parentsRaw === '' ? [] : parentsRaw.split(' ').filter(Boolean);
    if (parents.some(parent => !FULL_OID_RE.test(parent) || parent.length !== oid.length)) {
      throw new Error('Malformed git log output');
    }
    commits.push({ oid, parents, authorName, authorDate, subject });
  }
  return commits;
}

export function gitLogResultFromStdout(stdout: string): GitLogResult {
  const parsed = parseGitLogZ(stdout);
  return {
    commits: parsed.slice(0, GIT_LOG_MAX_COMMITS),
    revision: createHash('sha256').update(stdout).digest('hex'),
    truncated: parsed.length > GIT_LOG_MAX_COMMITS,
  };
}

export async function log(workingPath: RepoPath | WorktreePath): Promise<GitLogResult> {
  let stdout = '';
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        workingPath,
        '--no-optional-locks',
        'log',
        '--date-order',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        '-z',
        `--max-count=${String(GIT_LOG_MAX_COMMITS + 1)}`,
        'HEAD',
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (error) {
    if (!isEmptyHistoryError(error)) throw error;
    stdout = '';
  }

  return gitLogResultFromStdout(stdout);
}
