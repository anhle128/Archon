# Workflow ENV Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator start the same workflow with a named per-node allowlisted overlay (`provider`, `model`, `effort`, `thinking`, `prompt`, `bash`) without editing YAML, and show audit `resolved` metadata on the run.

**Architecture:** Named ENV rows (`remote_agent_workflow_envs`) hold a JSON patch keyed by top-level node id.
HTTP Start freezes the row after id and `workflow_name` match (HTTP 400 only for identity).
The orchestrator clones the loaded DAG, applies the freeze before isolation, skips missing node ids, and fails type/graph errors on the existing SSE path.
The run snapshot stores filtered applied patches plus audit `resolved`.
Execution uses the patched clone plus the live AI profile and never reads `resolved` for `sendQuery`.
Resume re-applies the filtered snapshot and recomputes `resolved`.

**Tech Stack:** Bun, strict TypeScript, Zod from `@hono/zod-openapi`, SQLite, PostgreSQL, OpenAPI Hono, React console, Bun Test.

**Spec:** `docs/superpowers/specs/2026-09-04-workflow-env-overlay-design.md` (PR #69, commit `7a60023ca734d23f2935d90253e2576701c1b4d0`).

**Architecture doc:** `plans/architectures/workflow-env-overlay-architecture.md` (same PR).

**Issue:** https://github.com/anhle128/Archon/issues/70

If those two markdown files are missing from this worktree, read them from `dev` or that commit before writing code.

## Global Constraints

- Implement the approved spec and architecture.
- Do not add CLI `--env`, chat env flags, pricing comparison, or `loop_group` body overlays.
- Do not overlay graph fields, `command` bodies, `loop.prompt`, `script` source, `include`, or `workflow`.
- Do not mutate a cached or discovered `WorkflowDefinition` in place.
- Do not create the run row before isolation.
- Do not drive `sendQuery` from `resolved`.
- Do not log `prompt` or `bash` bodies.
- HTTP 400 on Start only for `env_not_found` and `env_workflow_mismatch`.
- Missing node ids are skipped, never hard-failed.
- Type and graph errors fail before isolation on the existing SSE / `platform.sendMessage` path.
- PATCH of ENV `patches` replaces the whole object.
- Child `workflow:` sub-runs do not inherit the parent overlay.
- Schema changes are additive-only in both dialects.
- Indexes and `COMMENT ON COLUMN` go only in the trailing "Indexes and column comments" section of `migrations/000_combined.sql`.
- Raise `MIN_NON_AUTH_COLUMNS` in `packages/core/src/db/adapters/sqlite.test.ts` from `155` to `162`.
- Renumber the combined-schema inventory so `remote_agent_workflow_envs` is application table 21.
- Derive types with `z.infer`.
- Import `z` from `@hono/zod-openapi` in core, server, and workflow schema files.
- Use `z.record(z.string(), valueSchema)` for record schemas.
- Do not add `any`.
- `@archon/web` must not import `@archon/workflows`.
- New API routes use `registerOpenApiRoute(createRoute({...}), handler)`.
- `POST /api/workflows/:name/run` keeps the multipart-or-JSON exception (no `request.body` on the OpenAPI route).
- Never run `bun test` from the repository root.
- Append new mock-heavy tests as their own `bun test <file>` segment in the package `test` script.
- Keep every full Markdown sentence on its own physical line in this plan file only.
- Never add an agent name as a commit co-author.

## Open Questions

Product decisions in the spec are closed.
These three implementation details are not named as routes or status codes in the spec.
Each has a safe provisional default that the implementation must follow unless a later review overrides it.

1. **Preview GET identity.**
The spec says conversation/project cwd and 400 if the conversation has no project.
`DraftRunCard` has `projectCwd` and does not create a conversation until Start.
**Default:** `GET /api/workflows/{name}/preview?cwd=<projectPath>&envId=<optional>`.
Reuse `validateCwd`.
HTTP 400 if `cwd` is missing or is not a registered codebase path.
HTTP 400 `env_not_found` / `env_workflow_mismatch` when `envId` is present and identity fails.

2. **Duplicate ENV name.**
The spec requires `UNIQUE(workflow_name, name)` and does not name the HTTP status.
**Default:** POST or PATCH that collides returns HTTP 409 with `error: "env_name_conflict"`.

3. **When `resolved` is written on the background path.**
Console non-interactive Start pre-creates the run row in `dispatchBackgroundWorkflow` after isolation (`packages/core/src/orchestrator/orchestrator.ts`).
`executeWorkflow` then receives `preCreatedRun` and skips INSERT.
**Default:** orchestrator apply produces filtered patches before isolation.
`executeWorkflow` loads the live profile and writes the complete `metadata.envOverlay` (including `resolved`) with `json_set` / `jsonb_set` before the first `sendQuery`.
Resume uses the same write to replace `resolved` without merging stale node keys.

## File Map

- Create `packages/workflows/src/schemas/env-overlay.ts` for patch, freeze, snapshot, and metadata Zod schemas.
- Create `packages/workflows/src/schemas/env-overlay.test.ts` for schema parse/reject cases.
- Create `packages/workflows/src/env-overlay.ts` for clone, apply, skip, type/graph errors, and resolved-table builder.
- Create `packages/workflows/src/env-overlay.test.ts` for apply, skip, type mismatch, dangling refs, include ids, loop_group skip, and cache isolation.
- Create `packages/core/src/schemas/workflow-env.ts` for the ENV row schema.
- Create `packages/core/src/schemas/workflow-env.test.ts` for name grammar and row parse.
- Create `packages/core/src/db/workflow-envs.ts` for list/get/create/update/delete.
- Create `packages/core/src/db/workflow-envs.test.ts` for CRUD, unique conflict, and JSON round-trip.
- Create `packages/server/src/routes/schemas/workflow-env.schemas.ts` for OpenAPI request/response schemas.
- Create `packages/server/src/routes/api.workflow-envs.test.ts` for CRUD HTTP and preview GET.
- Create `packages/web/src/experiments/console/skills/workflowEnvs.ts` for ENV HTTP helpers.
- Create `packages/web/src/experiments/console/skills/workflowEnvs.test.ts` for list/create/patch/delete request shapes.
- Create `packages/web/src/experiments/console/components/WorkflowEnvPicker.tsx` for the Start select.
- Create `packages/web/src/experiments/console/components/WorkflowEnvPreviewTable.tsx` for the hint table.
- Create `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx` for allowlisted CRUD.
- Create `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.tsx` for run-detail audit.
- Create `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx` for chip/table rendering.
- Modify `packages/workflows/src/node-model-resolution.ts` to add `resolveNodeExecutionMetadata`.
- Modify `packages/workflows/src/dag-executor.ts` so `nodeConfig.thinking` and `node_started` thinking come from that helper.
- Modify `packages/workflows/src/schemas/index.ts` to export overlay schemas.
- Modify `packages/workflows/package.json` to export `./env-overlay` and isolate the new tests.
- Modify `packages/core/src/types/index.ts` to add `envOverlay` on `HandleMessageContext`.
- Modify `packages/core/src/schemas/index.ts` to export the ENV row schema.
- Modify `packages/core/src/orchestrator/orchestrator-agent.ts` to clone-apply before isolation.
- Modify `packages/core/src/orchestrator/orchestrator.ts` to pass the applied overlay into background pre-create / execute.
- Modify `packages/workflows/src/executor.ts` to stamp and recompute `metadata.envOverlay`.
- Modify `packages/core/src/db/workflows.ts` to add `setWorkflowRunEnvOverlay`.
- Modify `migrations/000_combined.sql` for the new table, trailing index, comments, and inventory.
- Modify `packages/core/src/db/adapters/sqlite.ts` `createSchema()` for the SQLite twin.
- Modify `packages/core/src/db/adapters/sqlite.test.ts` `MIN_NON_AUTH_COLUMNS`.
- Generate `packages/core/src/db/bundled-schema.generated.ts` with `bun run generate:bundled-schema`.
- Modify `packages/server/src/routes/api.ts` for CRUD, preview, and `envId` on Start.
- Modify `packages/server/src/routes/schemas/workflow.schemas.ts` `runWorkflowBodySchema` (documentation only; still not wired as `request.body`).
- Modify `packages/server/src/routes/api.workflow-runs.test.ts` for `envId` identity 400 and context freeze.
- Modify `packages/web/src/experiments/console/skills/startRun.ts` and `startRun.test.ts` for `envId`.
- Modify `packages/web/src/experiments/console/components/DraftRunCard.tsx` for picker, preview, and Manage.
- Modify `packages/web/src/experiments/console/primitives/run.ts` to surface snapshot `envName` / `resolved`.
- Modify `packages/web/src/experiments/console/components/RunDetailHeader.tsx` for the `env: <name>` chip.
- Modify `packages/web/src/experiments/console/routes/RunDetailPage.tsx` to render the resolved table.
- Generate `packages/web/src/lib/api.generated.d.ts` with `bun --filter @archon/web generate:types` while the server is running.
- Modify `packages/docs-web/src/content/docs/reference/api.md` and `packages/docs-web/src/content/docs/guides/authoring-workflows.md`.
- Modify `AGENTS.md` application-table inventory (21st table).

---

### Task 1: Overlay Schemas

**Files:**

- Create: `packages/workflows/src/schemas/env-overlay.ts`
- Create: `packages/workflows/src/schemas/env-overlay.test.ts`
- Modify: `packages/workflows/src/schemas/index.ts`
- Modify: `packages/workflows/package.json`

**Interfaces:**

- Consumes: `thinkingConfigSchema`, `effortLevelSchema` from `./dag-node`.
- Produces: `ENV_OVERLAY_PATCH_KEYS`, `nodePatchSchema`, `envPatchesSchema`, `nodeExecutionMetadataSchema`, `envOverlayCandidateSchema`, `appliedEnvOverlaySchema`, `envOverlaySnapshotSchema`, and inferred types `NodePatch`, `EnvPatches`, `NodeExecutionMetadata`, `EnvOverlayCandidate`, `AppliedEnvOverlay`, `EnvOverlaySnapshot`.

- [ ] **Step 1: Write the failing schema tests**

Create `packages/workflows/src/schemas/env-overlay.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  envPatchesSchema,
  nodePatchSchema,
  envOverlaySnapshotSchema,
} from './env-overlay';

describe('nodePatchSchema', () => {
  test('accepts the allowlisted keys and thinking shorthand', () => {
    expect(
      nodePatchSchema.parse({
        provider: 'claude',
        model: 'large',
        effort: 'high',
        thinking: 'enabled',
        prompt: 'do the thing',
      })
    ).toMatchObject({
      provider: 'claude',
      model: 'large',
      thinking: { type: 'enabled' },
    });
  });

  test('rejects unknown keys and empty provider', () => {
    expect(() => nodePatchSchema.parse({ depends_on: ['a'] })).toThrow();
    expect(() => nodePatchSchema.parse({ provider: '' })).toThrow();
    expect(() => nodePatchSchema.parse({ command: 'x' })).toThrow();
  });
});

describe('envPatchesSchema', () => {
  test('accepts an empty map', () => {
    expect(envPatchesSchema.parse({})).toEqual({});
  });
});

describe('envOverlaySnapshotSchema', () => {
  test('requires filtered patches plus resolved', () => {
    const parsed = envOverlaySnapshotSchema.parse({
      envId: 'env-1',
      envName: 'cheap',
      workflowName: 'demo',
      patches: { plan: { model: 'small' } },
      skippedNodeIds: ['gone'],
      resolved: { plan: { provider: 'claude', model: 'haiku' } },
    });
    expect(parsed.skippedNodeIds).toEqual(['gone']);
    expect(parsed.resolved.plan?.provider).toBe('claude');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing module**

Run from `packages/workflows`:

```bash
bun test src/schemas/env-overlay.test.ts
```

Expected: FAIL with `Cannot find module './env-overlay'`.

- [ ] **Step 3: Create the schemas and export them**

Create `packages/workflows/src/schemas/env-overlay.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { effortLevelSchema, thinkingConfigSchema } from './dag-node';

export const ENV_OVERLAY_PATCH_KEYS = [
  'provider',
  'model',
  'effort',
  'thinking',
  'prompt',
  'bash',
] as const;

export const nodePatchSchema = z
  .object({
    provider: z.string().trim().min(1).optional(),
    model: z.string().min(1).optional(),
    effort: effortLevelSchema.optional(),
    thinking: thinkingConfigSchema.optional(),
    prompt: z.string().optional(),
    bash: z.string().optional(),
  })
  .strict();

export type NodePatch = z.infer<typeof nodePatchSchema>;

export const envPatchesSchema = z.record(z.string(), nodePatchSchema);

export type EnvPatches = z.infer<typeof envPatchesSchema>;

export const nodeExecutionMetadataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  thinking: thinkingConfigSchema.optional(),
});

