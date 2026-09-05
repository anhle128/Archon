/**
 * Which provider and model a node will actually run on — and where each value came from.
 *
 * This is the resolution chain ALONE, extracted from `resolveNodeProviderAndModel`
 * (dag-executor.ts) so a dry run can report the same answer the executor will produce
 * (#1764). The executor's own function is `async` and takes a platform + conversation id
 * because it MESSAGES the user about capability mismatches; calling it from a dry run
 * would send chat messages for a run that never happens. Reimplementing the chain in
 * dry-run.ts instead would guarantee drift, which turns a legibility feature into an
 * actively misleading one — so both callers go through here.
 *
 * Pure: no I/O, no messaging, no registry mutation. Capability lookups are static
 * registry reads (same source `resolveNodeProviderAndModel` uses).
 */
import {
  getProviderCapabilities,
  isRegisteredProvider,
  getRegisteredProviders,
} from '@archon/providers';
import {
  isLiteralSpec,
  resolveModelSpec,
  isTierName,
  resolvePresetEffort,
} from './model-validation';
import type { ModelAliasPreset, ResolvedAiProfile, TierName } from './model-validation';
import {
  effortLevelSchema,
  thinkingConfigSchema,
  isCommandNode,
  isLoopGroupNode,
  isLoopNode,
  isPromptNode,
  type DagNode,
  type EffortLevel,
  type ThinkingConfig,
  type NodeExecutionMetadata,
  type LoopGroupNode,
} from './schemas';
import { readComposedMeta } from './compiled-command';

/**
 * Where a resolved value came from, most specific first.
 *
 * `node` covers a value the node itself declares — which, after composition collapses a
 * workflow's config onto its own nodes (#1764), is also how a value declared by that
 * node's OWN workflow file arrives. `authoredIn` names that file, so a reader can tell
 * the two apart without the engine keeping a second resolution layer to do it.
 */
export type ResolutionOrigin =
  | 'node'
  | 'model ref'
  | 'workflow'
  | 'assistant config'
  | 'default assistant'
  | 'unset';

export interface NodeModelResolution {
  provider: string;
  model: string | undefined;
  /** Reasoning depth before any provider capability gate is applied. */
  effort: string | undefined;
  /** Reasoning depth the AUTHOR declared (node or workflow), before any preset fills in. */
  declaredEffort: string | undefined;
  /** Tier keyword when the effective model ref was one — drives `node_started` attribution. */
  tier: TierName | undefined;
  /** Set when the node's `model:` resolved through a tier or `@alias` preset. */
  preset: ModelAliasPreset | undefined;
  providerOrigin: ResolutionOrigin;
  modelOrigin: ResolutionOrigin;
  effortOrigin: ResolutionOrigin;
  /** The workflow file this node was authored in, when it arrived through `include:`. */
  authoredIn: string | undefined;
  /**
   * The node names one provider while its `model:` ref resolves to another. The executor
   * warns the user and uses the resolved one; reported here so a dry run can too.
   */
  providerConflict?: { declared: string; resolved: string; modelRef: string };
}

/** The workflow-level fallbacks the executor threads alongside each node. */
export interface WorkflowModelScope {
  provider: string;
  model: string | undefined;
  preset: ModelAliasPreset | undefined;
  tier: TierName | undefined;
  /** Workflow-level `effort:`, still read as a per-node fallback. */
  effort: string | undefined;
  /** Where the scope's own provider came from, so a node inheriting it can say. */
  providerOrigin: ResolutionOrigin;
}

/**
 * Pure request-resolution result shared by `resolveNodeProviderAndModel`,
 * `node_started` serialization, ENV preview, and ENV snapshot metadata.
 *
 * No I/O and no messaging — capability warnings stay in the runtime layer.
 */
export interface NodeExecutionRequest {
  resolution: NodeModelResolution;
  /**
   * Prospective provider request metadata. Byte-identical shape to the fields
   * written on `node_started` for prompt/command/loop turns.
   */
  metadata: NodeExecutionMetadata;
  /**
   * Effort written into `nodeConfig.effort` after the capability gate and
   * preset fill. Undefined when nothing applies (or only the legacy assistant
   * fallback remains — that surfaces as `metadata.modelReasoningEffort`).
   */
  appliedEffort: string | undefined;
  /**
   * Thinking written into `nodeConfig.thinking` (node ?? workflow scope ??
   * preset). Still populated when the provider lacks `thinkingControl` so
   * `node_started` reports the requested setting while the runtime warns.
   */
  appliedThinking: ThinkingConfig | undefined;
  /** True when thinking was requested but the provider cannot honor it. */
  thinkingUnsupported: boolean;
  /**
   * True when a preset effort was considered but dropped (unsupported provider
   * or unknown value). Runtime logs; pure path only reports the decision.
   */
  presetEffortDropped: boolean;
}

