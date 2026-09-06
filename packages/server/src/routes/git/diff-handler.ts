import type { Context } from 'hono';

import { fileDiff, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import { isValidGitFilePath, isValidGitObjectId } from './path-input';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

type ClassifiedGitReadError =
  | 'invalid_path'
  | 'invalid_ref'
  | 'file_not_found'
  | 'invalid_cursor'
  | 'stale_cursor'
  | 'git_read_failed';

function classifyGitReadError(error: unknown): ClassifiedGitReadError {
  if (typeof error !== 'object' || error === null) return 'git_read_failed';
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === 'GitPathError') return 'invalid_path';
  if (candidate.name === 'GitCommitRefError') return 'invalid_ref';
  if (candidate.name === 'GitFileError' && candidate.code === 'invalid_ref') {
    return 'invalid_ref';
  }
  if (candidate.name === 'GitFileError' && candidate.code === 'not_found') {
    return 'file_not_found';
  }
  if (candidate.name === 'GitFileError' && candidate.code === 'invalid_cursor') {
    return 'invalid_cursor';
  }
  if (candidate.name === 'GitFileError' && candidate.code === 'stale_cursor') {
    return 'stale_cursor';
  }
  return 'git_read_failed';
}

export async function handleGitDiff(
  c: Context,
  apiError: (c: Context, status: 400 | 404 | 409 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  const path = c.req.query('path') ?? '';
  getLog().info({ runId }, 'git.diff_started');

  if (!isValidGitFilePath(path)) {
    getLog().info({ runId, errorType: 'invalid_path' }, 'git.diff_failed');
    return apiError(c, 400, 'Invalid file path');
  }

  const ref = c.req.query('ref');
  if (ref !== undefined && !isValidGitObjectId(ref)) {
    getLog().info({ runId, errorType: 'invalid_ref' }, 'git.diff_failed');
    return apiError(c, 400, 'Invalid commit ref');
  }

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId, errorType: 'run_not_found' }, 'git.diff_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.diff_completed');
      return c.json({ emptyReason: gate.emptyReason });
    }

    try {
      const result = await fileDiff(toWorktreePath(gate.workingPath), path, {
        cursor: c.req.query('cursor') ?? '',
        signal: c.req.raw.signal,
        commit: ref,
      });
      getLog().info(
        { runId, binary: result.binary, truncated: result.truncated },
        'git.diff_completed'
      );
      return c.json(result);
    } catch (error) {
      const recheck = await loadRunCheckout(runId);
      if (recheck.kind === 'empty') {
        getLog().info({ runId, emptyReason: recheck.emptyReason }, 'git.diff_completed');
        return c.json({ emptyReason: recheck.emptyReason });
      }
      const classified = classifyGitReadError(error);
      if (classified === 'invalid_path') {
        getLog().info({ runId, errorType: 'invalid_path' }, 'git.diff_failed');
        return apiError(c, 400, 'Invalid file path');
      }
      if (classified === 'invalid_ref') {
        getLog().info({ runId, errorType: 'invalid_ref' }, 'git.diff_failed');
        return apiError(c, 400, 'Invalid commit ref');
      }
      if (classified === 'file_not_found') {
        getLog().info({ runId, errorType: 'file_not_found' }, 'git.diff_failed');
        return apiError(c, 404, 'File not found');
      }
      if (classified === 'invalid_cursor') {
        getLog().info({ runId, errorType: 'invalid_cursor' }, 'git.diff_failed');
        return apiError(c, 400, 'Invalid file cursor');
      }
      if (classified === 'stale_cursor') {
        getLog().info({ runId, errorType: 'stale_cursor' }, 'git.diff_failed');
        return apiError(c, 409, 'File changed');
      }
      getLog().error({ runId, errorType: 'git_read_failed' }, 'git.diff_failed');
      return apiError(c, 500, 'Could not read git diff');
    }
  } catch {
    getLog().error({ runId, errorType: 'git_read_failed' }, 'git.diff_failed');
    return apiError(c, 500, 'Could not read git diff');
  }
}