export type NodeExecutionMetadata = z.infer<typeof nodeExecutionMetadataSchema>;

export const envOverlayCandidateSchema = z.object({
  envId: z.string().min(1),
  envName: z.string().min(1),
  workflowName: z.string().min(1),
  patches: envPatchesSchema,
});

export type EnvOverlayCandidate = z.infer<typeof envOverlayCandidateSchema>;

export const appliedEnvOverlaySchema = envOverlayCandidateSchema.extend({
  skippedNodeIds: z.array(z.string()),
});

export type AppliedEnvOverlay = z.infer<typeof appliedEnvOverlaySchema>;

export const envOverlaySnapshotSchema = appliedEnvOverlaySchema.extend({
  resolved: z.record(z.string(), nodeExecutionMetadataSchema),
});

export type EnvOverlaySnapshot = z.infer<typeof envOverlaySnapshotSchema>;
```

Re-export the schemas and types from `packages/workflows/src/schemas/index.ts` next to the other schema exports.

Append `&& bun test src/schemas/env-overlay.test.ts` to the `test` script in `packages/workflows/package.json`.

- [ ] **Step 4: Run the schema tests**

Run from `packages/workflows`:

```bash
bun test src/schemas/env-overlay.test.ts
bun x tsc --noEmit
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/schemas/env-overlay.ts packages/workflows/src/schemas/env-overlay.test.ts packages/workflows/src/schemas/index.ts packages/workflows/package.json
git commit -m "feat(workflows): add workflow ENV overlay schemas"
```

---

### Task 2: `resolveNodeExecutionMetadata`

**Files:**

- Modify: `packages/workflows/src/node-model-resolution.ts`
- Create: `packages/workflows/src/node-model-resolution.test.ts`
- Modify: `packages/workflows/src/dag-executor.ts` (`applyPresetOptions` thinking assignment and `nodeConfig.thinking` seed)
- Modify: `packages/workflows/package.json`

**Interfaces:**

- Consumes: `resolveNodeModel`, `NodeModelResolution`, `ThinkingConfig`, `DagNode`, `WorkflowModelScope`, `ResolvedAiProfile`.
- Produces:

```ts
export function resolveNodeExecutionMetadata(
  node: DagNode,
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile: ResolvedAiProfile | undefined,
  workflowThinking: ThinkingConfig | undefined
): NodeExecutionMetadata
```

Thinking precedence must match `applyPresetOptions` in `packages/workflows/src/dag-executor.ts`: node → workflow → preset.

- [ ] **Step 1: Write the failing helper tests**

Create `packages/workflows/src/node-model-resolution.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveNodeExecutionMetadata } from './node-model-resolution';
import type { DagNode } from './schemas/dag-node';

