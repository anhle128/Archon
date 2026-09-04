import { createLogger } from '@archon/paths';
import { execFileAsync } from './exec';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('git');
  return cachedLog;
}

/** One changed path from `git status --porcelain`, collapsed to the states callers need. */
export interface GitStatusEntry {
  path: string;
  status: 'M' | 'A' | 'D';
}

/** Result of reading working-tree status for a directory. */
export type GitStatusListResult =
  | { readable: true; entries: GitStatusEntry[] }
  | { readable: false };

/**
 * Run `git status --porcelain` against `dirPath` and parse the output into a
 * typed list of changed paths.
 *
 * Renamed/copied/type-changed entries collapse to 'M' (the path is still
 * tracked, just changed); untracked entries ('??') collapse to 'A' (new to
 * git). When a path carries a real code in both the index and worktree
 * columns (e.g. staged-add, then deleted on disk), 'D' wins since it reflects
 * the file's actual state on disk.
 *
 * Returns `{ readable: false }` — never throws — when `dirPath` does not
 * exist or is not a git checkout; callers that just need "can I read status
 * here" don't have to distinguish the two. Any other failure (permission
 * denied, git missing, timeout) still throws.
 */
export async function getGitStatus(dirPath: string): Promise<GitStatusListResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('git', ['-C', dirPath, 'status', '--porcelain'], {
      timeout: 10000,
    }));
  } catch (error) {
    const err = error as Error & { stderr?: string };
    const errorText = `${err.message} ${err.stderr ?? ''}`;

    // Expected: dirPath doesn't exist, or exists but isn't a git checkout.
    if (
      errorText.includes('not a git repository') ||
      errorText.includes('Not a git repository') ||
      errorText.includes('No such file or directory') ||
      errorText.includes('cannot change to')
    ) {
      return { readable: false };
    }

    getLog().error({ dirPath, err, stderr: err.stderr }, 'git.status_read_failed');
    throw new Error(`Failed to read git status for ${dirPath}: ${err.message}`);
  }

  return { readable: true, entries: parsePorcelainStatus(stdout) };
}

function parsePorcelainStatus(stdout: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    // A porcelain v1 line is "XY PATH" (or "XY ORIG -> PATH" for renames) —
    // shortest possible is 4 chars ("XY " + a 1-char path).
    if (line.length < 4) continue;

    const indexCode = line[0];
    const worktreeCode = line[1];
    const rawPath = line.slice(3);
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath;
    const status = classifyStatus(indexCode, worktreeCode);
    if (status) entries.push({ path, status });
  }
  return entries;
}

/** Collapse a porcelain XY code pair down to M/A/D, or null to skip the line. */
function classifyStatus(indexCode: string, worktreeCode: string): 'M' | 'A' | 'D' | null {
  if (indexCode === '?' && worktreeCode === '?') return 'A'; // untracked
  if (indexCode === 'D' || worktreeCode === 'D') return 'D';
  if (indexCode === 'A') return 'A';
  if (['M', 'R', 'C', 'T'].includes(indexCode) || ['M', 'T'].includes(worktreeCode)) return 'M';
  return null;
}
