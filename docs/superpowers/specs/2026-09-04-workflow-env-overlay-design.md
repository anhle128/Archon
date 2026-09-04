# Workflow ENV overlay (per-node allowlisted patch)

**Status:** aligned with `plans/architectures/workflow-env-overlay-architecture.md` (2026-09-05)
**Date:** 2026-09-04

Architecture: `plans/architectures/workflow-env-overlay-architecture.md`

## Problem

Workflow YAML pins `provider`, `model`, `effort`, `thinking`, `prompt`, and `bash` on nodes.
Changing those values today means editing YAML (and, for bundled defaults, regenerating the binary).
Duplicating the YAML per experiment is the current workaround.

The operator needs the same workflow definition, many runs, different per-node values, without a file per experiment.
They also need to see effective provider, model, and thinking at Start so they can tell whether an ENV applied.
Pricing / quality comparison across runs is a separate product and is out of this spec.

## Decisions (user-confirmed)

1. **Approach: allowlisted JSON patch**, not dotenv text and not a special case inside `resolveNodeModel`.
2. **Identity B:** ENV rows are keyed by `workflow_name` on the install.
   The same name shares ENVs across projects and across bundled/global/project shadowing.
3. **Surfaces v1:** Web UI + HTTP API only.
   No CLI `--env`. No chat `/workflow run` env flag.
4. **Picker optional:** omitting ENV leaves the loaded YAML unchanged.
5. **v1 patch fields:** `provider`, `model`, `effort`, `thinking`, `prompt`, `bash`.
6. **No graph overlay:** never `id`, `depends_on`, `when`, `trigger_rule`, node type, `command`, `script`, `include`, `workflow`.
7. **Persistence:** DB CRUD per workflow name.
   The run stores a **filtered applied** snapshot, not a live FK to the ENV row.
8. **Pricing / experiment tables / sweeps:** out of scope.
9. **PATCH `patches` replaces the whole object** (UI always sends the full map). No deep-merge.
10. **Missing node ids are skipped**, not failed.
    Snapshot the filtered map so resume cannot later apply a key that was skipped at start.
11. **HTTP 400 on Start only for ENV identity** (`env_not_found`, `env_workflow_mismatch`).
    Graph / type errors fail on the dispatch path before isolation (SSE), not as HTTP 400.
12. **Start visibility (Q4-C):** preview GET on the Start form, and stamp `resolved` onto the run when the run row is created (after isolation, before first `sendQuery`).
    Not a run-row-before-isolation lifecycle change.
13. **Apply returns a patched clone.** Never mutate a cached discovered definition.
14. **`resolved` is start/resume audit only (Q5-A).**
    Execution never reads `resolved` for `sendQuery`.
    Resume recomputes and updates the table from the live profile.
15. **Preview is non-authoritative (Q6-B).**
    An ENV PATCH between preview GET and Start can diverge.
    Run-detail `resolved` after Start is the source of truth.
    No `updatedAt` / 409 on Start in v1.

## Current state (evidence)

- Node/workflow `provider`/`model`/`effort` resolve in `resolveNodeModel` / `resolveWorkflowModelScope` (`packages/workflows/src/node-model-resolution.ts`).
- `resolveNodeModel` does **not** return `thinking`.
  Thinking follows node → workflow → preset via `applyPresetOptions` (`packages/workflows/src/dag-executor.ts`).
- Profile layering is install-wide, not per run: built-in tiers → global → repo → user prefs (`buildAiProfile` in `packages/workflows/src/model-validation.ts`).
- Invocation extra data today is declared `inputs` only (`--input`, POST `inputs`, `with:`), resolved in `packages/workflows/src/workflow-inputs.ts`.
- `POST /api/workflows/:name/run` dispatches through the orchestrator and still returns `{ accepted: true }` after `handleMessage` errors (`packages/server/src/routes/api.ts`).
- Isolation runs in the orchestrator **before** `executeWorkflow`.
  The run row is created **inside** `executeWorkflow`, after isolation.
- Bundled workflow definitions are cached; in-place mutation would leak one run’s ENV into a later no-ENV run.
- Console start path is `DraftRunCard` → `startRun` (`packages/web/src/experiments/console/skills/startRun.ts`).
- Schema changes are additive-only, mirrored in Postgres `migrations/000_combined.sql` and SQLite `createSchema()`.

## Design

### 1. Architecture

ENV is invocation data, like `inputs:`.
It is not a new workflow-YAML surface.

Two-phase freeze:

1. **HTTP Start** loads the ENV row, checks `workflow_name`, freezes `{ envId, envName, patches }` onto dispatch context.
   No YAML load on `POST .../run`.
   No folder on the request.
