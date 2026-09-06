import type { Context } from 'hono';

import { changedFiles, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitChangesResponse } from '../schemas/git.schemas';
import { isValidGitObjectId } from './path-input';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

export async function handleGitChanges(
  c: Context,
  apiError: (c: Context, status: 400 | 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.changes_started');

  const ref = c.req.query('ref');
  if (ref !== undefined && !isValidGitObjectId(ref)) {
    getLog().info({ runId, errorType: 'invalid_ref' }, 'git.changes_failed');
    return apiError(c, 400, 'Invalid commit ref');
  }

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.changes_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      const body: GitChangesResponse = {
        emptyReason: gate.emptyReason,
        files: [],
        revision: '',
      };
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.changes_completed');
      return c.json(body);
    }

    try {
      const result =
        ref === undefined
          ? await changedFiles(toWorktreePath(gate.workingPath))
          : await changedFiles(toWorktreePath(gate.workingPath), { commit: ref });
      const body: GitChangesResponse = {
        files: result.files,
        revision: result.revision,
      };
      getLog().info({ runId, fileCount: result.files.length }, 'git.changes_completed');
      return c.json(body);
    } catch (error) {
      const recheck = await loadRunCheckout(runId);
      if (recheck.kind === 'empty') {
        const body: GitChangesResponse = {
          emptyReason: recheck.emptyReason,
          files: [],
          revision: '',
        };
        getLog().info({ runId, emptyReason: recheck.emptyReason }, 'git.changes_completed');
        return c.json(body);
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: unknown }).name === 'GitCommitRefError'
      ) {
        getLog().info({ runId, errorType: 'invalid_ref' }, 'git.changes_failed');
        return apiError(c, 400, 'Invalid commit ref');
      }
      getLog().error(
        { runId, errorType: error instanceof Error ? error.name : typeof error },
        'git.changes_failed'
      );
      return apiError(c, 500, 'Could not read git changes');
    }
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.changes_failed'
    );
    return apiError(c, 500, 'Could not read git changes');
  }
}
