import type { RunStatus } from '../lib/run-status';

export type RunOrigin = 'web' | 'cli' | 'slack' | 'telegram' | 'discord' | 'github' | 'unknown';

export interface Run {
  id: string;
  projectId: string | null;
  projectName: string | null;
  /** Total USD cost from the agent SDK. Populated for completed Claude runs;
   *  Pi/Codex runs may not report cost. Null when the run hasn't recorded any. */
  costUsd: number | null;
  /** DB id of the conversation this run belongs to. */
  conversationId: string | null;
  /**
   * Platform-level conversation id (e.g. `cli-1776237248436-q61o4h`). This is
   * the id the `/api/conversations/:id/messages` route accepts in its URL
   * path — the server looks conversations up by platform id, not DB id, on
   * that endpoint. Use this when fetching the run's messages.
   */
  conversationPlatformId: string | null;
  /**
   * Platform id of the WORKER conversation for chat-dispatched (web) runs —
   * where a chat-dispatched run's messages actually live. See
   * runMessageConversationId() for how CLI vs. web runs are picked (#2048).
   */
  workerPlatformId: string | null;
  workflow: string;
  origin: RunOrigin;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** workflow_runs.working_path — used to join against worktrees. */
  workingPath: string | null;
  userMessage: string;
  /** Derived from metadata/events at runtime; initially undefined. */
  currentNode?: string | null;
  lastTool?: string | null;
  /**
   * Pending human gate. Null once the gate is resolved (see gateResolved).
   * `completionSignaled` is true when an interactive-loop gate paused on an
   * iteration that emitted its completion signal (#2074) — a bare approve
   * finalizes the node (no re-run); a comment runs another iteration.
   */
  approval?: { nodeId: string; message: string; completionSignaled: boolean } | null;
  /**
   * Set when a paused run's gate was already approved/rejected and the run is
   * only awaiting auto-resume (server: metadata.approval.resolved). The
   * approval surfaces hide (approval is null) and the card shows a
   * "resuming" hint instead of stale approve/reject buttons.
   */
  gateResolved?: 'approved' | 'rejected' | null;
  /**
   * Run-tree parent (#2121 Phase 2). Set when this run is a `workflow:` sub-run
   * spawned by a parent run's node; null for top-level runs. Drives the "child of"
   * affordance in the console so a sub-run isn't mistaken for an orphan top-level run.
   */
  parentRunId?: string | null;
  /**
   * Defensively parsed `metadata.envOverlay` (pending or complete). Null when
   * absent or malformed — never throws; malformed keeps the rest of the run
   * usable. Prompt/bash patch bodies are intentionally not exposed.
   */
  envOverlay: RunEnvOverlay | null;
}

/** One provider-turn row from a complete overlay snapshot's `resolved` map. */
export interface RunEnvResolvedRow {
  nodeId: string;
  provider: string;
  model?: string;
  tier?: 'small' | 'medium' | 'large';
  modelReasoningEffort?: string;
  effort?: string;
  /** Thinking config object when present; shape is provider-specific. */
  thinking?: { type: string; budgetTokens?: number };
}

/**
 * Run-owned ENV overlay metadata. Complete snapshots include `resolved` rows
 * and `latestMissingNodeIds`; pending inserts omit them until the executor
 * writes the complete form.
 */
export interface RunEnvOverlay {
  envId: string;
  envName: string;
  workflowName: string;
  /** True when `resolved` was present on the stored snapshot. */
  complete: boolean;
  skippedNodeIds: string[];
  latestMissingNodeIds: string[];
  /** Null while pending (no resolved map yet) or when the map was empty/unusable. */
  resolved: RunEnvResolvedRow[] | null;
}

// Server shapes we read from. These track the real server schema loosely —
// fields we don't use are omitted. The normalizer defends against missing
// optional fields.

interface RawWorkflowRun {
  id: string;
  workflow_name: string;
  codebase_id: string | null;
  conversation_id?: string | null;
  /** Platform-level conversation id — exposed on the getRun response only. */
  conversation_platform_id?: string | null;
  /** Worker conversation platform id — getRun response only, web runs only. */
  worker_platform_id?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
  working_path?: string | null;
  user_message?: string;
  metadata?: Record<string, unknown>;
  /** Only present on dashboard runs — enriched by server-side join. */
  codebase_name?: string | null;
  platform_type?: string | null;
  current_step_name?: string | null;
  /** Run-tree parent id (#2121 Phase 2); null/absent for top-level runs. */
  parent_run_id?: string | null;
}

const KNOWN_STATUSES: readonly RunStatus[] = [
  'running',
  'paused',
  'failed',
  'completed',
  'cancelled',
];

function normalizeStatus(s: string): RunStatus {
  // Treat 'pending' as 'running' for UI purposes — it's transient.
  if (s === 'pending') return 'running';
  return (KNOWN_STATUSES as readonly string[]).includes(s) ? (s as RunStatus) : 'running';
}

