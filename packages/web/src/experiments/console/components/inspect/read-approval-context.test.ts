import { describe, expect, test } from 'bun:test';
import {
  getPlannotatorReviewUrl,
  readApprovalContext,
  type ApprovalContext,
  type ApprovalContextType,
} from './read-approval-context';

const REQUIRED = { nodeId: 'gate', message: 'Approve to continue?' } as const;

describe('readApprovalContext', () => {
  const invalidCases: Array<{ name: string; input: unknown }> = [
    { name: 'null', input: null },
    { name: 'undefined', input: undefined },
    { name: 'an array', input: [] },
    { name: 'a string', input: 'approval' },
    { name: 'a number', input: 1 },
    { name: 'missing nodeId', input: { message: REQUIRED.message } },
    { name: 'missing message', input: { nodeId: REQUIRED.nodeId } },
    { name: 'numeric nodeId', input: { nodeId: 1, message: REQUIRED.message } },
    { name: 'numeric message', input: { nodeId: REQUIRED.nodeId, message: 1 } },
    { name: 'boolean nodeId', input: { nodeId: true, message: REQUIRED.message } },
    { name: 'boolean message', input: { nodeId: REQUIRED.nodeId, message: false } },
    { name: 'unsupported type', input: { ...REQUIRED, type: 'unsupported' } },
    { name: 'numeric type', input: { ...REQUIRED, type: 1 } },
    { name: 'pending resolved', input: { ...REQUIRED, resolved: 'pending' } },
    { name: 'numeric resolved', input: { ...REQUIRED, resolved: 1 } },
  ];

  for (const { name, input } of invalidCases) {
    test(`returns null for ${name}`, () => {
      expect(readApprovalContext(input)).toBeNull();
    });
  }

  const acceptedTypes: ApprovalContextType[] = [
    'approval',
    'plannotator_gate',
    'child_workflow',
    'interactive_loop',
    'writeback',
  ];

  for (const type of acceptedTypes) {
    test(`accepts type ${type}`, () => {
      expect(readApprovalContext({ ...REQUIRED, type })).toEqual({
        ...REQUIRED,
        type,
      });
    });
  }

  test('keeps the historical approval shape whose type is omitted', () => {
    expect(readApprovalContext({ ...REQUIRED })).toEqual({ ...REQUIRED });
  });

  test('keeps type-correct child-run data and drops a wrong-typed childRunId', () => {
    expect(
      readApprovalContext({
        ...REQUIRED,
        type: 'child_workflow',
        childRunId: 'child-1',
      })
    ).toEqual({
      ...REQUIRED,
      type: 'child_workflow',
      childRunId: 'child-1',
    });
    expect(readApprovalContext({ ...REQUIRED, childRunId: 7 })).toEqual({ ...REQUIRED });
  });

  test('keeps type-correct plannotator data and drops a wrong-typed reviewUrl', () => {
    const parsed = readApprovalContext({
      ...REQUIRED,
      type: 'plannotator_gate',
      document: '/tmp/review.md',
      reviewUrl: 'https://review.example/session',
      resolved: null,
    });
    expect(parsed).toEqual({
      ...REQUIRED,
      type: 'plannotator_gate',
      document: '/tmp/review.md',
      reviewUrl: 'https://review.example/session',
      resolved: null,
    } satisfies ApprovalContext);
    expect(readApprovalContext({ ...REQUIRED, reviewUrl: 12, document: false })).toEqual({
      ...REQUIRED,
    });
  });

  test('keeps approved, rejected, and null resolved decisions', () => {
    expect(readApprovalContext({ ...REQUIRED, resolved: 'approved' })).toEqual({
      ...REQUIRED,
      resolved: 'approved',
    });
    expect(readApprovalContext({ ...REQUIRED, resolved: 'rejected' })).toEqual({
      ...REQUIRED,
      resolved: 'rejected',
    });
    expect(readApprovalContext({ ...REQUIRED, resolved: null })).toEqual({
      ...REQUIRED,
      resolved: null,
    });
  });
});

describe('getPlannotatorReviewUrl', () => {
  const approval = {
    ...REQUIRED,
    type: 'plannotator_gate' as const,
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
    expect(getPlannotatorReviewUrl({ status: 'completed', approval })).toBeNull();
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
        approval: { ...approval, reviewUrl: 'ftp://review.example/session' },
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
