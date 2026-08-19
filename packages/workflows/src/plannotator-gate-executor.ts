/**
 * Executor entry for plannotator_gate nodes.
 *
 * Resolves the document path from YAML/substitution, validates the file and
 * Plannotator binary protocol, then hands off to the supervisor loop (pause + annotate
 * spawn + rework + approve/resume).
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { createLogger } from '@archon/paths';
import type { WorkflowDeps, WorkflowConfig, IWorkflowPlatform } from './deps';
import type { PlannotatorGateNode, WorkflowRun, NodeOutput, PromptNode } from './schemas';
import type { ApprovalContext } from './schemas/workflow-run';
import type { ModelAliasPreset, ResolvedAiProfile } from './model-validation';
import {
  CANCEL_CHECK_INTERVAL_MS,
  resolveNodeProviderAndModel,
  shouldContinueStreamingForStatus,
  substituteNodeOutputRefs,
  type WorkflowLevelOptions,
} from './dag-executor';
import {
  buildPlannotatorSpawnArgv,
  parseDocumentPathFromNodeOutput,
  resolvePlannotatorBinary,
} from './plannotator-gate';
import { runPlannotatorGateSupervisor } from './plannotator-gate-supervisor';
import type { ExecutionContext, SendQueryOptions } from '@archon/providers/types';
import { safeSendMessage, substituteWorkflowVariables } from './executor-shared';
import { STEP_IDLE_TIMEOUT_MS, withIdleTimeout } from './utils/idle-timeout';
import { getWorkflowEventEmitter } from './event-emitter';

const log = createLogger('workflow.plannotator-gate-executor');

export interface ExecutePlannotatorGateArgs {
  node: PlannotatorGateNode;
  stepName: string;
  retryEpoch: number;
  iteration?: number;
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
  workflowLevelOptions: WorkflowLevelOptions;
  warnedProviderConflicts: Set<string>;
  stateDir: string;
  baseBranch: string;
  docsDir: string;
  prRemote: string;
  issueContext?: string;
  execContext: ExecutionContext;
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
  if (extension !== '.html' && extension !== '.htm' && extension !== '.md') {
    throw new Error(`plannotator_gate document must be an HTML or Markdown file: ${candidate}`);
  }
  try {
    accessSync(candidate, constants.R_OK);
  } catch {
    throw new Error(`plannotator_gate document must be readable: ${candidate}`);
  }
  return candidate;
}

/**
 * Preflight: binary must be resolvable and support the gate process protocol.
 */
