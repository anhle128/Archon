/**
 * Narrow usage-recorder port for workflow accounting.
 *
 * Kept separate from IWorkflowStore so lifecycle/event storage does not grow
 * an unrelated accounting method. Core owns the implementation (validation,
 * pricing materialization, atomic event+ledger writes); the executor only
 * supplies pass context and already-validated provider observations.
 */
import type { ModelUsageEntry } from './schemas/usage-breakdown';

/**
 * One usage-bearing AI pass ready for persistence.
 *
 * Does not carry pricing or ledger columns — core owns that policy.
 * `agentProvider` is the selected Archon agent id from the node execution
 * context, never a value taken from a usage entry.
 */
export interface RecordWorkflowUsageInput {
  /** Workflow run id that owns the audit event. */
  runId: string;
  /**
   * Actual persisted step name for the event row.
   * Loop-group body nodes use the namespaced `groupId.nodeId` form.
   */
  stepName: string;
  /** Selected agent-provider id from node execution context. */
  agentProvider: string;
  /** Validated camelCase provider usage observations (order preserved). */
  usageBreakdown: readonly ModelUsageEntry[];
  /** Current retry epoch for the node. */
  retryEpoch: number;
  /**
   * Direct-loop iteration number when recording from a loop node.
   * Null/undefined for standard nodes and loop-group body nodes.
   */
  iteration?: number | null;
  /** Structured-output reask attempt index (0 on the first attempt). */
  reaskAttempt: number;
  /** True when the pass ended as a terminal provider/error result. */
  terminalError: boolean;
  /** Optional provider/error subtype string; null when absent. */
  errorSubtype?: string | null;
}

/**
 * Workflow-engine port for durable usage accounting.
 *
 * Implementations must never throw into workflow execution, never mutate
 * lifecycle state, and never mask the original node result or exception.
 */
export interface IWorkflowUsageRecorder {
  recordWorkflowUsage(input: RecordWorkflowUsageInput): Promise<void>;
}