2. **Orchestrator, before isolation** clones the DAG discovery already loaded, applies frozen patches to the clone, runs `validateDagStructure`.
   Execution uses that clone.
3. **When the run row is created** (after isolation, before first `sendQuery`), persist the filtered snapshot including `resolved`.

`resolveNodeModel` does not grow a new origin.
Extract `resolveNodeExecutionMetadata` (provider, model, effort, thinking — same thinking precedence as `applyPresetOptions`) and use it for preview, snapshot, and `node_started`.

### 2. Table (additive, both dialects)

`remote_agent_workflow_envs`

| Column | Notes |
| --- | --- |
| `id` | PK (text uuid, same pattern as other Archon ids) |
| `workflow_name` | NOT NULL |
| `name` | NOT NULL, operator-facing (`cheap`, `omp-opus`, …) |
| `patches` | NOT NULL JSON (Postgres JSONB / SQLite TEXT JSON) |
| `created_at` | NOT NULL |
| `updated_at` | NOT NULL |
| `created_by_user_id` | nullable, provenance only, not ACL |

Constraints:

- `UNIQUE(workflow_name, name)`
- Index on `workflow_name` for list, in the trailing index section of `migrations/000_combined.sql`

`name` rules: non-empty, trimmed, max 64 chars, `[A-Za-z0-9][A-Za-z0-9._-]*`.
Case-sensitive.

Visibility is install-open.
Any authenticated API user may CRUD.

No `codebase_id`.
No `source`.
Project YAML that shadows a bundled workflow of the same name shares the ENV list.

### 3. Patch shape

```ts
type EnvPatches = Record<string, NodePatch>; // key = node id on the expanded top-level DAG

type NodePatch = {
  provider?: string;
  model?: string;
  effort?: string;
  thinking?: ThinkingConfig;
  prompt?: string;
  bash?: string;
};

type NodeExecutionMetadata = {
  provider: string;
  model?: string;
  effort?: string;
  thinking?: ThinkingConfig;
};
```

Merge rule on a node that **exists**: only keys present in the node patch replace YAML values.
Omitted keys keep the loaded node.
A patch may not set a field to “unset”.

Missing node id: skip that key (warn log).
Do not fail the run.

Empty `patches: {}` is legal.

### 4. Validation

Match patch keys against the **expanded top-level DAG only**.
Do not recurse into `loop_group` bodies.

**HTTP 400** (Start route, before dispatch):

| Condition | Reason |
| --- | --- |
| `envId` not found | `env_not_found` |
| ENV `workflow_name` ≠ invoked workflow name | `env_workflow_mismatch` |

**Dispatch failure before isolation** (SSE / existing error path, not HTTP 400):

| Condition | Reason |
| --- | --- |
| Patch contains a key outside the allowlist, on a node that exists | `forbidden_field` |
| `prompt` on a node that is not `prompt:` | `prompt_type_mismatch` |
| `bash` on a node that is not `bash:` | `bash_type_mismatch` |
| `provider` / `model` / `effort` / `thinking` on a non-AI node that exists | `ai_field_on_non_ai_node` |
| `provider` not a registered provider id | `unknown_provider` |
| `model` / `effort` / `thinking` fail the same checks a YAML node would | same loader/validator errors |
| `validateDagStructure` fails after apply (dangling `$node.output` in overlaid `prompt`/`bash`) | `invalid_overlay_graph` |

`bash:` nodes may receive a `bash` overlay only.
`prompt:` nodes may receive `prompt` plus AI fields.
`command:` / `loop:` / top-level `loop_group:` (the group node, not its body) may receive AI fields only.

Include: root ids stay as authored.
Inlined include nodes are `includeId__nodeId`.

### 5. Apply pipeline

**Fresh start**

1. HTTP: load ENV, freeze candidate, 400 only on identity errors.
2. Orchestrator, before `validateAndResolveIsolation`: clone loaded DAG, apply freeze, skip missing ids, fail type/graph errors, no second DB read.
3. Isolation.
4. `executeWorkflow` uses the clone (never mutates the cache).
5. When the run row is created, persist:

```ts
metadata.envOverlay = {
  envId: string;
  envName: string;
  workflowName: string;
  patches: EnvPatches; // filtered applied map only
  skippedNodeIds?: string[];
  resolved: Record<string, NodeExecutionMetadata>; // audit at this start/resume, not execution input
};
```

**Resume / retry-run / retry-node**

