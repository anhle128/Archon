import { describe, expect, test } from 'bun:test';
import { getPlannotatorReviewUrl, readApprovalContext } from './approval-context';

describe('readApprovalContext', () => {
  test('keeps required and type-correct optional fields', () => {
    expect(
      readApprovalContext({
        nodeId: 'review',
        message: 'Review the plan',
        type: 'plannotator_gate',
        childRunId: 'child-1',
        document: '/tmp/review.md',
        reviewUrl: 'https://review.example/session',
        resolved: null,
      })
    ).toEqual({
      nodeId: 'review',
      message: 'Review the plan',
      type: 'plannotator_gate',
      childRunId: 'child-1',
      document: '/tmp/review.md',
      reviewUrl: 'https://review.example/session',
      resolved: null,
    });
  });

  test('rejects values without the two required strings', () => {
    expect(readApprovalContext(null)).toBeNull();
    expect(readApprovalContext({ nodeId: 'review' })).toBeNull();
    expect(readApprovalContext({ nodeId: 1, message: 'Review' })).toBeNull();
  });

  test('keeps the historical approval shape whose type is omitted', () => {
    expect(readApprovalContext({ nodeId: 'review', message: 'Review' })).toEqual({
      nodeId: 'review',
      message: 'Review',
    });
  });

  test('rejects unsupported optional enum values', () => {
    expect(
      readApprovalContext({
        nodeId: 'review',
        message: 'Review',
        type: 'unsupported',
        resolved: 'pending',
      })
    ).toBeNull();
  });
});

describe('getPlannotatorReviewUrl', () => {
  const approval = {
    nodeId: 'review',
    message: 'Review',
    type: 'plannotator_gate',
    reviewUrl: 'https://review.example/session',
  };

  test('returns a normalized HTTP(S) URL only for a paused Plannotator gate', () => {
    expect(getPlannotatorReviewUrl({ status: 'paused', approval })).toBe(
      'https://review.example/session'
    );
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'http://review.example/session' },
      })
    ).toBe('http://review.example/session');
    expect(getPlannotatorReviewUrl({ status: 'running', approval })).toBeNull();
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, type: 'approval' },
      })
    ).toBeNull();
  });

  test('rejects malformed and unsafe URLs', () => {
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'javascript:alert(1)' },
      })
    ).toBeNull();
    expect(
      getPlannotatorReviewUrl({
        status: 'paused',
        approval: { ...approval, reviewUrl: 'not a url' },
      })
    ).toBeNull();
  });
});