/** Options for the pure execution-request resolver beyond the model chain. */
export interface ResolveNodeExecutionOptions {
  aiProfile?: ResolvedAiProfile;
  /** Workflow-level `thinking:` (or an outer group body's inherited value). */
  workflowThinking?: ThinkingConfig;
  /**
   * Install `assistants:` block — used only for the legacy
   * `modelReasoningEffort` fallback after portable effort is absent.
   */
  assistants?: Readonly<Record<string, Record<string, unknown> | undefined>>;
}

/**
 * Resolve one node's provider, model and reasoning depth.
 *
 * Mirrors dag-executor's chain exactly, including the two conditions that are easy to get
 * wrong: a workflow-level model applies only when the node resolves to the workflow's own
 * provider, and a workflow-level PRESET applies only when the node declares no `model:`
 * of its own. Both exist so a node that switches provider never inherits the other
 * provider's model string.
 */
export function resolveNodeModel(
  node: DagNode,
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile?: ResolvedAiProfile
): NodeModelResolution {
  let provider = node.provider ?? scope.provider;
  let providerOrigin: ResolutionOrigin = node.provider ? 'node' : scope.providerOrigin;
  let preset: ModelAliasPreset | undefined;
  let model: string | undefined;
  let modelOrigin: ResolutionOrigin = 'unset';
  let providerConflict: NodeModelResolution['providerConflict'];

  if (node.model) {
    modelOrigin = 'node';
    if (aiProfile) {
      const spec = resolveModelSpec(aiProfile, node.model);
      if (isLiteralSpec(spec)) {
        model = spec.literal;
      } else {
        preset = spec;
        provider = spec.provider;
        model = spec.model;
        modelOrigin = 'model ref';
        providerOrigin = 'model ref';
        if (node.provider && node.provider !== provider) {
          providerConflict = {
            declared: node.provider,
            resolved: provider,
            modelRef: node.model,
          };
        }
      }
    } else {
      model = node.model;
    }
  }

  if (model === undefined) {
    // Exact mirror of the executor's `model ??= provider === workflowProvider ?
    // workflowModel : providerAssistantConfig?.model`. Note the asymmetry: when the node
    // resolves to the workflow's own provider there is NO further fallback — the caller
    // has already folded the assistant default into `scope.model`.
    if (provider === scope.provider) {
      model = scope.model;
      modelOrigin = model !== undefined ? 'workflow' : 'unset';
    } else {
      model = assistantModels[provider];
      modelOrigin = model !== undefined ? 'assistant config' : 'unset';
    }
  }

  const effectivePreset =
    preset ?? (!node.model && provider === scope.provider ? scope.preset : undefined);

  // What the author declared, before a preset fills in and before the provider's
  // capability gate drops it — the executor threads exactly this value into both
  // `applyPresetOptions` and its capability check, so the two cannot disagree.
  const declaredEffort = node.effort ?? scope.effort;
  const effort = declaredEffort ?? effectivePreset?.effort;
  const effortOrigin: ResolutionOrigin =
    node.effort !== undefined
      ? 'node'
      : scope.effort !== undefined
        ? 'workflow'
        : effectivePreset?.effort !== undefined
          ? 'model ref'
          : 'unset';

  const tier =
    node.model && isTierName(node.model)
      ? node.model
      : !node.model && provider === scope.provider
        ? scope.tier
        : undefined;

  return {
    provider,
    model,
    effort,
    declaredEffort,
    tier,
    preset: effectivePreset,
    providerOrigin,
    modelOrigin,
    effortOrigin,
    authoredIn: readComposedMeta(node)?.origin,
    ...(providerConflict ? { providerConflict } : {}),
  };
}

/**
 * Pure request resolution: model chain + capability-aware effort/thinking + the
 * serializable `NodeExecutionMetadata` that `node_started` and ENV audit share.
 *
 * Throws on unknown provider or explicit portable effort against a provider
 * without `effortControl` — same fail-closed semantics as the runtime path.
 */
