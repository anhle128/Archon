/**
 * Pure Workflow ENV overlay apply path.
 *
 * Clones a discovered workflow with engine-private symbol metadata preserved,
 * applies a bounded per-node patch map to expanded top-level ids only, validates
 * patched nodes + graph structure, and never mutates the input definition or
 * the caller's patch document.
 */
import { isRegisteredProvider, getRegisteredProviders } from '@archon/providers';
import { cloneNodeWithEngineMetadata } from './include-expander';
import { validateDagStructure } from './loader';
import {
  dagNodeSchema,
  isBashNode,
  isCommandNode,
  isLoopGroupNode,
  isLoopNode,
  isPromptNode,
  thinkingConfigSchema,
  type DagNode,
  type EnvNodePatch,
  type EnvPatches,
  type WorkflowDefinition,
  ENV_OVERLAY_PATCH_FIELDS,
  type EnvOverlayPatchField,
} from './schemas';
// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

export const ENV_OVERLAY_ERROR_CODES = [
  'forbidden_field',
  'field_not_supported_for_node',
  'unknown_provider',
  'invalid_patched_node',
  'invalid_overlay_graph',
  'workflow_mismatch',
  'invalid_overlay_snapshot',
] as const;

export type EnvOverlayErrorCode = (typeof ENV_OVERLAY_ERROR_CODES)[number];

export class EnvOverlayError extends Error {
  readonly code: EnvOverlayErrorCode;
  readonly nodeId?: string;
  readonly field?: string;

