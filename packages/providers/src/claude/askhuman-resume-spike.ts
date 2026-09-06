/**
 * Diagnostic-only Claude AskHuman resume spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  createSdkMcpServer,
  query,
  tool,
  type HookCallback,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

export type ClaudeProtocol =
  | 'tool-deferred-reissue'
  | 'host-abort-new-user-message'
  | 'inconclusive';

export type ClaudeFailureCategory =
  | 'authentication'
  | 'model-unavailable'
  | 'timeout'
  | 'runtime-error';

export interface ClaudeModelEvidence {
  sdkVersion: string;
  model: string;
  requiresActionSeen: boolean;
  failureCategory: ClaudeFailureCategory | null;
  hostAbort: {
    handlerCallsBeforePause: number;
    handlerCallsAfterResume: number;
    sessionIdCaptured: boolean;
    resumedSameSession: boolean;
    completionMarkerSeen: boolean;
  };
  deferred: {
    firstStopReason: string | null;
    deferredToolUsePresent: boolean;
    handlerCallsBeforePause: number;
    hookToolUseIds: string[];
    updatedInputReachedHandler: boolean;
    resumedHandlerCalls: number;
    resumedSuccessfully: boolean;
    unavailable: boolean;
  };
}

export function classifyClaudeModel(evidence: ClaudeModelEvidence): ClaudeProtocol {
  if (evidence.requiresActionSeen || evidence.failureCategory !== null) {
    return 'inconclusive';
  }

  const [firstHookId, secondHookId] = evidence.deferred.hookToolUseIds;
  const deferredProved =
    evidence.deferred.firstStopReason === 'tool_deferred' &&
    evidence.deferred.deferredToolUsePresent &&
    evidence.deferred.handlerCallsBeforePause === 0 &&
    evidence.deferred.hookToolUseIds.length === 2 &&
    firstHookId !== undefined &&
    firstHookId === secondHookId &&
    evidence.deferred.updatedInputReachedHandler &&
    evidence.deferred.resumedHandlerCalls === 1 &&
    evidence.deferred.resumedSuccessfully &&
    !evidence.deferred.unavailable;

  if (deferredProved) return 'tool-deferred-reissue';

  const hostAbortProved =
    evidence.hostAbort.handlerCallsBeforePause === 1 &&
    evidence.hostAbort.handlerCallsAfterResume === 1 &&
    evidence.hostAbort.sessionIdCaptured &&
    evidence.hostAbort.resumedSameSession &&
    evidence.hostAbort.completionMarkerSeen;

  return hostAbortProved ? 'host-abort-new-user-message' : 'inconclusive';
}

export function classifyClaudeVersion(evidence: readonly ClaudeModelEvidence[]): ClaudeProtocol {
  if (evidence.length !== 2) return 'inconclusive';
  const models = new Set(evidence.map(item => item.model));
  if (!models.has('sonnet') || !models.has('opus')) return 'inconclusive';
  const sdkVersions = new Set(evidence.map(item => item.sdkVersion));
  if (sdkVersions.size !== 1 || evidence[0]?.sdkVersion.trim() === '') return 'inconclusive';
  const protocols = new Set(evidence.map(classifyClaudeModel));
  if (protocols.size !== 1 || protocols.has('inconclusive')) return 'inconclusive';
  return protocols.values().next().value ?? 'inconclusive';
}

const askHumanInputShape = {
  questions: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      selection: z.enum(['single', 'multi']),
      options: z.array(z.string()),
      allowOther: z.boolean(),
    })
  ),
  archonResume: z
    .object({
      payload: z.string(),
      declined: z.boolean(),
    })
    .optional(),
};

const qualifiedToolName = 'mcp__archon__AskHuman';
const EXPERIMENT_TIMEOUT_MS = 120_000;
const REDACTED_SPIKE_RESULT = 'redacted spike result';

interface ExperimentMarkers {
  answer: string;
  completion: string;
}

interface CollectedClaudeQuery {
  sessionId: string | null;
  stopReason: string | null;
  terminalReason: string | null;
  deferredToolUseId: string | null;
  deferredToolUseName: string | null;
  requiresActionSeen: boolean;
  completed: boolean;
  completionMarkerSeen: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createExperimentMarkers(): ExperimentMarkers {
  const nonce = randomUUID().replaceAll('-', '');
  return {
    answer: `SPIKE_ANSWER_${nonce}`,
    completion: `SPIKE_COMPLETION_${nonce}`,
  };
}

function askOncePrompt(markers: ExperimentMarkers): string {
  return (
    'Call the AskHuman tool exactly once with one question object: ' +
    'id "q1", prompt "Select a label.", selection "single", ' +
    'options ["alpha","beta"], allowOther false. ' +
    'Only after a later user message contains the generated answer marker ' +
    markers.answer +
    ', reply with the generated completion marker ' +
    markers.completion +
    ' and stop. Never call AskHuman a second time.'
  );
}

export async function runWithExperimentTimeout<T>(
  timeoutMs: number,
  work: (register: (controller: AbortController) => void) => Promise<T>
): Promise<T> {
  const controllers = new Set<AbortController>();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      const error = new Error('spike experiment timed out');
      error.name = 'TimeoutError';
      reject(error);
      for (const controller of controllers) controller.abort();
    }, timeoutMs);
  });
  const register = (controller: AbortController): void => {
    controllers.add(controller);
    if (expired) controller.abort();
  };

  try {
    return await Promise.race([work(register), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function emptyHostAbort(): ClaudeModelEvidence['hostAbort'] {
  return {
    handlerCallsBeforePause: 0,
    handlerCallsAfterResume: 0,
    sessionIdCaptured: false,
    resumedSameSession: false,
    completionMarkerSeen: false,
  };
}

function emptyDeferred(): ClaudeModelEvidence['deferred'] {
  return {
    firstStopReason: null,
    deferredToolUsePresent: false,
    handlerCallsBeforePause: 0,
    hookToolUseIds: [],
    updatedInputReachedHandler: false,
    resumedHandlerCalls: 0,
    resumedSuccessfully: false,
    unavailable: false,
  };
}

function redactedToolResult(): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: REDACTED_SPIKE_RESULT }] };
}

function createAskHumanServer(
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>
): McpSdkServerConfigWithInstance {
  const askTool = tool(
    'AskHuman',
    'Ask the human operator a structured question and wait for their answer.',
    askHumanInputShape,
    async args => handler(isRecord(args) ? args : {}),
    { alwaysLoad: true }
  );
  return createSdkMcpServer({
    name: 'archon',
    version: '1.0.0',
    tools: [askTool],
    alwaysLoad: true,
  });
}

function spikeQueryOptions(
  model: string,
  server: ReturnType<typeof createSdkMcpServer>,
  extras: Partial<Options> = {}
): Options {
  return {
    cwd: process.cwd(),
    model,
    tools: [qualifiedToolName],
    allowedTools: [qualifiedToolName],
    mcpServers: { archon: server },
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 3,
    maxBudgetUsd: 1,
    ...extras,
  };
}

function readSessionId(message: SDKMessage): string | null {
  if (!('session_id' in message)) return null;
  const sessionId = message.session_id;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function applyCollectedMessage(
  collected: CollectedClaudeQuery,
  message: SDKMessage,
  completionMarker: string
): void {
  const sessionId = readSessionId(message);
  if (sessionId !== null) collected.sessionId = sessionId;

  if (
    message.type === 'system' &&
    'subtype' in message &&
    message.subtype === 'session_state_changed' &&
    message.state === 'requires_action'
  ) {
    collected.requiresActionSeen = true;
  }

  if (message.type !== 'result') return;
  collected.stopReason = message.stop_reason;
  collected.terminalReason = message.terminal_reason ?? null;
  if (message.subtype !== 'success') return;
  collected.completed = true;
  if (message.result.includes(completionMarker)) {
    collected.completionMarkerSeen = true;
  }
  if (message.deferred_tool_use) {
    collected.deferredToolUseId = message.deferred_tool_use.id;
    collected.deferredToolUseName = message.deferred_tool_use.name;
  }
}

function emptyCollectedQuery(): CollectedClaudeQuery {
  return {
    sessionId: null,
    stopReason: null,
    terminalReason: null,
    deferredToolUseId: null,
    deferredToolUseName: null,
    requiresActionSeen: false,
    completed: false,
    completionMarkerSeen: false,
  };
}

async function collectClaudeQuery(
  prompt: string,
  options: Options,
  completionMarker: string
): Promise<CollectedClaudeQuery> {
  const collected = emptyCollectedQuery();
  const stream = query({ prompt, options });
  try {
    for await (const message of stream) {
      applyCollectedMessage(collected, message, completionMarker);
    }
  } catch (error) {
    if (options.abortController?.signal.aborted) return collected;
    throw error;
  } finally {
    try {
      stream.close();
    } catch {
      // The iterator may already have closed after a normal or aborted result.
    }
  }
  return collected;
}

function isUnavailable(collected: CollectedClaudeQuery): boolean {
  return (
    collected.stopReason === 'tool_deferred_unavailable' ||
    collected.terminalReason === 'tool_deferred_unavailable'
  );
}

function firstStopReason(collected: CollectedClaudeQuery): string | null {
  return collected.stopReason ?? collected.terminalReason;
}

function archonResumeReachedHandler(args: Record<string, unknown>): boolean {
  const resume = args.archonResume;
  return isRecord(resume) && resume.payload === 'east' && resume.declined === false;
}

async function runHostAbortExperiment(
  model: string,
  _sdkVersion: string
): Promise<ClaudeModelEvidence['hostAbort'] & { requiresActionSeen: boolean }> {
  return runWithExperimentTimeout(EXPERIMENT_TIMEOUT_MS, async registerController => {
    const markers = createExperimentMarkers();
    const firstController = new AbortController();
    registerController(firstController);
    let handlerCalls = 0;
    const firstServer = createAskHumanServer(async () => {
      handlerCalls += 1;
      firstController.abort();
      return redactedToolResult();
    });
    const first = await collectClaudeQuery(
      askOncePrompt(markers),
      spikeQueryOptions(model, firstServer, { abortController: firstController }),
      markers.completion
    );
    const handlerCallsBeforePause = handlerCalls;

    const resumeController = new AbortController();
    registerController(resumeController);
    const resumeServer = createAskHumanServer(async () => {
      handlerCalls += 1;
      return redactedToolResult();
    });
    let resumed: CollectedClaudeQuery | null = null;
    if (first.sessionId !== null) {
      resumed = await collectClaudeQuery(
        markers.answer,
        spikeQueryOptions(model, resumeServer, {
          resume: first.sessionId,
          abortController: resumeController,
        }),
        markers.completion
      );
    }

    return {
      handlerCallsBeforePause,
      handlerCallsAfterResume: handlerCalls,
      sessionIdCaptured: first.sessionId !== null,
      resumedSameSession:
        first.sessionId !== null && resumed !== null && resumed.sessionId === first.sessionId,
      completionMarkerSeen: resumed?.completionMarkerSeen === true,
      requiresActionSeen: first.requiresActionSeen || (resumed?.requiresActionSeen ?? false),
    };
  });
}

async function runDeferredExperiment(
  model: string,
  _sdkVersion: string
): Promise<ClaudeModelEvidence['deferred'] & { requiresActionSeen: boolean }> {
  const markers = createExperimentMarkers();
  const hookToolUseIds: string[] = [];
  let handlerCallsBeforePause = 0;
  let resumedHandlerCalls = 0;
  let updatedInputReachedHandler = false;

  const deferHook: HookCallback = async input => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    hookToolUseIds.push(input.tool_use_id);
    if (hookToolUseIds.length === 1) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'defer',
          permissionDecisionReason: 'Archon AskHuman spike pause',
        },
      };
    }
    const originalInput = isRecord(input.tool_input) ? input.tool_input : {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...originalInput,
          archonResume: { payload: 'east', declined: false },
        },
      },
    };
  };
  const deferHooks: Options['hooks'] = {
    PreToolUse: [{ matcher: qualifiedToolName, hooks: [deferHook] }],
  };

  return runWithExperimentTimeout(EXPERIMENT_TIMEOUT_MS, async registerController => {
    const firstController = new AbortController();
    registerController(firstController);
    const firstServer = createAskHumanServer(async () => {
      handlerCallsBeforePause += 1;
      return redactedToolResult();
    });
    const first = await collectClaudeQuery(
      askOncePrompt(markers),
      spikeQueryOptions(model, firstServer, {
        hooks: deferHooks,
        abortController: firstController,
      }),
      markers.completion
    );

    const firstHookId = hookToolUseIds[0];
    const deferredToolUsePresent =
      firstHookId !== undefined &&
      first.deferredToolUseId === firstHookId &&
      first.deferredToolUseName === qualifiedToolName;

    const resumeController = new AbortController();
    registerController(resumeController);
    const resumeServer = createAskHumanServer(async args => {
      resumedHandlerCalls += 1;
      if (archonResumeReachedHandler(args)) updatedInputReachedHandler = true;
      return redactedToolResult();
    });
    let resumed: CollectedClaudeQuery | null = null;
    if (first.sessionId !== null) {
      resumed = await collectClaudeQuery(
        'Continue the pending tool call.',
        spikeQueryOptions(model, resumeServer, {
          resume: first.sessionId,
          hooks: deferHooks,
          abortController: resumeController,
        }),
        markers.completion
      );
    }

    const unavailable = isUnavailable(first) || (resumed !== null && isUnavailable(resumed));
    return {
      firstStopReason: firstStopReason(first),
      deferredToolUsePresent,
      handlerCallsBeforePause,
      hookToolUseIds,
      updatedInputReachedHandler,
      resumedHandlerCalls,
      resumedSuccessfully: resumed !== null && resumed.completed && !unavailable,
      unavailable,
      requiresActionSeen: first.requiresActionSeen || (resumed?.requiresActionSeen ?? false),
    };
  });
}

function classifyFailure(error: unknown): ClaudeFailureCategory {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout';
  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('api key') ||
    lower.includes('oauth') ||
    lower.includes('401')
  ) {
    return 'authentication';
  }
  if (
    lower.includes('model') &&
    (lower.includes('unavailable') ||
      lower.includes('not found') ||
      lower.includes('invalid model') ||
      lower.includes('404'))
  ) {
    return 'model-unavailable';
  }
  return 'runtime-error';
}

function hostAbortFields(
  result: ClaudeModelEvidence['hostAbort'] & { requiresActionSeen: boolean }
): ClaudeModelEvidence['hostAbort'] {
  return {
    handlerCallsBeforePause: result.handlerCallsBeforePause,
    handlerCallsAfterResume: result.handlerCallsAfterResume,
    sessionIdCaptured: result.sessionIdCaptured,
    resumedSameSession: result.resumedSameSession,
    completionMarkerSeen: result.completionMarkerSeen,
  };
}

function deferredFields(
  result: ClaudeModelEvidence['deferred'] & { requiresActionSeen: boolean }
): ClaudeModelEvidence['deferred'] {
  return {
    firstStopReason: result.firstStopReason,
    deferredToolUsePresent: result.deferredToolUsePresent,
    handlerCallsBeforePause: result.handlerCallsBeforePause,
    hookToolUseIds: result.hookToolUseIds,
    updatedInputReachedHandler: result.updatedInputReachedHandler,
    resumedHandlerCalls: result.resumedHandlerCalls,
    resumedSuccessfully: result.resumedSuccessfully,
    unavailable: result.unavailable,
  };
}

async function runClaudeVersionSpike(
  sdkVersion: string,
  models: readonly string[]
): Promise<{
  schemaVersion: 1;
  sdkVersion: string;
  models: ClaudeModelEvidence[];
  protocol: ClaudeProtocol;
}> {
  const evidence: ClaudeModelEvidence[] = [];
  for (const model of models) {
    let requiresActionSeen = false;
    let failureCategory: ClaudeFailureCategory | null = null;
    let hostAbort = emptyHostAbort();
    let deferred = emptyDeferred();

    try {
      const hostResult = await runHostAbortExperiment(model, sdkVersion);
      hostAbort = hostAbortFields(hostResult);
      requiresActionSeen = requiresActionSeen || hostResult.requiresActionSeen;
    } catch (error) {
      failureCategory = classifyFailure(error);
    }

    try {
      const deferredResult = await runDeferredExperiment(model, sdkVersion);
      deferred = deferredFields(deferredResult);
      requiresActionSeen = requiresActionSeen || deferredResult.requiresActionSeen;
    } catch (error) {
      failureCategory = failureCategory ?? classifyFailure(error);
    }

    evidence.push({
      sdkVersion,
      model,
      requiresActionSeen,
      failureCategory,
      hostAbort,
      deferred,
    });
  }

  return {
    schemaVersion: 1,
    sdkVersion,
    models: evidence,
    protocol: classifyClaudeVersion(evidence),
  };
}

function readInstalledClaudeSdkVersion(expected: string): string {
  const entry = Bun.resolveSync('@anthropic-ai/claude-agent-sdk', import.meta.dir);
  const manifestPath = join(dirname(entry), 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new Error('Claude SDK manifest is unreadable');
  }
  if (parsed.version !== expected) {
    throw new Error('Claude SDK version mismatch');
  }
  return parsed.version;
}

function parseSpikeModels(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return ['sonnet', 'opus'];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

async function main(): Promise<void> {
  const expected = process.env.EXPECTED_CLAUDE_SDK_VERSION ?? '0.3.209';
  const sdkVersion = readInstalledClaudeSdkVersion(expected);
  const document = await runClaudeVersionSpike(
    sdkVersion,
    parseSpikeModels(process.env.CLAUDE_SPIKE_MODELS)
  );
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (document.protocol === 'inconclusive') process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
