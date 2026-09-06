import { realpath } from 'fs/promises';
import { isAbsolute, join, relative, sep } from 'path';

export type GitPathErrorCode = 'empty' | 'nul' | 'absolute' | 'dotdot' | 'escape';

export class GitPathError extends Error {
  readonly code: GitPathErrorCode;

  constructor(code: GitPathErrorCode) {
    super('Invalid git file path');
    this.name = 'GitPathError';
    this.code = code;
  }
}

export function parseGitFilePath(raw: string): string {
  if (raw.length === 0) throw new GitPathError('empty');
  if (raw.includes('\0')) throw new GitPathError('nul');
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new GitPathError('absolute');
  }
  if (raw.split(/[\\/]/).some((segment: string) => segment === '..')) {
    throw new GitPathError('dotdot');
  }
  if (raw.split(/[\\/]/)[0]?.toLowerCase() === '.git') {
    throw new GitPathError('escape');
  }
  return raw;
}

export async function containLivePath(checkoutRoot: string, relativePath: string): Promise<string> {
  const parsed = parseGitFilePath(relativePath);
  const canonicalRoot = await realpath(checkoutRoot);
  const canonicalCandidate = await realpath(join(canonicalRoot, parsed));
  const fromRoot = relative(canonicalRoot, canonicalCandidate);
  if (fromRoot === '..' || fromRoot.startsWith('..' + sep) || isAbsolute(fromRoot)) {
    throw new GitPathError('escape');
  }
  return canonicalCandidate;
}

export async function containLiveGitFilePath(
  checkoutRoot: string,
  relativePath: string
): Promise<string> {
  const canonicalRoot = await realpath(checkoutRoot);
  const canonicalCandidate = await containLivePath(canonicalRoot, relativePath);
  const fromRoot = relative(canonicalRoot, canonicalCandidate);
  if (fromRoot.split(sep)[0]?.toLowerCase() === '.git') {
    throw new GitPathError('escape');
  }
  return canonicalCandidate;
}