  constructor(
    code: EnvOverlayErrorCode,
    message: string,
    options?: { nodeId?: string; field?: string; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'EnvOverlayError';
    this.code = code;
    if (options?.nodeId !== undefined) this.nodeId = options.nodeId;
    if (options?.field !== undefined) this.field = options.field;
  }
}

// ---------------------------------------------------------------------------
// Field matrix (executor-honored fields only)
// ---------------------------------------------------------------------------

const PROMPT_FIELDS = ['prompt', 'provider', 'model', 'effort', 'thinking'] as const;
const COMMAND_FIELDS = ['provider', 'model', 'effort', 'thinking'] as const;
const LOOP_FIELDS = ['provider', 'model', 'effort'] as const;
const LOOP_GROUP_FIELDS = ['provider', 'model'] as const;
const BASH_FIELDS = ['bash'] as const;

type NodeKindLabel = 'prompt' | 'command' | 'loop' | 'loop_group' | 'bash' | 'other';

function nodeKindLabel(node: DagNode): NodeKindLabel {
  if (isPromptNode(node)) return 'prompt';
  if (isCommandNode(node)) return 'command';
  if (isLoopNode(node)) return 'loop';
  if (isLoopGroupNode(node)) return 'loop_group';
  if (isBashNode(node)) return 'bash';
  return 'other';
}

function allowedFieldsFor(node: DagNode): ReadonlySet<EnvOverlayPatchField> {
  switch (nodeKindLabel(node)) {
    case 'prompt':
      return new Set(PROMPT_FIELDS);
    case 'command':
      return new Set(COMMAND_FIELDS);
    case 'loop':
      return new Set(LOOP_FIELDS);
    case 'loop_group':
      return new Set(LOOP_GROUP_FIELDS);
    case 'bash':
      return new Set(BASH_FIELDS);
    default:
      return new Set();
  }
}

const ALLOWED_FIELD_SET: ReadonlySet<string> = new Set(ENV_OVERLAY_PATCH_FIELDS);

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/** Deep-clone a workflow root and every node, preserving composed/compiled symbols. */
export function cloneWorkflowWithEngineMetadata(workflow: WorkflowDefinition): WorkflowDefinition {
  const { nodes, ...rest } = workflow;
  const rootClone = structuredClone(rest) as Omit<WorkflowDefinition, 'nodes'>;
  return {
    ...rootClone,
    nodes: nodes.map(cloneNodeWithEngineMetadata),
  };
}

export { cloneNodeWithEngineMetadata };

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyEnvOverlayResult {
  /** Patched clone; never aliases the input definition. */
  workflow: WorkflowDefinition;
  /**
   * Only the ids that existed and were patched on this call, with deep-copied
   * values (no mutable aliases into the supplied patch document).
   */
  appliedPatches: EnvPatches;
  /** Supplied target ids absent from the workflow, sorted. */
  missingNodeIds: string[];
}

function copyNodePatch(patch: EnvNodePatch): EnvNodePatch {
  const out: EnvNodePatch = {};
  if (patch.provider !== undefined) out.provider = patch.provider;
  if (patch.model !== undefined) out.model = patch.model;
  if (patch.effort !== undefined) out.effort = patch.effort;
  if (patch.thinking !== undefined) {
    // Normalize shorthand through the same schema the YAML loader uses so the
    // applied map and node agree with storage/API boundaries.
    const parsed = thinkingConfigSchema.safeParse(patch.thinking);
    out.thinking = parsed.success ? structuredClone(parsed.data) : structuredClone(patch.thinking);
  }
  if (patch.prompt !== undefined) out.prompt = patch.prompt;
  if (patch.bash !== undefined) out.bash = patch.bash;
  return out;
}

/**
 * `dagNodeSchema` treats whitespace-only prompt/bash as "no mode" and rejects them.
 * ENV contracts explicitly allow empty/whitespace bodies byte-for-byte (plan §2/engine
 * matrix) — accept ONLY those known empty-body issues so real schema failures still fail.
 */
function isEmptyBodyOnlyFailure(error: { issues: readonly { message: string }[] }): boolean {
  if (error.issues.length === 0) return false;
  return error.issues.every(
    issue =>
      issue.message === 'bash script cannot be empty' || issue.message === 'prompt cannot be empty'
  );
}

function assertPatchFieldsAllowed(node: DagNode, patch: EnvNodePatch): void {
  const allowed = allowedFieldsFor(node);
  const kind = nodeKindLabel(node);
  const entries = Object.entries(patch) as [string, unknown][];

  if (entries.length === 0) {
    throw new EnvOverlayError(
      'forbidden_field',
      `Node '${node.id}': env overlay per-node patch must include at least one field`,
      { nodeId: node.id }
    );
  }

  for (const [field] of entries) {
    if (!ALLOWED_FIELD_SET.has(field)) {
      throw new EnvOverlayError(
        'forbidden_field',
        `Node '${node.id}': unknown env overlay field '${field}'`,
        { nodeId: node.id, field }
      );
    }
    if (!allowed.has(field as EnvOverlayPatchField)) {
      throw new EnvOverlayError(
        'field_not_supported_for_node',
        kind === 'other'
          ? `Node '${node.id}': env overlay does not support patching this node kind`
          : `Node '${node.id}' (${kind}): field '${field}' is not supported`,
        { nodeId: node.id, field }
      );
    }
  }
}

/** Mutable execution-field surface shared by overlay-addressable node kinds. */
type OverlayMutableNode = DagNode & {
  provider?: string;
  model?: string;
  effort?: string;
  thinking?: EnvNodePatch['thinking'];
  prompt?: string;
  bash?: string;
};

function assignPatchToNode(node: DagNode, patch: EnvNodePatch): void {
  // Mutates the cloned node only. Values are copied so the clone does not alias
  // the caller's patch document (especially object-valued `thinking`).
  const target: OverlayMutableNode = node;
  if (patch.provider !== undefined) target.provider = patch.provider;
  if (patch.model !== undefined) target.model = patch.model;
  if (patch.effort !== undefined) target.effort = patch.effort;
  if (patch.thinking !== undefined) target.thinking = structuredClone(patch.thinking);
  if (patch.prompt !== undefined) {
    if (!isPromptNode(node)) {
      throw new EnvOverlayError(
        'field_not_supported_for_node',
        `Node '${node.id}': field 'prompt' is not supported`,
        { nodeId: node.id, field: 'prompt' }
      );
    }
    node.prompt = patch.prompt;
  }
  if (patch.bash !== undefined) {
    if (!isBashNode(node)) {
      throw new EnvOverlayError(
        'field_not_supported_for_node',
        `Node '${node.id}': field 'bash' is not supported`,
        { nodeId: node.id, field: 'bash' }
      );
    }
    node.bash = patch.bash;
  }
}

/**
 * Apply an ENV patch map to a cloned workflow definition.
 *
 * - Matches only expanded top-level node ids (one id map; no per-patch full scan).
 * - Missing ids are skipped deterministically (sorted in `missingNodeIds`).
 * - Incompatible field/node combinations and unknown providers fail closed.
 * - Patched nodes are schema-validated; the graph is structure-validated after apply.
 * - Never mutates `workflow` or `patches`; never echoes prompt/bash bodies in errors.
 */
export function applyEnvOverlay(
  workflow: WorkflowDefinition,
  patches: EnvPatches
): ApplyEnvOverlayResult {
  const clone = cloneWorkflowWithEngineMetadata(workflow);
  const nodesById = new Map<string, DagNode>();
  for (const node of clone.nodes) {
    nodesById.set(node.id, node);
  }

  const appliedPatches: EnvPatches = {};
  const missingNodeIds: string[] = [];

  // Stable iteration: Object.keys order matches insertion for ordinary patch maps.
  for (const nodeId of Object.keys(patches)) {
    const rawPatch = patches[nodeId];
    if (rawPatch === undefined) continue;

    const node = nodesById.get(nodeId);
    if (node === undefined) {
      missingNodeIds.push(nodeId);
      continue;
    }

    // Defensive copy before validation/assignment so caller mutation mid-apply
    // cannot change what we validate or store in appliedPatches.
    const patch = copyNodePatch(rawPatch);
    assertPatchFieldsAllowed(node, patch);

    if (patch.provider !== undefined && !isRegisteredProvider(patch.provider)) {
      throw new EnvOverlayError(
        'unknown_provider',
        `Node '${nodeId}': unknown provider '${patch.provider}'. Registered: ${getRegisteredProviders()
          .map(p => p.id)
          .join(', ')}`,
        { nodeId, field: 'provider' }
      );
    }

    assignPatchToNode(node, patch);

    const parsed = dagNodeSchema.safeParse(node);
    if (!parsed.success && !isEmptyBodyOnlyFailure(parsed.error)) {
      // Do not include issue paths that might carry prompt/bash body context —
      // surface a stable code + node id only.
      throw new EnvOverlayError(
        'invalid_patched_node',
        `Node '${nodeId}': patched node failed schema validation`,
        { nodeId }
      );
    }

    appliedPatches[nodeId] = patch;
  }

  missingNodeIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const structureError = validateDagStructure(clone.nodes);
  if (structureError !== null) {
    throw new EnvOverlayError('invalid_overlay_graph', structureError);
  }

  return {
    workflow: clone,
    appliedPatches,
    missingNodeIds,
  };
}