- Ignore request `envId` and the live ENV row.
- Re-apply `metadata.envOverlay.patches` (already filtered) onto a clone.
- Run `validateDagStructure`.
- Recompute `resolved` with the live profile and write it back.
- Do not re-expand skipped keys if YAML later gains those nodes.
- `sendQuery` still uses the patched clone + live profile, never the previous `resolved` table.

Child `workflow:` sub-runs do not inherit the parent overlay.

### 6. API

All routes go through `registerOpenApiRoute`.
`@archon/web` must not import `@archon/workflows`.

- `GET /api/workflows/:name/envs`
- `POST /api/workflows/:name/envs` `{ name, patches }`
- `PATCH /api/workflows/:name/envs/:envId` `{ name?, patches? }` — `patches` **replaces** the object
- `DELETE /api/workflows/:name/envs/:envId` — idempotent `{ deleted: false }` if gone
- `POST /api/workflows/:name/run` optional `envId` (JSON and multipart)
- `GET` preview: conversation/project cwd + workflow name + optional `envId` → per-node `NodeExecutionMetadata`
  400 if the conversation has no project

### 7. UI (console)

`DraftRunCard`:

- Optional Env select (`None (YAML)` / names).
- After ENV select, show preview table: node, provider, model, thinking.
  Label it as a preview, not a guarantee of the coming run.
- Manage: CRUD allowlisted fields.
- `startRun` sends `envId` when not None.

Run detail:

- Chip `env: <name>` from snapshot.
- Table from `metadata.envOverlay.resolved`, labeled as resolved at this start/resume, not as a frozen execution contract.
  This table is authoritative for “did this run apply that ENV”.

Out of v1: legacy start surfaces, resume ENV picker, CLI.

### 8. Error and audit posture

- Identity errors: HTTP 400.
- Type/graph errors: before isolation, existing SSE path.
- Skip missing node ids: warn, do not fail.
- Type errors on nodes that exist: fail.
- Logs: `workflow.env_overlay_applied` with `{ runId, envId, envName, appliedNodeIds, skippedNodeIds }` — no prompt/bash bodies.

## Testing

- CRUD + unique `(workflow_name, name)`; PATCH/DELETE does not change existing run snapshots.
- Fresh run with `envId`: existing-node fields win; omit `envId`: YAML unchanged vs cached definition.
- Missing node id in ENV: skipped, listed in `skippedNodeIds`, run proceeds.
- Forbidden field / `prompt` on non-prompt / `provider` on existing `bash:`: dispatch fail before isolation.
- Overlay `prompt`/`bash` with dangling `$node.output`: `invalid_overlay_graph` before isolation.
- Resume: re-apply filtered snapshot only; YAML that later adds a skipped id does not receive that patch.
- Resume after live `large` tier changes: `resolved` table updates; `sendQuery` uses the new tier for unpatched `model: large`, not the old `resolved` row.
- Include: `specify` hits root; include child needs `includeId__nodeId`.
- `loop_group` body id: skipped (not a top-level id).
- Cache: apply ENV A, then no-ENV on the same cached bundled definition → original nodes unchanged.
- Preview GET table matches `metadata.envOverlay.resolved` on the resulting run, including thinking.
- Console: `startRun` JSON + multipart carry `envId`.

Schema / API seams: both dialects, `generate:bundled-schema`, parity, `migration-statement-order`, `check:schema-upgrades`, OpenAPI types.

## Phases

1. Schema (both dialects) + bundled schema + upgrade/parity tests
2. Store + HTTP CRUD + OpenAPI types
3. Pure apply (clone) + `resolveNodeExecutionMetadata` + pre-isolation gate + filtered snapshot
4. `POST .../run` `envId` freeze + preview GET
5. Console picker, Manage, Start preview table, run-detail `resolved` table

1→2→3→4→5.

## Non-goals

- CLI `--env` / chat env flags
- Pricing, duration dashboards, automatic provider×model sweeps
- Overlay of graph fields, `command` bodies, `loop.prompt`, `loop_group` body nodes, `script` source, plannotator rework config
- Per-project or per-source ENV identity
- Deep-merge PATCH of individual node keys
- Migrating ENV rows when a workflow file is renamed
- Legacy start surfaces
- Changing `resolveNodeModel` origin enum
- Inheriting parent overlay into `workflow:` children
- Creating the run row before isolation
- Hard-fail `unknown_node`
- Legacy dashboard mobile (separate intent)
- Start `updatedAt` / 409 optimistic concurrency (preview→Start TOCTOU documented, not guarded)

## Open items

None for v1.
YAML drift under identity B is handled by skip-missing-ids plus filtered snapshot.
`resolved` is audit-only; unpatched `model: large` keeps current-tier meaning.
Preview→Start ENV edit race is accepted; run-detail `resolved` is authoritative.

