/**
 * Executor entry for plannotator_gate nodes.
 *
 * Resolves the document path from YAML/substitution, validates the file and
 * Plannotator binary, then hands off to the supervisor loop (pause + annotate
 * spawn + rework + approve/resume).
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { createLogger } from '@archon/paths';
import type { WorkflowDeps, WorkflowConfig, IWorkflowPlatform } from './deps';
import type { PlannotatorGateNode, WorkflowRun, NodeOutput } from './schemas';
import type { ApprovalContext } from './schemas/workflow-run';
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
  cwd: string,
  artifactsDir: string
): string {
  const substituted = substituteNodeOutputRefs(documentField, nodeOutputs);
  const rawPath = parseDocumentPathFromNodeOutput(substituted);
  return validateGateDocumentPath(rawPath, cwd, artifactsDir);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

export function validateGateDocumentPath(
  rawPath: string,
  cwd: string,
  artifactsDir: string
): string {
  const unresolved = isAbsolute(rawPath) ? rawPath : resolvePath(cwd, rawPath);
  let candidate: string;
  try {
    candidate = realpathSync(unresolved);
  } catch {
    throw new Error(
      `plannotator_gate document not found: ${unresolved} (resolved from '${rawPath}')`
    );
  }

  const cwdRoot = realpathSync(cwd);
  const artifactsRoot = realpathSync(artifactsDir);
  if (!isInsideRoot(cwdRoot, candidate) && !isInsideRoot(artifactsRoot, candidate)) {
    throw new Error(`plannotator_gate document is outside cwd and artifactsDir: ${candidate}`);
  }
  if (!statSync(candidate).isFile()) {
    throw new Error(`plannotator_gate document must be a file: ${candidate}`);
  }
  const extension = extname(candidate).toLowerCase();
  if (extension !== '.html' && extension !== '.htm') {
    throw new Error(`plannotator_gate document must be an HTML file: ${candidate}`);
  }
  try {
    accessSync(candidate, constants.R_OK);
  } catch {
    throw new Error(`plannotator_gate document must be readable: ${candidate}`);
  }
  return candidate;
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

export function buildReworkPrompt(
  template: string,
  documentPath: string,
  annotations: string
): string {
  return template.replace(/\$REVIEW_DOCUMENT|\$REVIEW_ANNOTATIONS/g, placeholder =>
    placeholder === '$REVIEW_DOCUMENT' ? documentPath : annotations
  );
}

export function resolvePlannotatorGateId(workflowRun: WorkflowRun, nodeId: string): string {
  const raw = workflowRun.metadata.approval;
  const approval = typeof raw === 'object' && raw !== null ? (raw as ApprovalContext) : undefined;
  return approval?.type === 'plannotator_gate' &&
    approval.nodeId === nodeId &&
    approval.resolved == null &&
    approval.phase === 'opening' &&
    typeof approval.gateId === 'string'
    ? approval.gateId
    : crypto.randomUUID();
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
  const { node, workflowRun, deps, platform, conversationId, cwd, artifactsDir, nodeOutputs } =
    args;
  const gate = node.plannotator_gate;
  const msgContext = { workflowId: workflowRun.id, nodeName: node.id };

  let documentPath: string;
  try {
    documentPath = resolveGateDocumentPath(gate.document, nodeOutputs, cwd, artifactsDir);
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
  const gateId = resolvePlannotatorGateId(workflowRun, node.id);

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
      gateId,
      cwd,
      initialDocumentPath: documentPath,
      captureResponse: gate.capture_response === true,
      message,
      store: deps.store,
      runReworkAgent: async ({ documentPath: doc, annotations }) => {
        const filled = buildReworkPrompt(gate.rework.prompt, doc, annotations);
        const nextPath = await runReworkViaProvider(args, filled);
        return validateGateDocumentPath(nextPath, cwd, artifactsDir);
      },
    });

    if (result.kind === 'superseded') {
      return { state: 'pending', output: '' };
    }
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
