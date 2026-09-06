import { execFileAsync } from './exec';
import type { RepoPath, WorktreePath } from './types';

export const FULL_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCommitRefError extends Error {
  readonly code = 'invalid_ref' as const;

  constructor() {
    super('Invalid git commit ref');
    this.name = 'GitCommitRefError';
  }
}

export function parseGitObjectId(raw: string): string {
  if (!FULL_GIT_OBJECT_ID_RE.test(raw)) throw new GitCommitRefError();
  return raw;
}

function hasExitCode(error: unknown, code: number): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === code;
}

export async function resolveCommitParents(
  workingPath: RepoPath | WorktreePath,
  oid: string
): Promise<string[]> {
  const parsed = parseGitObjectId(oid);
  try {
    const verified = await execFileAsync('git', [
      '-C',
      workingPath,
      '--no-optional-locks',
      'rev-parse',
      '--verify',
      '--quiet',
      `${parsed}^{commit}`,
    ]);
    if (verified.stdout.trim() !== parsed) throw new Error('Malformed git commit metadata');
  } catch (error) {
    if (hasExitCode(error, 1)) throw new GitCommitRefError();
    throw error;
  }
  try {
    await execFileAsync('git', [
      '-C',
      workingPath,
      '--no-optional-locks',
      'merge-base',
      '--is-ancestor',
      parsed,
      'HEAD',
    ]);
  } catch (error) {
    if (hasExitCode(error, 1)) throw new GitCommitRefError();
    throw error;
  }

  const result = await execFileAsync('git', [
    '-C',
    workingPath,
    '--no-optional-locks',
    'rev-list',
    '--parents',
    '-n',
    '1',
    parsed,
  ]);
  const stdout = result.stdout.trim();
  const parts = stdout.split(' ').filter(Boolean);
  if (parts[0] !== parsed) throw new Error('Malformed git commit metadata');
  const parents = parts.slice(1);
  if (
    parents.some(parent => !FULL_GIT_OBJECT_ID_RE.test(parent) || parent.length !== parsed.length)
  ) {
    throw new Error('Malformed git commit metadata');
  }
  return parents;
}
