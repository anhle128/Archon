import { realpath, stat } from 'fs/promises';

import * as conversationDb from '@archon/core/db/conversations';
import * as isolationEnvDb from '@archon/core/db/isolation-environments';
import * as workflowDb from '@archon/core/db/workflows';
import { isGitWorkTree, toWorktreePath } from '@archon/git';

import { resolveRunCheckout, type CheckoutGateResult } from './checkout-gate';

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function loadRunCheckout(runId: string): Promise<CheckoutGateResult> {
  const run = await workflowDb.getWorkflowRun(runId);
  return resolveRunCheckout({
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
}
