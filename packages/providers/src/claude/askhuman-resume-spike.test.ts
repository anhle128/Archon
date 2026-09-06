import { describe, expect, test } from 'bun:test';
import {
  classifyClaudeModel,
  classifyClaudeVersion,
  type ClaudeModelEvidence,
} from './askhuman-resume-spike';

function fullyProvedEvidence(model: string): ClaudeModelEvidence {
  return {
    sdkVersion: '0.3.209',
    model,
    requiresActionSeen: false,
    failureCategory: null,
    hostAbort: {
      handlerCallsBeforePause: 1,
      handlerCallsAfterResume: 1,
      sessionIdCaptured: true,
      resumedSameSession: true,
      completionMarkerSeen: true,
    },
    deferred: {
      firstStopReason: 'tool_deferred',
      deferredToolUsePresent: true,
      handlerCallsBeforePause: 0,
      hookToolUseIds: ['toolu_ask_1', 'toolu_ask_1'],
      updatedInputReachedHandler: true,
      resumedHandlerCalls: 1,
      resumedSuccessfully: true,
      unavailable: false,
    },
  };
}

describe('Claude AskHuman spike evidence classification', () => {
  test('prefers a complete SDK defer round trip over a working host-abort workaround', () => {
    expect(classifyClaudeModel(fullyProvedEvidence('sonnet'))).toBe('tool-deferred-reissue');
  });

  test('selects host abort only when defer is unproved and the same session consumes the new answer message', () => {
    const evidence = fullyProvedEvidence('sonnet');
    evidence.deferred.firstStopReason = 'completed';
    evidence.deferred.deferredToolUsePresent = false;
    evidence.deferred.hookToolUseIds = ['toolu_ask_1'];
    evidence.deferred.updatedInputReachedHandler = false;
    evidence.deferred.resumedHandlerCalls = 0;
    evidence.deferred.resumedSuccessfully = false;

    expect(classifyClaudeModel(evidence)).toBe('host-abort-new-user-message');
  });

  test('fails closed when either required model lacks the same complete protocol', () => {
    const sonnet = fullyProvedEvidence('sonnet');
    const opus = fullyProvedEvidence('opus');
    opus.requiresActionSeen = true;

    expect(classifyClaudeVersion([sonnet, opus])).toBe('inconclusive');
  });

  test('fails closed when a run ended for an environment reason', () => {
    const evidence = fullyProvedEvidence('sonnet');
    evidence.failureCategory = 'timeout';

    expect(classifyClaudeModel(evidence)).toBe('inconclusive');
  });

  test('fails closed when the required model set is incomplete', () => {
    expect(classifyClaudeVersion([fullyProvedEvidence('sonnet')])).toBe('inconclusive');
  });
});