export function resolveNodeExecutionRequest(
  node: DagNode,
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  options: ResolveNodeExecutionOptions = {}
): NodeExecutionRequest {
  const resolution = resolveNodeModel(node, scope, assistantModels, options.aiProfile);
  const { provider, model, tier, preset, declaredEffort } = resolution;

  if (!isRegisteredProvider(provider)) {
    throw new Error(
      `Node '${node.id}': unknown provider '${provider}'. ` +
        `Registered: ${getRegisteredProviders()
          .map(p => p.id)
          .join(', ')}`
    );
  }

  const caps = getProviderCapabilities(provider);

  // Explicit portable effort (node/workflow/preset-included requested set) must
  // never disappear on a provider that cannot honor it. Matches
  // resolveNodeProviderAndModel: requested = declared ?? preset.
  const requestedEffort = declaredEffort ?? preset?.effort;
  if (requestedEffort !== undefined && !caps.effortControl) {
    throw new Error(
      `Node '${node.id}' sets effort but provider '${provider}' does not support effortControl.`
    );
  }

  // nodeConfig.effort starts as declared only when the provider can honor it.
  let appliedEffort: string | undefined = caps.effortControl ? declaredEffort : undefined;
  let presetEffortDropped = false;

  // Preset fill — same gates as applyPresetOptions in dag-executor.
  if (appliedEffort === undefined && declaredEffort === undefined && preset?.effort !== undefined) {
    const decision = resolvePresetEffort(provider, preset.effort);
    if (decision.ok) {
      appliedEffort = preset.effort;
    } else {
      presetEffortDropped = true;
    }
  }

  // Thinking: node ?? workflow scope ?? preset (when neither author surface set it).
  let appliedThinking: ThinkingConfig | undefined =
    node.thinking ?? options.workflowThinking ?? undefined;
  if (appliedThinking === undefined && preset?.thinking !== undefined) {
    appliedThinking = preset.thinking;
  }
  // Normalize through the schema so shorthand/`enabled` matches storage/API.
  if (appliedThinking !== undefined) {
    const parsed = thinkingConfigSchema.safeParse(appliedThinking);
    if (parsed.success) appliedThinking = parsed.data;
  }

  const thinkingUnsupported = appliedThinking !== undefined && !caps.thinkingControl;

  // Legacy assistant modelReasoningEffort only when no portable effort was applied.
  const assistantCfg = options.assistants?.[provider];
  const rawAssistantEffort =
    typeof assistantCfg?.modelReasoningEffort === 'string'
      ? assistantCfg.modelReasoningEffort
      : undefined;
  const modelReasoningEffort =
    appliedEffort === undefined &&
    typeof rawAssistantEffort === 'string' &&
    rawAssistantEffort.length > 0
      ? rawAssistantEffort
      : undefined;

  const effortParsed = effortLevelSchema.safeParse(appliedEffort);
  const metadataEffort: EffortLevel | undefined = effortParsed.success
    ? effortParsed.data
    : undefined;

  const metadata: NodeExecutionMetadata = {
    provider,
    ...(model ? { model } : {}),
    ...(tier ? { tier } : {}),
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    ...(metadataEffort !== undefined ? { effort: metadataEffort } : {}),
    ...(appliedThinking !== undefined ? { thinking: appliedThinking } : {}),
  };

  return {
    resolution,
    metadata,
    appliedEffort,
    appliedThinking,
    thinkingUnsupported,
    presetEffortDropped,
  };
}

/**
 * Derive the body-default scope for a `loop_group` from the group node itself.
 *
 * Provider/model/preset/tier come from the group (or its model ref). Outer
 * workflow effort is preserved — group effort/thinking remain unsupported.
 * Nested groups call this against their enclosing body scope so overrides
 * compose recursively.
 */
export function resolveGroupModelScope(
  groupNode: LoopGroupNode,
  outerScope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile?: ResolvedAiProfile
): WorkflowModelScope {
  // resolveNodeModel already treats provider/model on any DagNode; loop_group
  // carries those fields on the node base. Effort on the group is ignored by
  // taking outerScope.effort after the call rather than resolution.declaredEffort.
  const resolution = resolveNodeModel(groupNode, outerScope, assistantModels, aiProfile);
  return {
    provider: resolution.provider,
    model: resolution.model,
    preset: resolution.preset,
    tier: resolution.tier,
    effort: outerScope.effort,
    providerOrigin: resolution.providerOrigin,
  };
}

