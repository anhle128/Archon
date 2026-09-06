/**
 * CAP-8 v1 git-snapshot writer.
 *
 * v1 writes nothing. The function exists so run-end has one injection point.
 * A later writer MUST:
 * - no-op when `workingPath` is null or the checkout is already gone
 * - no-op when `outputRoot` is null
 * - write only under `outputRoot` via a temp file plus atomic rename
 * - keep the write idempotent across resume and retry-node
 * - let write errors reach the executor's fail-open logging boundary
 * - never log paths, remotes, file contents, or secrets
 * - not invent a second WorkflowDeps hook
 *
 * The snapshot filename and wire format are intentionally deferred.
 */
import { existsSync } from 'node:fs';
import { createLogger } from '@archon/paths';
import type { GitSnapshotContext } from '@archon/workflows/deps';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.git-snapshot');
  return cachedLog;
}

export async function captureRunEndGitSnapshot(context: GitSnapshotContext): Promise<void> {
  if (!context.workingPath) {
    getLog().info(
      { workflowRunId: context.runId, reason: 'missing_working_path' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  if (!existsSync(context.workingPath)) {
    getLog().info(
      { workflowRunId: context.runId, reason: 'checkout_gone' },
      'git_snapshot.capture_skipped'
    );
    return;
  }
  getLog().info(
    { workflowRunId: context.runId, status: context.status, reason: 'v1_noop' },
    'git_snapshot.capture_skipped'
  );
}
