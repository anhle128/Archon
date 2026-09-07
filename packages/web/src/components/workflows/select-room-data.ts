import type { DagNode, WorkflowEventResponse } from '@/lib/api';
import { getPlannotatorReviewUrl, readApprovalContext } from '@/lib/approval-context';
import type { WorkflowRunStatus } from '@/lib/types';
import type { LogRow } from './build-log-rows';

export interface StdoutView {
  text: string | null;
  status: LogRow['status'];
  exitCode: 0 | null;
  truncated: boolean;
  originalBytes: number | null;
  failedDetail: string | null;
}

export interface GateChrome {
  gateType: 'approval' | 'plannotator_gate';
  message: string;
  document: string | null;
  decision: 'approved' | 'rejected' | null;
  canDecide: boolean;
  showInactiveNotice: boolean;
  reviewUrl: string | null;
  gateId: string | null;
  reviewSessionId: string | null;
  feedbackReceiptStatus: string | null;
}

export interface ChildRunRef {
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
  status: LogRow['status'];
}

export interface RouteDecisionView {
  outcome: string | null;
  to: string | null;
  condition: string | null;
  conditionResult: string | null;
  attempt: string | null;
  executionSeq: string | null;
  negativeCount: string | null;
  maxIterations: string | null;
}

export interface LoopGroupBodyNode {
  id: string;
  qualifiedId: string;
  dependsOn: string[];
}