/**
 * Build the whole-workflow ENV `resolved` map: every direct provider turn under
 * the (possibly patched) definition, using persisted step-name keys
 * (`group.child` for nested bodies). Excludes group containers and deterministic
 * nodes. Declaration order / depth-first body order; callers may sort for UI.
 *
 * Throws on the first unresolvable provider-turn node (unknown provider or
 * unsupported explicit effort) so Preview and Start fail closed the same way.
 */
export function buildResolvedRequestMetadata(
  nodes: readonly DagNode[],
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  options: ResolveNodeExecutionOptions & { stepNamePrefix?: string } = {}
): Record<string, NodeExecutionMetadata> {
  const { stepNamePrefix = '', ...execOptions } = options;
  const resolved: Record<string, NodeExecutionMetadata> = {};

  for (const node of nodes) {
    const stepName = `${stepNamePrefix}${node.id}`;

    if (isPromptNode(node) || isCommandNode(node) || isLoopNode(node)) {
      const request = resolveNodeExecutionRequest(node, scope, assistantModels, execOptions);
      resolved[stepName] = request.metadata;
      continue;
    }

    if (isLoopGroupNode(node)) {
      // Group container never calls sendQuery — no row. Body provider turns do.
      const groupScope = resolveGroupModelScope(
        node,
        scope,
        assistantModels,
        execOptions.aiProfile
      );
      const nested = buildResolvedRequestMetadata(
        node.loop_group.nodes,
        groupScope,
        assistantModels,
        {
          ...execOptions,
          stepNamePrefix: `${stepName}.`,
        }
      );
      Object.assign(resolved, nested);
    }
  }

  return resolved;
}

/**
 * Derive the workflow-level fallbacks from a definition. `executor.ts` calls this and
 * layers its user-facing warning and the unknown-provider throw on top, exactly as
 * `resolveNodeProviderAndModel` wraps `resolveNodeModel` one level down — so a dry run
 * cannot report a different workflow-level scope than the run uses.
 *
 * After the #1764 collapse a discovered workflow carries no node-affecting fields, so
 * this normally reduces to `config.assistant` — but a programmatic caller can still hand
 * over an unexpanded definition, and the fallbacks have to behave the same for it.
 */
export function resolveWorkflowModelScope(
  workflow: { provider?: string; model?: string; effort?: string },
  defaultAssistant: string,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile?: ResolvedAiProfile
): WorkflowModelScope {
  let provider = workflow.provider ?? defaultAssistant;
  let model: string | undefined;
  let preset: ModelAliasPreset | undefined;
  if (workflow.model && aiProfile) {
    const spec = resolveModelSpec(aiProfile, workflow.model);
    if (isLiteralSpec(spec)) {
      model = spec.literal;
    } else {
      preset = spec;
      provider = spec.provider;
      model = spec.model;
    }
  } else if (workflow.model) {
    model = workflow.model;
  }
  model ??= assistantModels[provider];
  return {
    provider,
    model,
    preset,
    tier: workflow.model && isTierName(workflow.model) ? workflow.model : undefined,
    effort: workflow.effort,
    // The preset is checked FIRST because when one resolves, its provider is what won —
    // `provider` was reassigned from `spec.provider` above, overriding any `provider:` the
    // workflow declared (the executor warns about exactly that case). Reporting the
    // overridden value as the origin would name the loser. Matches `resolveNodeModel`,
    // which sets 'model ref' inside its own preset branch for the same reason.
    providerOrigin: preset ? 'model ref' : workflow.provider ? 'workflow' : 'default assistant',
  };
}

/**
 * Per-provider default model from an install's `assistants:` block, in the shape the
 * resolver takes. Kept here beside its only consumers so the `as string | undefined`
 * narrowing of an untyped config value happens once.
 */
export function assistantModelDefaults(config: {
  assistants: Record<string, Record<string, unknown> | undefined>;
}): Record<string, string | undefined> {
  const models: Record<string, string | undefined> = {};
  for (const [provider, assistant] of Object.entries(config.assistants)) {
    const model = assistant?.model;
    if (typeof model === 'string') models[provider] = model;
  }
  return models;
}