export function normalizeOrigin(s: string | null | undefined): RunOrigin {
  if (s === null || s === undefined) return 'unknown';
  const lower = s.toLowerCase();
  switch (lower) {
    case 'web':
    case 'cli':
    case 'slack':
    case 'telegram':
    case 'discord':
    case 'github':
      return lower;
    default:
      return 'unknown';
  }
}

function readCost(meta: Record<string, unknown> | undefined): number | null {
  if (meta === undefined) return null;
  const raw = meta.total_cost_usd;
  // Finite non-negative only — authoritative reported zero survives; negatives/NaN
  // never become a legacy total.
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Require a real string[] (fail closed on non-array); keep only non-empty strings. */
function readRequiredStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    if (item.length > 0) out.push(item);
  }
  return out;
}

const PENDING_ENV_OVERLAY_KEYS: Record<string, true> = {
  envId: true,
  envName: true,
  workflowName: true,
  patches: true,
  skippedNodeIds: true,
};

const COMPLETE_ENV_OVERLAY_KEYS: Record<string, true> = {
  ...PENDING_ENV_OVERLAY_KEYS,
  latestMissingNodeIds: true,
  resolved: true,
};

const RESOLVED_ROW_KEYS: Record<string, true> = {
  provider: true,
  model: true,
  tier: true,
  modelReasoningEffort: true,
  effort: true,
  thinking: true,
};

const THINKING_TYPE_ONLY_KEYS: Record<string, true> = { type: true };
const THINKING_ENABLED_KEYS: Record<string, true> = { type: true, budgetTokens: true };

function hasOnlyAllowedKeys(rec: Record<string, unknown>, allowed: Record<string, true>): boolean {
  for (const key of Object.keys(rec)) {
    if (!allowed[key]) return false;
  }
  return true;
}

/**
 * Present optional non-empty string field.
 * Absent → undefined; present-and-valid → string; present-but-invalid → null (fail closed).
 */
function readPresentOptionalString(
  rec: Record<string, unknown>,
  key: string
): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return undefined;
  const v = rec[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

/**
 * Thinking must match supported adaptive/enabled/disabled shapes when present.
 * Returns null for malformed or unsupported values (fail closed — never drop silently).
 */
function readThinking(v: unknown): RunEnvResolvedRow['thinking'] | null {
  if (typeof v === 'string') {
    if (v === 'adaptive' || v === 'enabled' || v === 'disabled') {
      return { type: v };
    }
    return null;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const type = rec.type;
  if (type === 'adaptive' || type === 'disabled') {
    if (!hasOnlyAllowedKeys(rec, THINKING_TYPE_ONLY_KEYS)) return null;
    return { type };
  }
  if (type === 'enabled') {
    if (!hasOnlyAllowedKeys(rec, THINKING_ENABLED_KEYS)) return null;
    const thinking: { type: string; budgetTokens?: number } = { type: 'enabled' };
    if (Object.prototype.hasOwnProperty.call(rec, 'budgetTokens')) {
      const budget = rec.budgetTokens;
      // Mirror thinkingConfigSchema: optional positive integer.
      if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
        return null;
      }
      thinking.budgetTokens = budget;
    }
    return thinking;
  }
  return null;
}

function readResolvedRow(nodeId: string, value: unknown): RunEnvResolvedRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(rec, RESOLVED_ROW_KEYS)) return null;
  if (!isNonEmptyString(rec.provider)) return null;

  const row: RunEnvResolvedRow = { nodeId, provider: rec.provider };

  const model = readPresentOptionalString(rec, 'model');
  if (model === null) return null;
  if (model !== undefined) row.model = model;

  if (Object.prototype.hasOwnProperty.call(rec, 'tier')) {
    const tier = rec.tier;
    if (tier !== 'small' && tier !== 'medium' && tier !== 'large') return null;
    row.tier = tier;
  }

  const modelReasoningEffort = readPresentOptionalString(rec, 'modelReasoningEffort');
  if (modelReasoningEffort === null) return null;
  if (modelReasoningEffort !== undefined) row.modelReasoningEffort = modelReasoningEffort;

  const effort = readPresentOptionalString(rec, 'effort');
  if (effort === null) return null;
  if (effort !== undefined) row.effort = effort;

  if (Object.prototype.hasOwnProperty.call(rec, 'thinking')) {
    const thinking = readThinking(rec.thinking);
    if (thinking === null) return null;
    row.thinking = thinking;
  }

  return row;
}

/**
 * Parse `metadata.envOverlay` without importing `@archon/workflows`.
 * Accepts only strict pending (`AppliedEnvOverlay`) or complete
 * (`EnvOverlaySnapshot`) shapes — never legacy/malformed hybrids.
 * Malformed → null (omit overlay UI; keep the rest of the run usable).
 * Never surfaces prompt/bash patch bodies.
 */
