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
  const protocols = new Set(evidence.map(classifyClaudeModel));
  if (protocols.size !== 1 || protocols.has('inconclusive')) return 'inconclusive';
  return protocols.values().next().value ?? 'inconclusive';
}
