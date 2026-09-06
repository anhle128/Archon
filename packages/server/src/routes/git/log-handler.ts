import type { Context } from 'hono';

import { log, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitLogResponse } from '../schemas/git.schemas';
import { loadRunCheckout } from './run-checkout';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

function emptyLogResponse(emptyReason: 'container' | 'no_checkout'): GitLogResponse {
  return { emptyReason, commits: [], revision: '', truncated: false };
}

export async function handleGitLog(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.log_started');

  try {
    const gate = await loadRunCheckout(runId);

    if (gate.kind === 'run_not_found') {
      getLog().info({ runId }, 'git.log_failed');
      return apiError(c, 404, 'Workflow run not found');
    }

    if (gate.kind === 'empty') {
      getLog().info({ runId, emptyReason: gate.emptyReason }, 'git.log_completed');
      return c.json(emptyLogResponse(gate.emptyReason));
    }

    try {
      const result = await log(toWorktreePath(gate.workingPath));
      const body: GitLogResponse = {
        commits: result.commits,
        revision: result.revision,
        truncated: result.truncated,
      };
      getLog().info({ runId, commitCount: result.commits.length }, 'git.log_completed');
      return c.json(body);
    } catch (error) {
      const recheck = await loadRunCheckout(runId);
      if (recheck.kind === 'empty') {
        getLog().info({ runId, emptyReason: recheck.emptyReason }, 'git.log_completed');
        return c.json(emptyLogResponse(recheck.emptyReason));
      }
      getLog().error(
        { runId, errorType: error instanceof Error ? error.name : typeof error },
        'git.log_failed'
      );
      return apiError(c, 500, 'Could not read git history');
    }
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.log_failed'
    );
    return apiError(c, 500, 'Could not read git history');
  }
}
