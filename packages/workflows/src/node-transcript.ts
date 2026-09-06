/**
 * Awaited fail-open transcript writer.
 *
 * The executor must await appends to preserve provider-chunk order, but a
 * persistence failure must not fail the node. This is the sole fail-open
 * boundary: log only identity and error type, never payload bodies.
 */
import { createLogger } from '@archon/paths';
import type { AppendNodeMessageInput } from './schemas/node-message';
import type { IWorkflowNodeMessageStore } from './store';

const log = createLogger('workflows.node-transcript');

export async function appendNodeTranscript(
  store: IWorkflowNodeMessageStore,
  input: AppendNodeMessageInput
): Promise<void> {
  try {
    await store.appendNodeMessage(input);
  } catch (error: unknown) {
    log.error(
      {
        workflowRunId: input.workflow_run_id,
        nodeId: input.node_id,
        kind: input.kind,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'workflow.node_message_append_failed'
    );
  }
}