export function parseRunEnvOverlay(
  meta: Record<string, unknown> | undefined
): RunEnvOverlay | null {
  if (meta === undefined) return null;
  const raw = meta.envOverlay;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(rec.envId) ||
    !isNonEmptyString(rec.envName) ||
    !isNonEmptyString(rec.workflowName)
  ) {
    return null;
  }

  // patches are required on both lifecycle forms; never exposed on RunEnvOverlay.
  if (
    rec.patches === null ||
    rec.patches === undefined ||
    typeof rec.patches !== 'object' ||
    Array.isArray(rec.patches)
  ) {
    return null;
  }

  const skippedNodeIds = readRequiredStringArray(rec.skippedNodeIds);
  if (skippedNodeIds === null) return null;

  const hasResolvedKey = Object.prototype.hasOwnProperty.call(rec, 'resolved');
  const hasLatestMissingKey = Object.prototype.hasOwnProperty.call(rec, 'latestMissingNodeIds');

  // Pending applied form: no resolved key, no latestMissingNodeIds key.
  if (!hasResolvedKey && !hasLatestMissingKey) {
    if (!hasOnlyAllowedKeys(rec, PENDING_ENV_OVERLAY_KEYS)) return null;
    return {
      envId: rec.envId,
      envName: rec.envName,
      workflowName: rec.workflowName,
      complete: false,
      skippedNodeIds,
      latestMissingNodeIds: [],
      resolved: null,
    };
  }

  // Complete snapshot requires both keys; hybrids (one without the other) fail closed.
  if (!hasResolvedKey || !hasLatestMissingKey) return null;
  if (!hasOnlyAllowedKeys(rec, COMPLETE_ENV_OVERLAY_KEYS)) return null;

  if (rec.resolved === null || typeof rec.resolved !== 'object' || Array.isArray(rec.resolved)) {
    return null;
  }

  const latestMissingNodeIds = readRequiredStringArray(rec.latestMissingNodeIds);
  if (latestMissingNodeIds === null) return null;

  const rows: RunEnvResolvedRow[] = [];
  for (const [nodeId, value] of Object.entries(rec.resolved as Record<string, unknown>)) {
    if (nodeId.length === 0) return null;
    const row = readResolvedRow(nodeId, value);
    // Any invalid resolved row fails the whole overlay — never manufacture complete:true
    // with a silently dropped subset (false "No provider-turn request rows" confidence).
    if (row === null) return null;
    rows.push(row);
  }
  rows.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  return {
    envId: rec.envId,
    envName: rec.envName,
    workflowName: rec.workflowName,
    complete: true,
    skippedNodeIds,
    latestMissingNodeIds,
    resolved: rows,
  };
}

/**
 * The platform conversation id that holds this run's messages — the id the
 * `/api/conversations/:id/messages` route accepts. CLI runs expose it as
 * `conversationPlatformId`; chat-dispatched (web) runs only expose the worker
 * conversation as `workerPlatformId`, which is where their agent output is
 * persisted (#2048). Null for list-sourced rows (neither field is present)
 * and for a run that hasn't loaded yet, so message fetching stays off there.
 */
export function runMessageConversationId(run: Run | undefined): string | null {
  if (run === undefined) return null;
  return run.conversationPlatformId ?? run.workerPlatformId;
}

export function toRun(raw: RawWorkflowRun): Run {
  const approval = raw.metadata?.approval;
  const isApprovalShape =
    approval !== null &&
    typeof approval === 'object' &&
    approval !== undefined &&
    'nodeId' in approval &&
    typeof (approval as { nodeId: unknown }).nodeId === 'string';
  // A resolved gate (approved/rejected, run paused only while awaiting
  // auto-resume — see ApprovalContext.resolved on the server) is NOT a
  // pending approval: surface it via gateResolved instead so approve/reject
  // buttons never render for an already-resolved gate.
  const resolvedRaw = isApprovalShape ? (approval as { resolved?: unknown }).resolved : undefined;
  const gateResolved =
    resolvedRaw === 'approved' || resolvedRaw === 'rejected' ? resolvedRaw : null;
  const parsedApproval =
    isApprovalShape && gateResolved === null
      ? {
          nodeId: (approval as { nodeId: string }).nodeId,
          message:
            'message' in approval && typeof (approval as { message: unknown }).message === 'string'
              ? (approval as { message: string }).message
              : '',
          completionSignaled:
            (approval as { completionSignaled?: unknown }).completionSignaled === true,
        }
      : null;

  return {
    id: raw.id,
    projectId: raw.codebase_id,
    projectName: raw.codebase_name ?? null,
    costUsd: readCost(raw.metadata),
    conversationId: raw.conversation_id ?? null,
    conversationPlatformId: raw.conversation_platform_id ?? null,
    workerPlatformId: raw.worker_platform_id ?? null,
    workflow: raw.workflow_name,
    origin: normalizeOrigin(raw.platform_type),
    status: normalizeStatus(raw.status),
    startedAt: raw.started_at,
    finishedAt: raw.completed_at ?? null,
    workingPath: raw.working_path ?? null,
    userMessage: raw.user_message ?? '',
    currentNode: raw.current_step_name ?? null,
    lastTool: null,
    approval: parsedApproval,
    gateResolved,
    parentRunId: raw.parent_run_id ?? null,
    envOverlay: parseRunEnvOverlay(raw.metadata),
  };
}
