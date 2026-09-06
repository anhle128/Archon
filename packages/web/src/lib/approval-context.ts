export type WebApprovalContextType =
  | 'approval'
  | 'plannotator_gate'
  | 'child_workflow'
  | 'interactive_loop'
  | 'writeback';

export interface WebApprovalContext {
  nodeId: string;
  message: string;
  type?: WebApprovalContextType;
  childRunId?: string;
  document?: string;
  reviewUrl?: string | null;
  resolved?: 'approved' | 'rejected' | null;
}

function isApprovalContextType(value: unknown): value is WebApprovalContextType {
  return (
    value === 'approval' ||
    value === 'plannotator_gate' ||
    value === 'child_workflow' ||
    value === 'interactive_loop' ||
    value === 'writeback'
  );
}

export function readApprovalContext(value: unknown): WebApprovalContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.nodeId !== 'string' || typeof record.message !== 'string') return null;
  if (record.type !== undefined && !isApprovalContextType(record.type)) return null;
  if (
    record.resolved !== undefined &&
    record.resolved !== null &&
    record.resolved !== 'approved' &&
    record.resolved !== 'rejected'
  ) {
    return null;
  }
  return {
    nodeId: record.nodeId,
    message: record.message,
    ...(isApprovalContextType(record.type) ? { type: record.type } : {}),
    ...(typeof record.childRunId === 'string' ? { childRunId: record.childRunId } : {}),
    ...(typeof record.document === 'string' ? { document: record.document } : {}),
    ...(typeof record.reviewUrl === 'string' || record.reviewUrl === null
      ? { reviewUrl: record.reviewUrl }
      : {}),
    ...(record.resolved === 'approved' || record.resolved === 'rejected' || record.resolved === null
      ? { resolved: record.resolved }
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
