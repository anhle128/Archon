/**
 * Executor entry for plannotator_gate nodes.
 *
 * Resolves the document path from YAML/substitution, validates the file and
 * Plannotator binary, then hands off to the supervisor loop (pause + annotate
 * spawn + rework + approve/resume).
 */
import { existsSync } from 'fs';
import { isAbsolute, resolve as resolvePath } from 'path';
import { createLogger } from '@archon/paths';
import type { WorkflowDeps, WorkflowConfig, IWorkflowPlatform } from './deps';
import type { PlannotatorGateNode, WorkflowRun, NodeOutput } from './schemas';
import type { ModelAliasPreset, ResolvedAiProfile } from './model-validation';
import { substituteNodeOutputRefs } from './dag-executor';
import { parseDocumentPathFromNodeOutput, resolvePlannotatorBinary } from './plannotator-gate';
import { runPlannotatorGateSupervisor } from './plannotator-gate-supervisor';
import { isRegisteredProvider } from '@archon/providers';
import type { SendQueryOptions } from '@archon/providers/types';
import { safeSendMessage } from './executor-shared';

const log = createLogger('workflow.plannotator-gate-executor');

export interface ExecutePlannotatorGateArgs {
  node: PlannotatorGateNode;
  workflowRun: WorkflowRun;
  deps: WorkflowDeps;
  platform: IWorkflowPlatform;
  conversationId: string;
  cwd: string;
  artifactsDir: string;
  nodeOutputs: Map<string, NodeOutput>;
  config: WorkflowConfig;
  workflowProvider: string;
  workflowModel: string | undefined;
  aiProfile?: ResolvedAiProfile;
  workflowPreset?: ModelAliasPreset;
  workflowTier?: string;
}

/**
 * Resolve document field → absolute path on disk (contract B after substitution).
 */
export function resolveGateDocumentPath(
  documentField: string,
  nodeOutputs: Map<string, NodeOutput>,
  cwd: string
): string {
  const substituted = substituteNodeOutputRefs(documentField, nodeOutputs);
  const rawPath = parseDocumentPathFromNodeOutput(substituted);
  const absolute = isAbsolute(rawPath) ? rawPath : resolvePath(cwd, rawPath);
  if (!existsSync(absolute)) {
    throw new Error(
      `plannotator_gate document not found: ${absolute} (resolved from '${rawPath}')`
    );
  }
  return absolute;
}

/**
 * Preflight: binary must be on PATH (or PLANNOTATOR_BIN).
 */
export function preflightPlannotatorBinary(): string {
  const bin = resolvePlannotatorBinary();
  const which = Bun.which(bin);
  if (!which && !existsSync(bin)) {
    throw new Error(
      `plannotator binary not found ('${bin}'). Install Plannotator and ensure it is on PATH, ` +
        'or set PLANNOTATOR_BIN. --persist-session requires a recent Plannotator build.'
    );
  }
  return which ?? bin;
}

function buildReworkPrompt(template: string, documentPath: string, annotations: string): string {
  return template
    .split('$REVIEW_DOCUMENT')
    .join(documentPath)
    .split('$REVIEW_ANNOTATIONS')
    .join(annotations);
}

/**
 * One-shot AI rework: send prompt, collect assistant text, parse path.
 */
async function runReworkViaProvider(
  args: ExecutePlannotatorGateArgs,
  prompt: string
): Promise<string> {
  const { node, deps, cwd, config, workflowProvider, workflowModel } = args;
  const rework = node.plannotator_gate.rework;
  const providerId = rework.provider ?? workflowProvider;
  if (!isRegisteredProvider(providerId)) {
    throw new Error(`plannotator_gate rework: unknown provider '${providerId}'`);
  }

  const assistantModel = config.assistants?.[providerId]?.model;
  const model: string | undefined =
    rework.model ??
    workflowModel ??
    (typeof assistantModel === 'string' ? assistantModel : undefined);

  const aiClient = deps.getAgentProvider(providerId);

  let finalText = '';
  const options: SendQueryOptions = {
    ...(model !== undefined ? { model } : {}),
    nodeConfig: {
      nodeId: `${node.id}:rework`,
      ...(rework.effort ? { effort: rework.effort } : {}),
    },
  };

  for await (const msg of aiClient.sendQuery(prompt, cwd, undefined, options)) {
    if (msg.type === 'assistant' && msg.content) {
      finalText += msg.content;
    }
  }

  if (!finalText.trim()) {
    throw new Error(
      `plannotator_gate rework produced no assistant output (provider '${providerId}')`
    );
  }

  return parseDocumentPathFromNodeOutput(finalText);
}

/**
 * Execute a plannotator_gate node to completion (approved) or fail.
 */
export async function executePlannotatorGateNode(
  args: ExecutePlannotatorGateArgs
): Promise<NodeOutput> {
  const { node, workflowRun, deps, platform, conversationId, cwd, nodeOutputs } = args;
  const gate = node.plannotator_gate;
  const msgContext = { workflowId: workflowRun.id, nodeName: node.id };

  let documentPath: string;
  try {
    documentPath = resolveGateDocumentPath(gate.document, nodeOutputs, cwd);
    preflightPlannotatorBinary();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { workflowRunId: workflowRun.id, nodeId: node.id, error: message },
      'plannotator_gate.preflight_failed'
    );
    await safeSendMessage(
      platform,
      conversationId,
      `❌ **plannotator_gate \`${node.id}\` failed**: ${message}`,
      msgContext
    );
    return { state: 'failed', output: '', error: message };
  }

  const message =
    gate.message !== undefined && gate.message.trim().length > 0
      ? substituteNodeOutputRefs(gate.message, nodeOutputs)
      : `Review \`${documentPath}\` in Plannotator, then Approve or Send Annotations.`;

  await safeSendMessage(
    platform,
    conversationId,
    `⏸ **Plannotator review** (\`${node.id}\`)\n\n${message}\n\n` +
      `Document: \`${documentPath}\`\n` +
      `Run ID: \`${workflowRun.id}\`\n` +
      `Approve: \`/workflow approve ${workflowRun.id}\` | Reject: \`/workflow reject ${workflowRun.id}\``,
    msgContext
  );

  try {
    const result = await runPlannotatorGateSupervisor({
      runId: workflowRun.id,
      nodeId: node.id,
      cwd,
      initialDocumentPath: documentPath,
      captureResponse: gate.capture_response === true,
      reworkPromptTemplate: gate.rework.prompt,
      message,
      store: deps.store,
      runReworkAgent: async ({ prompt, documentPath: doc, annotations }) => {
        const filled = buildReworkPrompt(prompt, doc, annotations);
        const nextPath = await runReworkViaProvider(args, filled);
        const absolute = isAbsolute(nextPath) ? nextPath : resolvePath(cwd, nextPath);
        if (!existsSync(absolute)) {
          throw new Error(`plannotator_gate rework returned missing file: ${absolute}`);
        }
        return absolute;
      },
    });

    return { state: 'completed', output: result.output };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    log.error(
      { workflowRunId: workflowRun.id, nodeId: node.id, error: messageText },
      'plannotator_gate.supervisor_failed'
    );
    await safeSendMessage(
      platform,
      conversationId,
      `❌ **plannotator_gate \`${node.id}\`**: ${messageText}`,
      msgContext
    );
    return { state: 'failed', output: '', error: messageText };
  }
}