export interface LoopGroupBodyState extends LoopGroupBodyNode {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export interface LoopGroupIterationView {
  iteration: number;
  status: 'running' | 'completed' | 'failed';
  body: LoopGroupBodyState[];
}

export interface LoopGroupChrome {
  body: LoopGroupBodyNode[];
  iterations: LoopGroupIterationView[];
  selectedIteration: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function eventData(event: WorkflowEventResponse): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function eventsForRow(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): WorkflowEventResponse[] {
  const start = events.findIndex(event => event.id === row.id);
  const scoped = start >= 0 ? events.slice(start) : events;
  return scoped.filter(event => event.step_name === row.nodeId);
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function routePrimitive(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function lastTerminal(events: readonly WorkflowEventResponse[]): WorkflowEventResponse | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event !== undefined &&
      (event.event_type === 'node_completed' || event.event_type === 'node_failed')
    ) {
      return event;
    }
  }
  return null;
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function matchingApproval(
  approval: unknown,
  nodeId: string
): ReturnType<typeof readApprovalContext> {
  const context = readApprovalContext(approval);
  return context?.nodeId === nodeId ? context : null;
}

function declaredGateMessage(
  definitionNode: DagNode | null,
  gateType: 'approval' | 'plannotator_gate'
): string | null {
  if (gateType === 'approval') {
    const message = definitionNode?.approval?.message;
    return typeof message === 'string' ? message : null;
  }
  const message = definitionNode?.plannotator_gate?.message;
  return typeof message === 'string' ? message : null;
}

function gateDecision(
  events: readonly WorkflowEventResponse[],
  row: LogRow,
  matching: ReturnType<typeof readApprovalContext>
): 'approved' | 'rejected' | null {
  const contextDecision =
    matching?.resolved === 'approved' || matching?.resolved === 'rejected'
      ? matching.resolved
      : null;
  const rowAnchored = events.some(event => event.id === row.id);
  if (!rowAnchored && matching !== null) return contextDecision;

  const scoped = eventsForRow(events, row);
  for (let index = scoped.length - 1; index >= 0; index -= 1) {
    const event = scoped[index];
    if (event?.event_type !== 'node_completed') continue;
    const decision = eventData(event).approval_decision;
    if (decision === 'approved' || decision === 'rejected') return decision;
  }
  return contextDecision;
}

function bodyLifecycleStatus(eventType: string): LoopGroupBodyState['status'] | null {
  if (eventType === 'node_started') return 'running';
  if (eventType === 'node_completed') return 'completed';
  if (eventType === 'node_failed') return 'failed';
  if (eventType === 'node_skipped' || eventType === 'node_skipped_prior_success') return 'skipped';
  return null;
}

function loopIterationStatus(eventType: string): LoopGroupIterationView['status'] | null {
  if (eventType === 'loop_iteration_started') return 'running';
  if (eventType === 'loop_iteration_completed') return 'completed';
  if (eventType === 'loop_iteration_failed') return 'failed';
  return null;
}

function iterationStatusFromBody(
  body: readonly LoopGroupBodyState[]
): LoopGroupIterationView['status'] {
  if (body.some(node => node.status === 'failed')) return 'failed';
  if (body.every(node => node.status === 'completed' || node.status === 'skipped')) {
    return 'completed';
  }
  return 'running';
}

function emptyStdout(status: LogRow['status']): StdoutView {
  return {
    text: null,
    status,
    exitCode: null,
    truncated: false,
    originalBytes: null,
    failedDetail: null,
  };
}

function emptyChild(status: LogRow['status']): ChildRunRef {
  return {
    childRunId: null,
    fanOut: false,
    output: null,
    paused: false,
    message: null,
    status,
  };
}

export function selectNodeStdout(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): StdoutView {
  const terminal = lastTerminal(eventsForRow(events, row));
  if (terminal === null) return emptyStdout(row.status);
  const data = eventData(terminal);
  const output = data.node_output;
  const failed = terminal.event_type === 'node_failed';
  return {
    text: typeof output === 'string' && !failed ? output : null,
    status: row.status,
    exitCode: !failed && typeof output === 'string' ? 0 : null,
    truncated: data.node_output_truncated === true,
    originalBytes: nonNegativeSafeInteger(data.node_output_original_bytes),
    failedDetail: failed ? stringField(data, 'error') : null,
  };
}

export function selectGateChrome(input: {
  definitionNode: DagNode | null;
  events: readonly WorkflowEventResponse[];
  row: LogRow;
  approval: unknown;
  runStatus: WorkflowRunStatus;
  gateType: 'approval' | 'plannotator_gate';
}): GateChrome {
  const { definitionNode, events, row, approval, runStatus, gateType } = input;
  const approvalContext = readApprovalContext(approval);
  const matching = matchingApproval(approval, row.nodeId);
  const compatibleType = approvalContext?.type === undefined || approvalContext.type === gateType;
  const ownsActiveSlot =
    runStatus === 'paused' && approvalContext?.nodeId === row.nodeId && compatibleType;
  const unresolved = approvalContext?.resolved === undefined || approvalContext.resolved === null;
  const canDecide = ownsActiveSlot && unresolved;
  const reviewUrl =
    gateType === 'plannotator_gate' && approvalContext?.nodeId === row.nodeId
      ? getPlannotatorReviewUrl({ status: runStatus, approval })
      : null;
  const declaredMessage = declaredGateMessage(definitionNode, gateType);
  const fallback = gateType === 'approval' ? 'Approval required' : 'Plannotator review';
  const documentFromContext = matching?.document;
  const declaredDocument = definitionNode?.plannotator_gate?.document;
  return {
    gateType,
    message: declaredMessage ?? matching?.message ?? fallback,
    document:
      gateType === 'plannotator_gate'
        ? typeof documentFromContext === 'string'
          ? documentFromContext
          : typeof declaredDocument === 'string'
            ? declaredDocument
            : null
        : null,
    decision: gateDecision(events, row, matching),
    canDecide,
    showInactiveNotice: runStatus === 'paused' && approvalContext !== null && !ownsActiveSlot,
    reviewUrl,
    gateId:
      typeof matching?.gateId === 'string' ? matching.gateId : (approvalContext?.gateId ?? null),
    reviewSessionId:
      gateType === 'plannotator_gate' && ownsActiveSlot
        ? (approvalContext?.reviewSessionId ?? null)
        : null,
    feedbackReceiptStatus:
      gateType === 'plannotator_gate' && approvalContext?.nodeId === row.nodeId
        ? (approvalContext.feedbackSubmission?.status ?? null)
        : null,
  };
}

export function selectChildRun(input: {
  events: readonly WorkflowEventResponse[];
  approval: unknown;
  row: LogRow;
  runStatus: WorkflowRunStatus;
}): ChildRunRef {
  const { events, approval, row, runStatus } = input;
  const matching = matchingApproval(approval, row.nodeId);
  if (runStatus === 'paused' && matching?.type === 'child_workflow') {
    return {
      childRunId: typeof matching.childRunId === 'string' ? matching.childRunId : null,
      fanOut: false,
      output: null,
      paused: true,
      message: matching.message,
      status: row.status,
    };
  }
  const terminal = lastTerminal(eventsForRow(events, row));
  if (terminal === null || terminal.event_type === 'node_failed') {
    return emptyChild(row.status);
  }
  const data = eventData(terminal);
  const fanOut = data.fan_out === true;
  return {
    childRunId: fanOut ? null : stringField(data, 'child_run_id'),
    fanOut,
    output: stringField(data, 'node_output'),
    paused: false,
    message: null,
    status: row.status,
  };
}

export function selectRouteDecision(
  events: readonly WorkflowEventResponse[],
  row: LogRow
): RouteDecisionView | null {
  if (row.selection.kind !== 'route_iteration') return null;
  const executionSeq = row.selection.executionSeq;
  const match = events.find(event => {
    if (event.event_type !== 'node_routed' || event.step_name !== row.nodeId) return false;
    return eventData(event).execution_seq === executionSeq;
  });
  if (match === undefined) return null;
  const data = eventData(match);
  return {
    outcome: routePrimitive(data.outcome),
    to: routePrimitive(data.to),
    condition: routePrimitive(data.condition),
    conditionResult: routePrimitive(data.condition_result),
    attempt: routePrimitive(data.attempt),
    executionSeq: routePrimitive(data.execution_seq),
    negativeCount: routePrimitive(data.negative_count),
    maxIterations: routePrimitive(data.max_iterations),
  };
}

export function selectLoopGroupChrome(input: {
  definitionNode: DagNode | null;
  events: readonly WorkflowEventResponse[];
  row: LogRow;
}): LoopGroupChrome {
  const { definitionNode, events, row } = input;
  const children = definitionNode?.loop_group?.nodes ?? [];
  const body: LoopGroupBodyNode[] = children.map(child => ({
    id: child.id,
    qualifiedId: row.nodeId + '.' + child.id,
    dependsOn: [...(child.depends_on ?? [])],
  }));
  const selectedIteration =
    row.selection.kind === 'loop_iteration' ? row.selection.iteration : null;
  if (body.length === 0) {
    return { body, iterations: [], selectedIteration };
  }
  const bodyIds = new Set(body.map(node => node.qualifiedId));
  const lastByIteration = new Map<number, Map<string, LoopGroupBodyState['status']>>();
  const iterationStatusByIteration = new Map<number, LoopGroupIterationView['status']>();
  for (const event of events) {
    const iteration = safePositiveInteger(eventData(event).iteration);
    if (iteration === null) continue;

    if (event.step_name === row.nodeId) {
      const iterationStatus = loopIterationStatus(event.event_type);
      if (iterationStatus !== null) {
        iterationStatusByIteration.set(iteration, iterationStatus);
      }
    }

    const qualifiedId = event.step_name;
    if (qualifiedId === null || !bodyIds.has(qualifiedId)) continue;
    const status = bodyLifecycleStatus(event.event_type);
    if (status === null) continue;
    const statuses = lastByIteration.get(iteration) ?? new Map();
    statuses.set(qualifiedId, status);
    lastByIteration.set(iteration, statuses);
  }
  const iterationNumbers = new Set([
    ...iterationStatusByIteration.keys(),
    ...lastByIteration.keys(),
  ]);
  const iterations = [...iterationNumbers]
    .sort((left, right) => left - right)
    .map(iteration => {
      const statuses = lastByIteration.get(iteration) ?? new Map();
      const iterationBody: LoopGroupBodyState[] = body.map(node => ({
        ...node,
        dependsOn: [...node.dependsOn],
        status: statuses.get(node.qualifiedId) ?? 'pending',
      }));
      return {
        iteration,
        status: iterationStatusByIteration.get(iteration) ?? iterationStatusFromBody(iterationBody),
        body: iterationBody,
      };
    });
  return { body, iterations, selectedIteration };
}