function promptNode(partial: Partial<DagNode> & { id: string }): DagNode {
  return { id: partial.id, prompt: 'work', ...partial } as DagNode;
}

describe('resolveNodeExecutionMetadata', () => {
  const scope = {
    provider: 'claude',
    model: undefined,
    preset: { provider: 'claude', model: 'opus', thinking: { type: 'adaptive' as const } },
    tier: 'large' as const,
    effort: undefined,
    providerOrigin: 'default assistant' as const,
  };

  test('uses node thinking over workflow and preset', () => {
    const meta = resolveNodeExecutionMetadata(
      promptNode({ id: 'n', thinking: { type: 'disabled' } }),
      scope,
      { claude: 'sonnet' },
      undefined,
      { type: 'enabled' }
    );
    expect(meta.thinking).toEqual({ type: 'disabled' });
  });

  test('uses workflow thinking when the node omits it', () => {
    const meta = resolveNodeExecutionMetadata(
      promptNode({ id: 'n' }),
      scope,
      { claude: 'sonnet' },
      undefined,
      { type: 'enabled' }
    );
    expect(meta.thinking).toEqual({ type: 'enabled' });
  });

  test('uses preset thinking when node and workflow omit it', () => {
    const meta = resolveNodeExecutionMetadata(
      promptNode({ id: 'n', model: 'large' }),
      scope,
      { claude: 'sonnet' },
      undefined,
      undefined
    );
    expect(meta.thinking).toEqual({ type: 'adaptive' });
    expect(meta.provider).toBe('claude');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `packages/workflows`:

```bash
bun test src/node-model-resolution.test.ts
```

Expected: FAIL because `resolveNodeExecutionMetadata` is not exported.

- [ ] **Step 3: Implement the helper and wire thinking**

Add this after `resolveNodeModel` in `packages/workflows/src/node-model-resolution.ts`:

```ts
export function resolveNodeExecutionMetadata(
  node: DagNode,
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile: ResolvedAiProfile | undefined,
  workflowThinking: ThinkingConfig | undefined
): NodeExecutionMetadata {
  const resolved = resolveNodeModel(node, scope, assistantModels, aiProfile);
  const thinking = node.thinking ?? workflowThinking ?? resolved.preset?.thinking;
  return {
    provider: resolved.provider,
    ...(resolved.model ? { model: resolved.model } : {}),
    ...(resolved.effort ? { effort: resolved.effort } : {}),
    ...(thinking ? { thinking } : {}),
  };
}
```

Import `NodeExecutionMetadata` from `./schemas/env-overlay` and `ThinkingConfig` from `./schemas/dag-node`.

In `packages/workflows/src/dag-executor.ts`, replace the thinking seed `node.thinking ?? workflowLevelOptions.thinking` and the `applyPresetOptions` thinking assignment with `resolveNodeExecutionMetadata(...).thinking` at the existing `nodeConfig` construction site near `declaredEffort`.
Leave effort capability gating (`caps.effortControl`) unchanged.
Do not change `resolveNodeModel` origins.

Append `&& bun test src/node-model-resolution.test.ts` to the workflows `test` script.

- [ ] **Step 4: Run tests**

Run from `packages/workflows`:

```bash
bun test src/node-model-resolution.test.ts
bun x tsc --noEmit
```

Expected: both exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/node-model-resolution.ts packages/workflows/src/node-model-resolution.test.ts packages/workflows/src/dag-executor.ts packages/workflows/package.json
git commit -m "feat(workflows): resolve node thinking with shared execution metadata"
```

---

### Task 3: Pure Apply (Clone)

**Files:**

- Create: `packages/workflows/src/env-overlay.ts`
- Create: `packages/workflows/src/env-overlay.test.ts`
- Modify: `packages/workflows/package.json` (export `./env-overlay` and isolated test)

**Interfaces:**

- Consumes: `WorkflowDefinition`, `DagNode`, type guards, `validateDagStructure`, `isRegisteredProvider`, overlay schemas, `clone` via `structuredClone` plus composed-node symbol reattach copied from `cloneNodeForInclude` in `packages/workflows/src/include-expander.ts`.
- Produces:

```ts
export type EnvOverlayErrorCode =
  | 'forbidden_field'
  | 'prompt_type_mismatch'
  | 'bash_type_mismatch'
  | 'ai_field_on_non_ai_node'
  | 'unknown_provider'
  | 'invalid_overlay_graph'
  | 'invalid_patch';

export class EnvOverlayError extends Error {
  readonly code: EnvOverlayErrorCode;
  readonly nodeId?: string;
}

export function cloneWorkflowDefinition(workflow: WorkflowDefinition): WorkflowDefinition;

export function applyEnvOverlay(
  workflow: WorkflowDefinition,
  patches: EnvPatches
): { workflow: WorkflowDefinition; applied: EnvPatches; skippedNodeIds: string[] };

export function isAiOverlayNode(node: DagNode): boolean;

export function buildEnvOverlayResolvedTable(
  workflow: WorkflowDefinition,
  scope: WorkflowModelScope,
  assistantModels: Readonly<Record<string, string | undefined>>,
  aiProfile: ResolvedAiProfile | undefined
): Record<string, NodeExecutionMetadata>;
```

`isAiOverlayNode` is true for `isPromptNode`, `isCommandNode`, `isLoopNode`, and `isLoopGroupNode`.

AI fields are `provider`, `model`, `effort`, `thinking`.
`bash:` may receive only `bash`.
`prompt:` may receive `prompt` plus AI fields.
`command:` / `loop:` / top-level `loop_group:` may receive AI fields only.

- [ ] **Step 1: Write the failing apply tests**

Create `packages/workflows/src/env-overlay.test.ts` with at least these cases:

```ts
import { describe, expect, test } from 'bun:test';
import { applyEnvOverlay, cloneWorkflowDefinition, EnvOverlayError } from './env-overlay';
import type { WorkflowDefinition } from './schemas/workflow';
import type { DagNode } from './schemas/dag-node';

function wf(nodes: DagNode[]): WorkflowDefinition {
  return {
    name: 'demo',
    description: 'demo',
    nodes,
  } as WorkflowDefinition;
}

describe('applyEnvOverlay', () => {
  test('clones and does not mutate the original definition', () => {
    const original = wf([{ id: 'plan', prompt: 'old' } as DagNode]);
    const cached = original;
    const result = applyEnvOverlay(original, { plan: { prompt: 'new' } });
    expect(result.workflow.nodes[0]).toMatchObject({ id: 'plan', prompt: 'new' });
    expect(cached.nodes[0]).toMatchObject({ id: 'plan', prompt: 'old' });
    expect(result.workflow).not.toBe(original);
  });

  test('skips missing node ids and records them', () => {
    const result = applyEnvOverlay(wf([{ id: 'plan', prompt: 'x' } as DagNode]), {
      gone: { model: 'small' },
      plan: { model: 'large' },
    });
    expect(result.skippedNodeIds).toEqual(['gone']);
    expect(result.applied).toEqual({ plan: { model: 'large' } });
    expect(result.applied.gone).toBeUndefined();
  });

  test('skips loop_group body ids that are not top-level', () => {
    const result = applyEnvOverlay(
      wf([
        {
          id: 'grp',
          loop_group: {
            max_iterations: 2,
            nodes: [{ id: 'work', prompt: 'inner' }],
          },
        } as DagNode,
      ]),
      { work: { model: 'small' }, grp: { model: 'large' } }
    );
    expect(result.skippedNodeIds).toEqual(['work']);
    expect(result.applied.grp).toEqual({ model: 'large' });
  });

  test('fails prompt overlay on a bash node', () => {
    try {
      applyEnvOverlay(wf([{ id: 'sh', bash: 'echo hi' } as DagNode]), {
        sh: { prompt: 'nope' },
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvOverlayError);
      expect((error as EnvOverlayError).code).toBe('prompt_type_mismatch');
    }
  });

  test('fails provider overlay on an existing bash node', () => {
    try {
      applyEnvOverlay(wf([{ id: 'sh', bash: 'echo hi' } as DagNode]), {
        sh: { provider: 'claude' },
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvOverlayError);
      expect((error as EnvOverlayError).code).toBe('ai_field_on_non_ai_node');
    }
  });

  test('fails unknown provider on an existing prompt node', () => {
    try {
      applyEnvOverlay(wf([{ id: 'plan', prompt: 'x' } as DagNode]), {
        plan: { provider: 'not-a-provider' },
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvOverlayError);
      expect((error as EnvOverlayError).code).toBe('unknown_provider');
    }
  });

  test('fails dangling $node.output after overlay', () => {
    try {
      applyEnvOverlay(wf([{ id: 'plan', prompt: 'ok' } as DagNode]), {
        plan: { prompt: 'see $missing.output' },
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvOverlayError);
      expect((error as EnvOverlayError).code).toBe('invalid_overlay_graph');
    }
  });

  test('applies include child ids only when namespaced', () => {
    const result = applyEnvOverlay(
      wf([
        { id: 'specify', prompt: 'root' } as DagNode,
        { id: 'block__child', prompt: 'child' } as DagNode,
      ]),
      { specify: { model: 'small' }, child: { model: 'large' } }
    );
    expect(result.skippedNodeIds).toEqual(['child']);
    expect(result.applied.specify).toEqual({ model: 'small' });
  });

  test('empty patches clones without changing nodes', () => {
    const original = wf([{ id: 'plan', prompt: 'x' } as DagNode]);
    const result = applyEnvOverlay(original, {});
    expect(result.applied).toEqual({});
    expect(result.skippedNodeIds).toEqual([]);
    expect(cloneWorkflowDefinition(original).nodes[0]).toMatchObject({ prompt: 'x' });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `packages/workflows`:

```bash
bun test src/env-overlay.test.ts
```

Expected: FAIL with `Cannot find module './env-overlay'`.

- [ ] **Step 3: Implement apply**

Create `packages/workflows/src/env-overlay.ts` that:

1. `cloneWorkflowDefinition` uses `structuredClone` then copies `COMPOSED_NODE` / compiled loop-command symbols from `include-expander.ts` (duplicate the preserve loop; do not export internals unless already public).
2. For each patch key, if no top-level node id matches, push it to `skippedNodeIds` and continue.
3. If the patch object has keys outside `ENV_OVERLAY_PATCH_KEYS`, throw `forbidden_field`.
4. Parse the patch with `nodePatchSchema`; on failure throw `invalid_patch`.
5. Enforce type rules above; `unknown_provider` uses `isRegisteredProvider` from `@archon/providers`.
6. Assign only present keys onto the cloned node.
7. After all keys, run `validateDagStructure(clone.nodes)` and throw `invalid_overlay_graph` with the returned string as `Error.message` when non-null.
8. Return `{ workflow: clone, applied, skippedNodeIds }` where `applied` contains only keys that landed.
9. Log `workflow.env_overlay_applied` only from orchestrator later; this module stays silent except thrown errors.
10. `buildEnvOverlayResolvedTable` iterates `workflow.nodes`, skips non-AI overlay nodes, and calls `resolveNodeExecutionMetadata` with `workflow.thinking`.

Add `"./env-overlay": "./src/env-overlay.ts"` to `packages/workflows/package.json` exports.
Append `&& bun test src/env-overlay.test.ts` to the test script.

- [ ] **Step 4: Run tests**

Run from `packages/workflows`:

```bash
bun test src/env-overlay.test.ts
bun x tsc --noEmit
```

Expected: both exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/env-overlay.ts packages/workflows/src/env-overlay.test.ts packages/workflows/package.json
git commit -m "feat(workflows): clone and apply allowlisted workflow ENV overlays"
```

---

### Task 4: Additive Schema (Both Dialects)

**Files:**

- Modify: `migrations/000_combined.sql`
- Modify: `packages/core/src/db/adapters/sqlite.ts`
- Modify: `packages/core/src/db/adapters/sqlite.test.ts`
- Generate: `packages/core/src/db/bundled-schema.generated.ts`
- Modify: `AGENTS.md` table inventory

**Interfaces:**

- Produces table `remote_agent_workflow_envs` with columns `id`, `workflow_name`, `name`, `patches`, `created_at`, `updated_at`, `created_by_user_id` (nullable FK to `remote_agent_users(id)` ON DELETE SET NULL), `UNIQUE(workflow_name, name)`.

- [ ] **Step 1: Write the failing parity expectation**

In `packages/core/src/db/adapters/sqlite.test.ts`, change `MIN_NON_AUTH_COLUMNS` from `155` to `162`.
Add a focused assertion in the existing parity describe (or a sibling test in that file) that `remote_agent_workflow_envs` exists in both dialects with columns `id`, `workflow_name`, `name`, `patches`, `created_at`, `updated_at`, `created_by_user_id`.

- [ ] **Step 2: Run the parity test and verify it fails**

Run from `packages/core`:

```bash
bun test src/db/adapters/sqlite.test.ts
```

Expected: FAIL on missing table and/or `MIN_NON_AUTH_COLUMNS`.

- [ ] **Step 3: Add the table**

In `migrations/000_combined.sql`, after the usage-ledger `CREATE TABLE` (table 20) and before Better Auth tables, add:

```sql
-- Table 21: Workflow ENVs (per-workflow named overlay patches)
CREATE TABLE IF NOT EXISTS remote_agent_workflow_envs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  patches JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  UNIQUE (workflow_name, name)
);
```

Update the header inventory: 21 application tables, and shift the Better Auth line to `22-25`.

In the trailing `-- Indexes and column comments` section add:

```sql
CREATE INDEX IF NOT EXISTS idx_workflow_envs_workflow_name
  ON remote_agent_workflow_envs(workflow_name);

COMMENT ON COLUMN remote_agent_workflow_envs.workflow_name IS
  'Install-wide workflow name; bundled/global/project shadowing share this key.';
COMMENT ON COLUMN remote_agent_workflow_envs.patches IS
  'Allowlisted per-node overlay JSON keyed by top-level node id.';
COMMENT ON COLUMN remote_agent_workflow_envs.created_by_user_id IS
  'Provenance only, not ACL.';
```

Do not place that index next to the `CREATE TABLE` body.

In `packages/core/src/db/adapters/sqlite.ts` `createSchema()`, add:

```sql
CREATE TABLE IF NOT EXISTS remote_agent_workflow_envs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_name TEXT NOT NULL,
  name TEXT NOT NULL,
  patches TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
  UNIQUE (workflow_name, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_envs_workflow_name
  ON remote_agent_workflow_envs(workflow_name);
```

Do not add this table through `migrateColumns()`; it is new.

Update `AGENTS.md` so the application table list includes `workflow_envs` as table 21.

From repo root:

```bash
bun run generate:bundled-schema
```

- [ ] **Step 4: Run schema tests**

Run from `packages/core`:

```bash
bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts
```

From repo root, if PostgreSQL is reachable:

```bash
bun run check:schema-upgrades
```

Expected: SQLite/parity tests exit `0`.
If Postgres is not reachable, record that `check:schema-upgrades` is still required before PR.

- [ ] **Step 5: Commit**

```bash
git add migrations/000_combined.sql packages/core/src/db/adapters/sqlite.ts packages/core/src/db/adapters/sqlite.test.ts packages/core/src/db/bundled-schema.generated.ts AGENTS.md
git commit -m "feat(core): add remote_agent_workflow_envs table"
```

---

### Task 5: ENV Store CRUD

**Files:**

- Create: `packages/core/src/schemas/workflow-env.ts`
- Create: `packages/core/src/schemas/workflow-env.test.ts`
- Create: `packages/core/src/db/workflow-envs.ts`
- Create: `packages/core/src/db/workflow-envs.test.ts`
- Modify: `packages/core/src/schemas/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**

```ts
export const WORKFLOW_ENV_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class WorkflowEnvNameConflictError extends Error {}

export function assertWorkflowEnvName(name: string): string; // trim, 1..64, pattern

export async function listWorkflowEnvs(workflowName: string): Promise<WorkflowEnvRow[]>;
export async function getWorkflowEnv(id: string): Promise<WorkflowEnvRow | null>;
export async function createWorkflowEnv(input: {
  workflow_name: string;
  name: string;
  patches: EnvPatches;
  created_by_user_id?: string;
}): Promise<WorkflowEnvRow>;
export async function updateWorkflowEnv(
  id: string,
  patch: { name?: string; patches?: EnvPatches }
): Promise<WorkflowEnvRow | null>;
export async function deleteWorkflowEnv(id: string): Promise<boolean>;
```

`patches` on write is `JSON.stringify`.
On read, parse TEXT/JSONB through `envPatchesSchema`.
Corrupt JSON throws (fail fast).
`updateWorkflowEnv` with `patches` replaces the whole object.
Unique violations throw `WorkflowEnvNameConflictError`.
Copy unique-violation detection from `packages/core/src/db/users.ts` (`code === '23505'` / `UNIQUE constraint failed`).
Do not export this module from a barrel that existing `mock.module` factories omit.

Also add:

```ts
export async function setWorkflowRunEnvOverlay(
  runId: string,
  snapshot: EnvOverlaySnapshot
): Promise<void>;
```

in `packages/core/src/db/workflows.ts` using dialect `json_set` / `jsonb_set` on `$.envOverlay` so resume replaces `resolved` wholesale.
Add a unit test in `packages/core/src/db/workflows.test.ts` that a second write replaces `resolved.plan.model` and does not keep a stale node key.

- [ ] **Step 1: Write failing store tests**

Create `packages/core/src/db/workflow-envs.test.ts` modeled on `packages/core/src/db/env-vars.test.ts` (mock `pool.query`).
Cover: list empty, create returns row, unique conflict, get missing null, patch replace, delete true/false, name grammar rejection, patches JSON parse.

- [ ] **Step 2: Run tests and verify they fail**

Run from `packages/core`:

```bash
bun test src/db/workflow-envs.test.ts
```

Expected: FAIL missing module.

- [ ] **Step 3: Implement schema + store**

Row schema in `packages/core/src/schemas/workflow-env.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { envPatchesSchema } from '@archon/workflows/schemas/env-overlay';

export const WORKFLOW_ENV_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const workflowEnvNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(WORKFLOW_ENV_NAME_PATTERN);

export const workflowEnvRowSchema = z.object({
  id: z.string(),
  workflow_name: z.string().min(1),
  name: workflowEnvNameSchema,
  patches: envPatchesSchema,
  created_at: z.string(),
  updated_at: z.string(),
  created_by_user_id: z.string().nullable(),
});

export type WorkflowEnvRow = z.infer<typeof workflowEnvRowSchema>;
```

Implement `packages/core/src/db/workflow-envs.ts` with `pool` + `getDialect().generateUuid()` + `getDialect().now()` like `env-vars.ts`.
Export the row schema from `packages/core/src/schemas/index.ts`.
Append isolated `bun test` segments for the new files in `packages/core/package.json`.

- [ ] **Step 4: Run tests**

Run from `packages/core`:

```bash
bun test src/schemas/workflow-env.test.ts src/db/workflow-envs.test.ts
bun x tsc --noEmit
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/workflow-env.ts packages/core/src/schemas/workflow-env.test.ts packages/core/src/schemas/index.ts packages/core/src/db/workflow-envs.ts packages/core/src/db/workflow-envs.test.ts packages/core/src/db/workflows.ts packages/core/src/db/workflows.test.ts packages/core/package.json
git commit -m "feat(core): add workflow ENV overlay store"
```

---

### Task 6: HTTP CRUD

**Files:**

- Create: `packages/server/src/routes/schemas/workflow-env.schemas.ts`
- Modify: `packages/server/src/routes/api.ts`
- Create: `packages/server/src/routes/api.workflow-envs.test.ts`
- Modify: `packages/server/package.json`

**Interfaces:**

Routes (all `registerOpenApiRoute`):

- `GET /api/workflows/{name}/envs` → `{ envs: WorkflowEnvRow[] }`
- `POST /api/workflows/{name}/envs` body `{ name, patches }` → created row
- `PATCH /api/workflows/{name}/envs/{envId}` body `{ name?, patches? }` → row or 404
- `DELETE /api/workflows/{name}/envs/{envId}` → `{ deleted: boolean }` (false if gone)

Validate `{name}` with the same `isValidWorkflowName` the run route uses.
POST/PATCH 400 on invalid name/patches.
POST/PATCH 409 `env_name_conflict` on unique collision.
Install-open: no extra ACL.
`created_by_user_id` from `resolveWebUserId(c)` (nullable).

- [ ] **Step 1: Write failing HTTP tests**

Create `packages/server/src/routes/api.workflow-envs.test.ts` using the same `makeApp` helper as `api.workflow-runs.test.ts`.
Mock `@archon/core/db/workflow-envs`.
Cases: list, create, patch replace, delete missing `{ deleted: false }`, 409 conflict, 400 bad name.

- [ ] **Step 2: Run tests and verify they fail**

Run from `packages/server`:

```bash
bun test src/routes/api.workflow-envs.test.ts
```

Expected: FAIL (404 routes or missing mocks).

- [ ] **Step 3: Register routes**

Add OpenAPI schemas in `packages/server/src/routes/schemas/workflow-env.schemas.ts` with `.openapi(...)` names.
Register `createRoute` constants next to the other workflow routes in `api.ts`.
Handlers call the store.
Do not return prompt/bash in logs; logging the env id/name is enough.

Append `&& bun test src/routes/api.workflow-envs.test.ts` to the server `test` script.

- [ ] **Step 4: Run tests**

Run from `packages/server`:

```bash
bun test src/routes/api.workflow-envs.test.ts
bun x tsc --noEmit
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/schemas/workflow-env.schemas.ts packages/server/src/routes/api.ts packages/server/src/routes/api.workflow-envs.test.ts packages/server/package.json
git commit -m "feat(server): add workflow ENV CRUD API"
```

---

### Task 7: Start `envId` Freeze (HTTP Identity Only)

**Files:**

- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/server/src/routes/api.ts` POST `/api/workflows/:name/run`
- Modify: `packages/server/src/routes/schemas/workflow.schemas.ts` `runWorkflowBodySchema`
- Modify: `packages/server/src/routes/api.workflow-runs.test.ts`
- Modify: `packages/core/src/orchestrator/orchestrator-agent.ts` (`HandleMessageContext` pass-through onto `WorkflowDispatchOptions`)

**Interfaces:**

```ts
// HandleMessageContext
readonly envOverlay?: EnvOverlayCandidate;

// WorkflowDispatchOptions
envOverlay?: EnvOverlayCandidate;
```

Parse optional `envId` from JSON and from multipart form field `envId` (plain string, not JSON).
Empty/omitted `envId` leaves YAML unchanged and does not read the store.
If present: `getWorkflowEnv(envId)`; missing → `apiError(c, 400, 'env_not_found')`.
If `row.workflow_name !== workflowName` (URL param, decoded) → `apiError(c, 400, 'env_workflow_mismatch')`.
On success, pass `{ envId, envName: row.name, workflowName: row.workflow_name, patches: row.patches }` as `extraContext.envOverlay`.
Do not load YAML in this handler.
Do not treat type/graph errors as HTTP 400.

- [ ] **Step 1: Write failing run-route tests**

Add to `packages/server/src/routes/api.workflow-runs.test.ts`:

- omit `envId` → `handleMessage` context has no `envOverlay`
- unknown `envId` → HTTP 400 `{ error: 'env_not_found' }` and `handleMessage` not called
- ENV `workflow_name` mismatch → HTTP 400 `{ error: 'env_workflow_mismatch' }`
- matching ENV → context contains `envOverlay` with patches
- multipart form field `envId` is accepted the same way

Mock `getWorkflowEnv`.

- [ ] **Step 2: Run tests and verify they fail**

Run from `packages/server`:

```bash
bun test src/routes/api.workflow-runs.test.ts
```

Expected: FAIL on missing `envId` handling.

- [ ] **Step 3: Implement freeze**

Update `runWorkflowBodySchema` comment/shape with optional `envId` (still not wired as OpenAPI `request.body`).
Parse `envId` beside `inputs` in both JSON and multipart branches.
Thread `envOverlay` through `dispatchToOrchestrator` extraContext into `handleWorkflowRunCommand` options exactly like `workflowInputs`.

- [ ] **Step 4: Run tests**

Run from `packages/server`:

```bash
bun test src/routes/api.workflow-runs.test.ts
bun x tsc --noEmit
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/index.ts packages/server/src/routes/api.ts packages/server/src/routes/schemas/workflow.schemas.ts packages/server/src/routes/api.workflow-runs.test.ts packages/core/src/orchestrator/orchestrator-agent.ts
git commit -m "feat(server): freeze workflow ENV identity on start"
```

---

### Task 8: Clone-Apply Before Isolation

**Files:**

- Modify: `packages/core/src/orchestrator/orchestrator-agent.ts`
- Modify: `packages/core/src/orchestrator/orchestrator.ts` (`WorkflowRoutingContext` + background execute args)
- Modify: `packages/core/src/orchestrator/orchestrator-agent.test.ts` and/or a new isolated `orchestrator-env-overlay.test.ts`
- Modify: `packages/core/package.json` if a new test file needs its own invocation
- Grep `mock.module` factories that mock `./orchestrator` or `orchestrator-agent` and add any new export used by tests

**Interfaces:**

After the signature/`requires` gates and before `validateAndResolveIsolation` in `dispatchOrchestratorWorkflow`:

1. If this dispatch will continue an existing run (`willContinueExistingRun`) and `resumableRun.metadata.envOverlay` parses as `appliedEnvOverlaySchema`, use that snapshot's `patches` (ignore request `envOverlay`).
2. Else if `options.envOverlay` is set, use that candidate's `patches`.
3. Else skip apply.
4. `clone` via `applyEnvOverlay`.
5. On `EnvOverlayError`, `platform.sendMessage` the code + message and `return` (no isolation).
6. Replace the local `workflow` variable with the clone for all later execute/background calls.
7. Pass `AppliedEnvOverlay` into `executeWorkflow` / `dispatchBackgroundWorkflow` as `envOverlay`.
8. Log `workflow.env_overlay_applied` with `{ envId, envName, appliedNodeIds, skippedNodeIds }` and never prompt/bash text.
9. Child spawn paths must not receive `envOverlay`.

- [ ] **Step 1: Write failing orchestrator tests**

Prove:

- matching overlay on an existing prompt node is applied to the definition passed to `executeWorkflow`
- missing node id does not block isolation (mock `validateAndResolveIsolation` and assert it was called)
- `prompt` on bash sends a message and does not call `validateAndResolveIsolation`
- the original definition object still has the pre-overlay prompt (cache isolation)
- resume uses snapshot patches, not `options.envOverlay`

- [ ] **Step 2: Run tests and verify they fail**

Run the new file from `packages/core`.

Expected: FAIL (apply not wired).

- [ ] **Step 3: Implement the gate**

Keep YAML discovery in the command handler.
Do not rediscover after apply.
Background path must receive the already-cloned workflow.

- [ ] **Step 4: Run tests**

```bash
bun test src/orchestrator/orchestrator-env-overlay.test.ts
bun x tsc --noEmit
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestrator/orchestrator-agent.ts packages/core/src/orchestrator/orchestrator.ts packages/core/src/orchestrator/orchestrator-env-overlay.test.ts packages/core/package.json
git commit -m "feat(core): apply workflow ENV overlay before isolation"
```

---

### Task 9: Snapshot, Resume, Retry

**Files:**

- Modify: `packages/workflows/src/executor.ts` (`ExecuteWorkflowOptions.envOverlay?: AppliedEnvOverlay`)
- Modify: `packages/core/src/db/workflows.ts` (`setWorkflowRunEnvOverlay`) if not finished in Task 5
- Modify: `packages/workflows/src/executor.test.ts` or a new isolated executor overlay test
- Modify HTTP retry dispatcher `dispatchPreparedWebRetry` in `packages/server/src/routes/api.ts` to pass snapshot overlay from `preCreatedRun.metadata`
- Modify CLI retry/resume only if those paths call `executeWorkflow` without going through `dispatchOrchestratorWorkflow` (`packages/cli/src/commands/workflow.ts`): re-apply snapshot patches onto a clone before execute, ignore any live ENV row

**Interfaces:**

After `buildAiProfile` / `userAiPrefs` load in `executeWorkflow` and before DAG execution / first `sendQuery`:

```ts
if (opts.envOverlay) {
  const resolved = buildEnvOverlayResolvedTable(
    workflow,
    resolveWorkflowModelScope(workflow, defaultAssistant, assistantModels, aiProfile),
    assistantModelDefaults(config),
    aiProfile
  );
  const snapshot: EnvOverlaySnapshot = { ...opts.envOverlay, resolved };
  await deps.store path to setWorkflowRunEnvOverlay(workflowRun.id, snapshot);
}
```

Fresh INSERT may include `envOverlay` in the initial metadata object.
`preCreatedRun` background rows must still receive the complete snapshot via `setWorkflowRunEnvOverlay` before the DAG starts.
Resume recomputes `resolved` from the live profile and writes it back.
Do not read `resolved` when building `SendQueryOptions`.
Unpatched `model: large` follows the current tier.
Child `createWorkflowRun` metadata must not copy parent `envOverlay`.

- [ ] **Step 1: Write failing tests**

- fresh overlay stamps `metadata.envOverlay.patches` without skipped keys
- `skippedNodeIds` listed
- `resolved.plan.thinking` present
- resume after changing live `large` tier updates `resolved.model` and the `sendQuery` model, not the old resolved row
- YAML that later adds a previously skipped id does not receive that patch
- child run metadata has no `envOverlay`

- [ ] **Step 2: Run tests and verify they fail**

- [ ] **Step 3: Implement snapshot writes**

- [ ] **Step 4: Run tests plus `bun x tsc --noEmit` in workflows and core**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workflows): snapshot ENV overlay resolved metadata on the run"
```

---

### Task 10: Preview GET

**Files:**

- Modify: `packages/server/src/routes/api.ts`
- Modify: `packages/server/src/routes/schemas/workflow-env.schemas.ts`
- Modify: `packages/server/src/routes/api.workflow-envs.test.ts`

**Interfaces:**

`GET /api/workflows/{name}/preview`

Query: `cwd` (required), `envId` (optional).

200 body:

```ts
{
  preview: true,
  workflowName: string,
  envId: string | null,
  envName: string | null,
  skippedNodeIds: string[],
  nodes: Array<{ id: string; provider: string; model?: string; effort?: string; thinking?: ThinkingConfig }>
}
```

Steps: `validateCwd`, discover workflows for that cwd, `resolveWorkflowName`.
If `envId` set, load ENV and identity-check (400 codes as Start).
`applyEnvOverlay` on a clone; `EnvOverlayError` → HTTP 400 with `error` equal to the overlay code (preview is a hint endpoint, not Start).
Build resolved table with `buildAiProfile` from cwd config plus `getUserAiPrefs` when `resolveWebUserId` is set.
Label is not a guarantee of the coming run.

- [ ] **Step 1: Write failing preview tests**

Missing cwd → 400.
Unknown envId → 400 `env_not_found`.
Matching envId returns thinking on a prompt node.
Skip-missing id appears in `skippedNodeIds` and HTTP 200.

- [ ] **Step 2: Run tests and verify they fail**

- [ ] **Step 3: Implement the route**

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): add workflow ENV overlay preview"
```

---

### Task 11: Console Start Picker And Preview

**Files:**

- Modify: `packages/web/src/experiments/console/skills/startRun.ts`
- Modify: `packages/web/src/experiments/console/skills/startRun.test.ts`
- Create: `packages/web/src/experiments/console/skills/workflowEnvs.ts`
- Create: `packages/web/src/experiments/console/skills/workflowEnvs.test.ts`
- Create: `packages/web/src/experiments/console/components/WorkflowEnvPicker.tsx`
- Create: `packages/web/src/experiments/console/components/WorkflowEnvPreviewTable.tsx`
- Modify: `packages/web/src/experiments/console/components/DraftRunCard.tsx`

**Interfaces:**

```ts
// StartRunArgs
envId?: string;
```

JSON body includes `envId` when set.
Multipart appends `envId` as a plain field when set.
Omit the field when None.

Picker: first option `None (YAML)`.
After a named ENV is selected, fetch preview with `projectCwd` and show the table.
Caption: `Preview only. The run-detail resolved table is authoritative.`
Reuse `SELECT_CLASS` / `SelectShell` from `SettingsFormPrimitives.tsx` or the `WorkflowPicker` combobox pattern.
Brand tokens only (no ad-hoc hex).

- [ ] **Step 1: Extend `startRun.test.ts`**

JSON with `envId`.
JSON omits `envId` when undefined.
Multipart carries `envId`.
Multipart omits it when undefined.

- [ ] **Step 2: Run tests and verify they fail**

Run from `packages/web`:

```bash
bun test src/experiments/console/skills/startRun.test.ts
```

- [ ] **Step 3: Implement skill + DraftRunCard wiring**

`submit()` passes `envId` when not None.

- [ ] **Step 4: Run tests**

```bash
bun test src/experiments/console/skills/startRun.test.ts src/experiments/console/skills/workflowEnvs.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): send envId from console Start"
```

---

### Task 12: Console Manage CRUD

**Files:**

- Create: `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx`
- Modify: `packages/web/src/experiments/console/components/DraftRunCard.tsx` (Manage button)
- Create: `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.test.tsx` if the dialog has parseable behavior; otherwise cover through `workflowEnvs.test.ts`

**Interfaces:**

Manage dialog lists ENVs for the selected workflow name.
Create/update form fields: `name` plus per-node allowlisted keys only (`provider`, `model`, `effort`, `thinking`, `prompt`, `bash`).
PATCH always sends the full `patches` object.
Delete is idempotent.
Do not render a graph-field editor.
Reuse `EnvVarsDialog.tsx` layout patterns (panel, list, save/delete) without mixing project env-var keys into this store.

- [ ] **Step 1: Write failing skill tests for create/patch/delete URLs**

- [ ] **Step 2: Run and verify fail**

- [ ] **Step 3: Implement dialog + button**

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): manage named workflow ENVs in the console"
```

---

### Task 13: Run Detail Chip And Resolved Table

**Files:**

- Modify: `packages/web/src/experiments/console/primitives/run.ts`
- Modify: `packages/web/src/experiments/console/primitives/run.test.ts`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- Modify: `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`
- Create: `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.tsx`
- Create: `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx`
- Modify: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`

**Interfaces:**

`toRun` reads `metadata.envOverlay.envName` and `metadata.envOverlay.resolved`.
Header chip: `env: <name>` when present.
Table caption: `Resolved at this start/resume. Not a frozen execution contract.`
Columns: node, provider, model, effort, thinking.
This table is authoritative for "did this run apply that ENV".
Reuse `UsageBreakdownTable` numeric/mono cell classes.

- [ ] **Step 1: Write failing `toRun` and header tests**

- [ ] **Step 2: Run and verify fail**

- [ ] **Step 3: Implement chip + table**

- [ ] **Step 4: Run tests**

```bash
bun test src/experiments/console/primitives/run.test.ts src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): show ENV overlay resolved audit on run detail"
```

---

### Task 14: Docs, Generated Types, Inventory

**Files:**

- Modify: `packages/docs-web/src/content/docs/reference/api.md`
- Modify: `packages/docs-web/src/content/docs/guides/authoring-workflows.md`
- Generate: `packages/web/src/lib/api.generated.d.ts`
- Modify: `AGENTS.md` if Task 4 did not finish the inventory sentence

Document:

- ENV CRUD paths
- optional `envId` on Start (JSON + multipart)
- preview GET as non-authoritative
- skip-missing-ids
- HTTP 400 identity vs SSE type/graph
- `resolved` audit-only
- no CLI `--env` in v1

Generate types with the server running:

```bash
bun run dev:server
bun --filter @archon/web generate:types
```

- [ ] **Step 1: Write the docs sections with real curl examples matching the handlers**

- [ ] **Step 2: Generate OpenAPI types**

- [ ] **Step 3: Run focused tests plus package type-checks**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: document workflow ENV overlay API and console picker"
```

---

## Testing Strategy

| Test file | Cases | Validates |
|-----------|-------|-----------|
| `packages/workflows/src/schemas/env-overlay.test.ts` | allowlist, empty map, thinking shorthand | patch contract |
| `packages/workflows/src/node-model-resolution.test.ts` | thinking precedence | shared metadata helper |
| `packages/workflows/src/env-overlay.test.ts` | clone isolation, skip missing, loop_group body, type mismatch, dangling ref, include ids | apply gate |
| `packages/core/src/db/adapters/sqlite.test.ts` | table 21, 162 columns | dialect parity |
| `packages/core/src/db/workflow-envs.test.ts` | CRUD, unique, replace patches | store |
| `packages/server/src/routes/api.workflow-envs.test.ts` | CRUD HTTP, preview, 409 | API |
| `packages/server/src/routes/api.workflow-runs.test.ts` | envId 400 identity, context freeze, multipart | Start |
| `packages/core/src/orchestrator/orchestrator-env-overlay.test.ts` | apply before isolation, SSE type error, resume snapshot | dispatch |
| `packages/workflows` executor overlay tests | snapshot, resume tier, child isolation | run row |
| `packages/web/.../startRun.test.ts` | JSON + multipart `envId` | console Start |
| `packages/web/.../run.test.ts` + resolved table tests | chip + table | run detail |

### Edge Cases Checklist

- [ ] Omit `envId`: cached/bundled definition unchanged
- [ ] Missing node id skipped and listed
- [ ] Type mismatch on an existing node fails before isolation
- [ ] Dangling `$node.output` in overlaid prompt/bash fails before isolation
- [ ] Resume ignores live ENV row and request `envId`
- [ ] Resume does not re-expand skipped keys
- [ ] Live `large` tier change updates `resolved` and `sendQuery`
- [ ] Include child requires `includeId__nodeId`
- [ ] `loop_group` body id skipped
- [ ] Child `workflow:` metadata has no overlay
- [ ] Prompt/bash bodies never logged
- [ ] Unique ENV name → 409
- [ ] DELETE missing → `{ deleted: false }`
- [ ] Preview is labeled a hint

## Acceptance Criteria

- [ ] ENV CRUD API + console Manage
- [ ] Optional `envId` on Start; HTTP 400 only for identity mismatch
- [ ] Clone apply before isolation; skip missing node ids; type/graph fail before worktree
- [ ] Filtered snapshot + audit `resolved`; resume does not re-apply skipped keys
- [ ] Preview GET on Start form; run-detail table is authoritative
- [ ] `resolveNodeExecutionMetadata` shared by preview, snapshot, and `node_started` (includes thinking)
- [ ] Cached bundled definition unchanged after an ENV run
- [ ] Schema parity both dialects + `check:schema-upgrades`
- [ ] Tests for skip-missing-id, type mismatch, dangling `$node.output`, resume filtered snapshot, cache isolation
- [ ] User-facing docs for the console picker
- [ ] All validation commands below pass
- [ ] No regressions in existing package tests that this change touches

## Validation Commands

From the repository root, after the tasks above:

```bash
bun test src/schemas/env-overlay.test.ts src/node-model-resolution.test.ts src/env-overlay.test.ts
```

Run that line from `packages/workflows` (cwd), not from the repo root.

```bash
cd packages/workflows && bun test src/schemas/env-overlay.test.ts src/node-model-resolution.test.ts src/env-overlay.test.ts && bun x tsc --noEmit
cd packages/core && bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts src/schemas/workflow-env.test.ts src/db/workflow-envs.test.ts src/orchestrator/orchestrator-env-overlay.test.ts && bun x tsc --noEmit
cd packages/server && bun test src/routes/api.workflow-envs.test.ts src/routes/api.workflow-runs.test.ts && bun x tsc --noEmit
cd packages/web && bun test src/experiments/console/skills/startRun.test.ts src/experiments/console/skills/workflowEnvs.test.ts src/experiments/console/primitives/run.test.ts src/experiments/console/components/RunDetailHeader.test.tsx src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx && bun x tsc --noEmit
```

Then from repo root:

```bash
bun run generate:bundled-schema
bun run check:bundled-schema
bun run validate
bun run check:schema-upgrades
```

`bun run check:schema-upgrades` needs reachable PostgreSQL.
`bun --filter @archon/web generate:types` needs `bun run dev:server` (or the worktree auto-port) so `/api/openapi.json` includes the new routes.

Never run `bun test` from the repository root.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| In-place mutation of `bundledWorkflowDefsCache` | Med | High | `applyEnvOverlay` always clones; cache-isolation test |
| `json_patch` merge leaves stale `resolved` keys | Med | Med | `json_set` / `jsonb_set` replaces `$.envOverlay` |
| Background pre-create races the snapshot | Med | Med | `executeWorkflow` writes complete snapshot before DAG |
| Preview/Start TOCTOU after ENV PATCH | High | Low | Accepted in spec; run-detail `resolved` is proof |
| `mock.module` factories miss new db exports | Med | High | New module is not a barrel add; grep `mock.module` when touching existing modules |
| Thinking drift between preview and `node_started` | Med | Med | One helper used in all three places |
