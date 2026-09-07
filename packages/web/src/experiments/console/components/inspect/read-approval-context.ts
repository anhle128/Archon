export type ApprovalContextType =
  | 'approval'
  | 'plannotator_gate'
  | 'child_workflow'
  | 'interactive_loop'
  | 'writeback';

export interface ApprovalContext {
  nodeId: string;
  message: string;
  type?: ApprovalContextType;
  childRunId?: string;
  document?: string;
  reviewUrl?: string | null;
  resolved?: 'approved' | 'rejected' | null;
  gateId?: string;
  reviewSessionId?: string | null;
  feedbackSubmission?: {
    status: string;
    submittedAt?: string;
    requestId?: string;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApprovalContextType(value: unknown): value is ApprovalContextType {
  return (
    value === 'approval' ||
    value === 'plannotator_gate' ||
    value === 'child_workflow' ||
    value === 'interactive_loop' ||
    value === 'writeback'
  );
}

export function readApprovalContext(value: unknown): ApprovalContext | null {
  if (!isRecord(value)) return null;
  if (typeof value.nodeId !== 'string' || typeof value.message !== 'string') return null;
  if (value.type !== undefined && !isApprovalContextType(value.type)) return null;
  if (
    value.resolved !== undefined &&
    value.resolved !== null &&
    value.resolved !== 'approved' &&
    value.resolved !== 'rejected'
  ) {
    return null;
  }
  return {
    nodeId: value.nodeId,
    message: value.message,
    ...(isApprovalContextType(value.type) ? { type: value.type } : {}),
    ...(typeof value.childRunId === 'string' ? { childRunId: value.childRunId } : {}),
    ...(typeof value.document === 'string' ? { document: value.document } : {}),
    ...(typeof value.reviewUrl === 'string' || value.reviewUrl === null
      ? { reviewUrl: value.reviewUrl }
      : {}),
    ...(value.resolved === 'approved' || value.resolved === 'rejected' || value.resolved === null
      ? { resolved: value.resolved }
      : {}),
    ...(typeof value.gateId === 'string' ? { gateId: value.gateId } : {}),
    ...(typeof value.reviewSessionId === 'string' || value.reviewSessionId === null
      ? { reviewSessionId: value.reviewSessionId }
      : {}),
    ...(value.feedbackSubmission !== undefined
      ? {
          feedbackSubmission:
            value.feedbackSubmission === null || typeof value.feedbackSubmission === 'object'
              ? (value.feedbackSubmission as ApprovalContext['feedbackSubmission'])
              : null,
        }
      : {}),
  };
}

export function getPlannotatorReviewUrl(input: {
  status: string;
  approval: unknown;
}): string | null {
  if (input.status !== 'paused') return null;
  const approval = readApprovalContext(input.approval);
  if (approval?.type !== 'plannotator_gate' || typeof approval.reviewUrl !== 'string') return null;
  try {
    const url = new URL(approval.reviewUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
