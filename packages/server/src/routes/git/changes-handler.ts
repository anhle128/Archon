import { realpath, stat } from 'fs/promises';
import type { Context } from 'hono';

import * as conversationDb from '@archon/core/db/conversations';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import { changedFiles, isGitWorkTree, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { GitChangesResponse } from '../schemas/git.schemas';
import { resolveRunCheckout } from './checkout-gate';

let cachedLog: ReturnType<typeof createLogger> | undefined;

function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('api');
  return cachedLog;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function handleGitChanges(
  c: Context,
  apiError: (c: Context, status: 404 | 500, message: string) => Response
): Promise<Response> {
  const runId = c.req.param('runId') ?? '';
  getLog().info({ runId }, 'git.changes_started');

  try {
    const run = await workflowDb.getWorkflowRun(runId);
    const gate = await resolveRunCheckout({
      run: run ? { conversation_id: run.conversation_id, working_path: run.working_path } : null,
      getConversationById: async id => {
        const conversation = await conversationDb.getConversationById(id);
        return conversation ? { isolation_env_id: conversation.isolation_env_id } : null;
      },
      getIsolationEnvById: async id => {
        const environment = await isolationEnvDb.getById(id);
        return environment ? { provider: environment.provider } : null;
      },
      pathExists,
      realpathFn: realpath,
      isGitWorkTree: path => isGitWorkTree(toWorktreePath(path)),
    });

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

    const result = await changedFiles(toWorktreePath(gate.workingPath));
    const body: GitChangesResponse = {
      files: result.files,
      revision: result.revision,
    };
    getLog().info({ runId, fileCount: result.files.length }, 'git.changes_completed');
    return c.json(body);
  } catch (error) {
    getLog().error(
      { runId, errorType: error instanceof Error ? error.name : typeof error },
      'git.changes_failed'
    );
    return apiError(c, 500, 'Could not read git changes');
  }
}