export async function preflightPlannotatorBinary(): Promise<string> {
  const bin = resolvePlannotatorBinary();
  const which = Bun.which(bin);
  if (!which && !existsSync(bin)) {
    throw new Error(
      `plannotator binary not found ('${bin}'). Install Plannotator and ensure it is on PATH, ` +
        'or set PLANNOTATOR_BIN.'
    );
  }
  const resolved = which ?? bin;
  const proc = Bun.spawn(buildPlannotatorSpawnArgv(resolved, ['annotate', '--help']), {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve('');
  const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve('');
  const exitCode = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  const stderrDiagnostic = stderr.trim().slice(0, 4096);
  if (exitCode !== 0) {
    throw new Error(
      `plannotator capability check exited with code ${exitCode}${stderrDiagnostic ? `: ${stderrDiagnostic}` : ''}`
    );
  }

  const help = `${stdout}\n${stderr}`;
  const missing = ['--persist-session', '--result-file'].filter(flag => !help.includes(flag));
  if (missing.length > 0) {
    throw new Error(
      `plannotator binary does not support required annotate option${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`
    );
  }
  return resolved;
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

interface EmbeddedGateConfig {
  provider?: string;
  model?: string;
  effort?: string;
  allowed_tools?: string[];
  denied_tools?: string[];
}

interface EmbeddedTerminalWatcher {
  readonly ready: Promise<void>;
  readonly terminalStatus: string | undefined;
  stop: () => void;
}

/**
 * Watch the run independently of provider output: an embedded gate call can be
 * blocked in its async stream long enough to miss the normal per-message check.
 */
function watchEmbeddedGateTerminalStatus(
  args: ExecutePlannotatorGateArgs,
  phase: 'prepare' | 'rework',
  abortController: AbortController
): EmbeddedTerminalWatcher {
  let stopped = false;
  let checking = false;
  let terminalStatus: string | undefined;

  const checkStatus = async (): Promise<void> => {
    if (stopped || checking || terminalStatus !== undefined) return;
    checking = true;
    try {
      const status = await args.deps.store.getWorkflowRunStatus(args.workflowRun.id);
      if (!stopped && !shouldContinueStreamingForStatus(status)) {
        terminalStatus = status ?? 'deleted';
        log.info(
          {
            workflowRunId: args.workflowRun.id,
            nodeId: args.node.id,
            phase,
            status: terminalStatus,
          },
          'plannotator_gate.stop_detected_during_embedded_stream'
        );
        abortController.abort();
      }
    } catch (error) {
      log.warn(
        { workflowRunId: args.workflowRun.id, nodeId: args.node.id, phase, error },
        'plannotator_gate.status_check_failed'
      );
    } finally {
      checking = false;
    }
  };

  const ready = checkStatus();
  const interval = setInterval(() => {
    void checkStatus();
  }, CANCEL_CHECK_INTERVAL_MS);

  return {
    ready,
    get terminalStatus(): string | undefined {
      return terminalStatus;
    },
    stop: (): void => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

function terminalEmbeddedGateError(phase: 'prepare' | 'rework', status: string): Error {
  return new Error(`plannotator_gate ${phase} stopped because workflow is ${status}`);
}

/** One-shot gate AI call: collect exactly one document path from assistant output. */
async function runEmbeddedGateAiCall(
  args: ExecutePlannotatorGateArgs,
  phase: 'prepare' | 'rework',
  phaseConfig: EmbeddedGateConfig,
  prompt: string
): Promise<string> {
  const { node, deps, cwd, config, workflowProvider, workflowModel, execContext } = args;
  const phaseNode: PromptNode = {
    id: `${node.id}:${phase}`,
    prompt,
    ...(phaseConfig.provider !== undefined ? { provider: phaseConfig.provider } : {}),
    ...(phaseConfig.model !== undefined ? { model: phaseConfig.model } : {}),
    ...(phaseConfig.effort !== undefined ? { effort: phaseConfig.effort } : {}),
    ...(phaseConfig.allowed_tools !== undefined
      ? { allowed_tools: phaseConfig.allowed_tools }
      : {}),
    ...(phaseConfig.denied_tools !== undefined ? { denied_tools: phaseConfig.denied_tools } : {}),
  };
  const { provider: providerId, options: resolvedOptions } = await resolveNodeProviderAndModel(
    phaseNode,
    workflowProvider,
    workflowModel,
    config,
    args.platform,
    args.conversationId,
    args.workflowRun.id,
    cwd,
    args.workflowLevelOptions,
    args.aiProfile,
    args.workflowPreset,
    text => text,
    args.warnedProviderConflicts,
    execContext
  );
  const abortController = new AbortController();
  let idleTimedOut = false;
  const options: SendQueryOptions = {
    ...resolvedOptions,
    abortSignal: abortController.signal,
    traceContext: {
      name: `execute-workflow-plannotator-${phase}`,
      sessionId: args.workflowRun.id,
      userId: args.workflowRun.user_id ?? undefined,
      tags: ['feature:workflow', `platform:${args.platform.getPlatformType()}`],
      metadata: {
        workflowName: args.workflowRun.workflow_name,
        nodeId: `${node.id}:${phase}`,
        platform: args.platform.getPlatformType(),
      },
    },
  };
  let finalText = '';
  const terminalWatcher = watchEmbeddedGateTerminalStatus(args, phase, abortController);
  try {
    await terminalWatcher.ready;
    if (terminalWatcher.terminalStatus !== undefined) {
      throw terminalEmbeddedGateError(phase, terminalWatcher.terminalStatus);
    }
    const aiClient = deps.getAgentProvider(providerId);
    for await (const msg of withIdleTimeout(
      aiClient.sendQuery(prompt, cwd, undefined, options),
      node.idle_timeout ?? STEP_IDLE_TIMEOUT_MS,
      () => {
        idleTimedOut = true;
        abortController.abort();
      }
    )) {
      if (msg.type === 'assistant' && msg.content) {
        finalText += msg.content;
      } else if (msg.type === 'tool') {
        // Keep only the assistant response after the final tool call.
        finalText = '';
      }
    }
  } catch (error) {
    if (terminalWatcher.terminalStatus !== undefined) {
      throw terminalEmbeddedGateError(phase, terminalWatcher.terminalStatus);
    }
    throw error;
  } finally {
    terminalWatcher.stop();
  }

  if (terminalWatcher.terminalStatus !== undefined) {
    throw terminalEmbeddedGateError(phase, terminalWatcher.terminalStatus);
  }

  if (idleTimedOut) {
    throw new Error(`plannotator_gate ${phase} timed out waiting for provider output`);
  }
  if (!finalText.trim()) {
    throw new Error(
      `plannotator_gate ${phase} produced no assistant output (provider '${providerId}')`
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
  const lifecycleData = {
    ...(args.retryEpoch > 0 ? { retry_epoch: args.retryEpoch } : {}),
    ...(args.iteration !== undefined ? { iteration: args.iteration } : {}),
  };

  // This executor returns failures instead of throwing, so it owns the terminal event.
  // Await persistence before returning to keep retry projection consistent with run status.
  const failGateNode = async (error: string): Promise<NodeOutput> => {
    await deps.store
      .createWorkflowEvent({
        workflow_run_id: workflowRun.id,
        event_type: 'node_failed',
        step_name: args.stepName,
        data: { error, ...lifecycleData },
      })
      .catch((persistError: Error) => {
        log.error(
          { error: persistError, workflowRunId: workflowRun.id, nodeId: node.id },
          'plannotator_gate.lifecycle_persist_failed'
        );
      });
    getWorkflowEventEmitter().emit({
      type: 'node_failed',
      runId: workflowRun.id,
      nodeId: node.id,
      nodeName: node.id,
      error,
    });
    return { state: 'failed', output: '', error };
  };

  const rawApproval = workflowRun.metadata.approval;
  const approval =
    typeof rawApproval === 'object' && rawApproval !== null
      ? (rawApproval as ApprovalContext)
      : undefined;
  const persistedDocument =
    approval?.type === 'plannotator_gate' &&
    approval.nodeId === node.id &&
    approval.resolved == null &&
    typeof approval.document === 'string'
      ? approval.document
      : undefined;

  let documentPath: string;
  try {
    if (persistedDocument !== undefined) {
      documentPath = validateGateDocumentPath(persistedDocument, cwd, artifactsDir);
      await preflightPlannotatorBinary();
    } else if (gate.document !== undefined) {
      documentPath = resolveGateDocumentPath(gate.document, nodeOutputs, cwd, artifactsDir);
      await preflightPlannotatorBinary();
    } else if (gate.prepare !== undefined) {
      await preflightPlannotatorBinary();
      const { prompt: preparedTemplate } = substituteWorkflowVariables(
        gate.prepare.prompt,
        workflowRun.id,
        workflowRun.user_message,
        artifactsDir,
        args.baseBranch,
        args.docsDir,
        args.issueContext,
        undefined,
        undefined,
        undefined,
        { stateDir: args.stateDir, prRemote: args.prRemote }
      );
      const preparedPath = await runEmbeddedGateAiCall(
        args,
        'prepare',
        gate.prepare,
        substituteNodeOutputRefs(preparedTemplate, nodeOutputs)
      );
      documentPath = validateGateDocumentPath(preparedPath, cwd, artifactsDir);
    } else {
      throw new Error("plannotator_gate requires either 'document' or 'prepare'");
    }
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
    return failGateNode(message);
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
      stepName: args.stepName,
      gateId,
      cwd,
      artifactsDir,
      initialDocumentPath: documentPath,
      captureResponse: gate.capture_response === true,
      message,
      store: deps.store,
      runReworkAgent: async ({ documentPath: doc, annotations }) => {
        const { prompt: reworkTemplate } = substituteWorkflowVariables(
          gate.rework.prompt,
          workflowRun.id,
          workflowRun.user_message,
          artifactsDir,
          args.baseBranch,
          args.docsDir,
          args.issueContext,
          undefined,
          undefined,
          undefined,
          { stateDir: args.stateDir, prRemote: args.prRemote }
        );
        const filled = buildReworkPrompt(
          substituteNodeOutputRefs(reworkTemplate, nodeOutputs),
          doc,
          annotations
        );
        const nextPath = await runEmbeddedGateAiCall(args, 'rework', gate.rework, filled);
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
    return failGateNode(messageText);
  }
}
