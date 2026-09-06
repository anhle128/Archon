/**
 * Workflow-owned AskHuman native tool.
 *
 * Validates structured questions, persists a pending interaction, idempotently
 * pauses the run, then throws AskHumanAwaitingError so the DAG executor can
 * unwind the node without completing it.
 */
import { createLogger } from '@archon/paths';
import {
  AskHumanAwaitingError,
  type NativeTool,
  type NativeToolHandlerContext,
} from '@archon/providers/types';
import { z } from '@hono/zod-openapi';
import { askHumanQuestionSchema } from './schemas/pending-interaction';
import type { IWorkflowStore } from './store';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflows.ask-human');
  return cachedLog;
}

export const ASK_HUMAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Ordered structured questions for the run starter.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};

const askHumanHandlerInputSchema = z.object({
  questions: z.array(askHumanQuestionSchema).min(1),
});

type AskHumanHandlerInput = z.infer<typeof askHumanHandlerInputSchema>;

const ASK_HUMAN_DESCRIPTION =
  'Ask the run starter one or more structured questions. Call this tool instead of asking in prose. Wait after calling; do not guess the answer.';

export interface CreateAskHumanToolInput {
  store: IWorkflowStore;
  workflowRunId: string;
  nodeId: string;
}

export function createAskHumanTool(input: CreateAskHumanToolInput): NativeTool {
  const { store, workflowRunId, nodeId } = input;

  return {
    name: 'AskHuman',
    description: ASK_HUMAN_DESCRIPTION,
    inputSchema: ASK_HUMAN_INPUT_SCHEMA,
    handler: async (
      rawInput: Record<string, unknown>,
      context?: NativeToolHandlerContext
    ): Promise<string> => {
      const parsed = askHumanHandlerInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new Error(`AskHuman input invalid: ${parsed.error.message}`);
      }
      const { questions } = parsed.data satisfies AskHumanHandlerInput;

      const toolUseId = context?.toolUseId;
      const sessionId = context?.sessionId;
      if (!toolUseId) {
        throw new Error('AskHuman requires a real tool-use id');
      }
      if (!sessionId) {
        throw new Error('AskHuman requires a provider session id');
      }

      await store.insertPendingInteraction({
        workflow_run_id: workflowRunId,
        node_id: nodeId,
        tool_use_id: toolUseId,
        kind: 'ask',
        envelope: { questions },
        provider_session_id: sessionId,
      });

      getLog().info({ workflowRunId, nodeId, toolUseId, kind: 'ask' }, 'workflow.ask_pending');

      await store.pauseWorkflowRun(workflowRunId);

      throw new AskHumanAwaitingError(toolUseId, nodeId, workflowRunId);
    },
  };
}
