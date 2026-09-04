# Workflow ENV overlay (per-node allowlisted patch)

**Status:** draft pending user review of this file
**Date:** 2026-09-04

## Problem

Workflow YAML pins `provider`, `model`, `effort`, `thinking`, `prompt`, and `bash` on nodes.
Changing those values today means editing YAML (and, for bundled defaults, regenerating the binary).
Duplicating the YAML per experiment is the current workaround.

The operator needs the same workflow definition, many runs, different per-node values, without a file per experiment.
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
   The applied patch is snapshotted onto the run at start.
8. **Pricing / experiment tables / sweeps:** out of scope.
9. **PATCH `patches` replaces the whole object** (UI always sends the full map). No deep-merge.

## Current state (evidence)

- Node/workflow `provider`/`model`/`effort` resolve in `resolveNodeModel` / `resolveWorkflowModelScope` (`packages/workflows/src/node-model-resolution.ts`).
- Profile layering is install-wide, not per run: built-in tiers → global → repo → user prefs (`buildAiProfile` in `packages/workflows/src/model-validation.ts`).
- Invocation extra data today is declared `inputs` only (`--input`, POST `inputs`, `with:`), resolved in `packages/workflows/src/workflow-inputs.ts`.
- There is no per-run provider/model/prompt overlay on `POST /api/workflows/:name/run` (`packages/server/src/routes/schemas/workflow.schemas.ts`).
- Include expansion collapses a composed workflow onto a flat DAG at load (`#1764`, `include-expander.ts`).
  `loop_group` bodies stay nested.
- Console start path is `DraftRunCard` → `startRun` (`packages/web/src/experiments/console/skills/startRun.ts`).
  Legacy `WorkflowInvoker` / `WorkflowList` / builder Run are separate start surfaces.
- Schema changes are additive-only, mirrored in Postgres `migrations/000_combined.sql` and SQLite `createSchema()`, indexes in the trailing section, then `bun run generate:bundled-schema`.

## Design

### 1. Architecture

ENV is invocation data, like `inputs:`.
It is not a new workflow-YAML surface.

Load YAML → expand includes → **apply snapshot or fresh ENV patch to the in-memory DAG** → existing `resolveNodeModel`.
`resolveNodeModel` does not grow a new origin.
After a successful apply, the node looks as if the YAML had been edited.

Constitution: the engine must see the effective provider/model/prompt to govern, audit, and resume.
The patch map is declarative data.
A script node cannot change provider before `sendQuery`.

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
Case-sensitive, matching workflow name matching.

Visibility is install-open (single-tenant multi-user).
Any authenticated API user may CRUD.
`created_by_user_id` is recorded when `resolveAuthContext` has a user, otherwise NULL.

Mirror the table into SQLite `createSchema()`.
Regenerate bundled schema.
Parity and `migration-statement-order` tests must cover the new table and index.

No `codebase_id`.
No `source` (`bundled`/`project`/`global`).
If a project YAML shadows a bundled workflow of the same name, they share the ENV list.
Run-time validation uses the DAG that discovery actually loaded.

Workflow rename/delete does not migrate ENV rows.
Orphan rows for a retired name stay until the operator deletes them.

### 3. Patch shape

```ts
type EnvPatches = Record<string, NodePatch>; // key = node id on the expanded top-level DAG

type NodePatch = {
  provider?: string;
  model?: string;
  effort?: string;
  thinking?: ThinkingConfig; // existing dag-node schema, not a new type
  prompt?: string;
  bash?: string;
};
```

Merge rule: only keys present in the node patch replace YAML values.
Omitted keys keep the loaded node.
A patch may not set a field to “unset”; v1 has no explicit delete/null.

Empty `patches: {}` is legal.
Apply is a no-op.
The snapshot still records `envId` / `envName` so the run chip can show the ENV.

### 4. Validation (before worktree / AI)

Match patch keys against the **expanded top-level DAG only**.
Do not recurse into `loop_group` bodies.
Body node ids are scoped to the group and may collide with the outer DAG or with another group; a flat `Record<nodeId, NodePatch>` cannot address them uniquely.

Reject HTTP 400 / executor throw with a named reason:

| Condition | Reason |
| --- | --- |
| `envId` not found | `env_not_found` |
| ENV `workflow_name` ≠ invoked workflow name | `env_workflow_mismatch` |
| Patch key is not a node id in the walked DAG | `unknown_node` |
| Patch contains a key outside the allowlist | `forbidden_field` |
| `prompt` on a node that is not `prompt:` | `prompt_type_mismatch` |
| `bash` on a node that is not `bash:` | `bash_type_mismatch` |
| `provider` / `model` / `effort` / `thinking` on a non-AI node (`bash:`, `script:`, `approval:`, `include:`, `workflow:`, `cancel:`, `plannotator_gate`) | `ai_field_on_non_ai_node` |
| `provider` not a registered provider id | `unknown_provider` |
| `model` / `effort` / `thinking` fail the same checks a YAML node would | same loader/validator errors |

`bash:` nodes may receive a `bash` overlay only.
They must not receive AI fields.

`prompt:` nodes may receive `prompt` plus AI fields.

`command:` / `loop:` / top-level `loop_group:` (the group node, not its body) may receive AI fields only.
v1 does not overlay `command` file bodies, `loop.prompt`, or `loop_group` body nodes.

`plannotator_gate` nested rework provider/model is not overlayable in v1.

Include: root node ids stay as authored (`specify`).
Inlined include nodes are `includeId__nodeId`.
A patch for an include child must use the namespaced id.

Unknown node ids fail at **run start**, not at ENV create.
ENV create may warn in the UI if the current definition lacks a node, but the API does not require a cwd-loaded DAG (identity is name-global).
The run is the source of truth for “does this patch fit this YAML”.

### 5. Apply pipeline

Two paths. They must not mix.

**Fresh start** (`POST /api/workflows/:name/run` with `envId`):

1. Discover + expand the workflow as today.
2. Load ENV by id.
3. Validate against the expanded DAG.
4. Apply patches in memory.
5. Re-run `validateDagStructure` (same `$node.output` / text-surface scan as load) on the patched top-level DAG.
   Schema-valid `prompt`/`bash` strings are not enough: overlay can introduce dangling refs the original YAML never had.
   Non-null error → 400 `invalid_overlay_graph`, no snapshot, no worktree, no AI.
6. Persist snapshot on the new `workflow_runs` row **before** any node `sendQuery`:

```ts
metadata.envOverlay = {
  envId: string;
  envName: string;
  workflowName: string;
  patches: EnvPatches;
}
```

7. `resolveNodeModel` sees the patched nodes. No new resolution origin.

**Resume, retry-run, retry-node:**

- Ignore request `envId` if a client sends one.
- Ignore the current DB ENV row (it may have been edited or deleted).
- If `metadata.envOverlay` exists, re-apply `patches` from the snapshot, then run `validateDagStructure`. Fail the resume/retry if the snapshot no longer fits the DAG.
- If no snapshot, behavior equals today’s resume (YAML only).

Deleting or renaming an ENV never mutates historical or in-flight runs.

Child `workflow:` sub-runs do not inherit the parent overlay.
A child is a different `workflow_name` and would need its own `envId` (not exposed in v1 CLI/UI for children).

### 6. API

All routes go through `registerOpenApiRoute`.
Zod schemas live under `packages/server/src/routes/schemas/`.
Types via `z.infer`.
Regenerate `packages/web/src/lib/api.generated.d.ts`.
`@archon/web` must not import `@archon/workflows`.

- `GET /api/workflows/:name/envs` → `{ envs: [{ id, name, patches, createdAt, updatedAt, createdByUserId }] }`
- `POST /api/workflows/:name/envs` body `{ name, patches }` → created row
- `PATCH /api/workflows/:name/envs/:envId` body `{ name?, patches? }`
  - `patches` if present **replaces** the object (no deep merge at the API)
- `DELETE /api/workflows/:name/envs/:envId` → `{ deleted: true }`
  - Idempotent if already gone: `{ deleted: false }`

`POST /api/workflows/:name/run` body adds optional `envId: string`.
Multipart: extra form field `envId` (plain string), next to JSON-encoded `inputs`.

Omit `envId` = no overlay.
Unknown `envId` = 400 before orchestrator spend.

List is filtered by path `:name` (`workflow_name`).
No project/cwd query param (identity B).

### 7. UI (console)

Primary start surface: `DraftRunCard`.

- After workflow selection, an optional Env `<select>`: `None (YAML)` plus ENV names for that workflow.
- `startRun` sends `envId` on JSON and multipart when not None.
- Manage next to the select: list, create, edit, delete.
  Editor is per-node allowlisted fields, not a free YAML dump.
- Run detail header: chip `env: <name>` from **snapshot**, not a live GET of the ENV row.
  No chip when the run had no overlay.

Out of v1: legacy `WorkflowInvoker`, `WorkflowList`, builder Run button, resume UI env picker, CLI.

Brand tokens only (`packages/web/src/index.css` / brand guide).

### 8. Error and audit posture

- Fail loud before AI cost on validation errors.
- Do not silently drop unknown patch keys.
- Do not silently ignore AI fields on non-AI nodes (loader already warns on some YAML AI fields; overlay is stricter: reject).
- Node-started observability keeps using the resolved provider/model after apply.
- Logs: `workflow.env_overlay_applied` with `{ runId, envId, envName, nodeIds }` — no prompt/bash bodies.

## Testing

Behavioral:

- CRUD: create, rename, replace patches, delete; unique `(workflow_name, name)`; PATCH/DELETE does not change existing run snapshots.
- Fresh run with `envId`: patched fields win; omit `envId`: YAML byte-for-byte vs baseline.
- 400 before AI: unknown node, forbidden field, `prompt` on non-prompt, `provider` on `bash:`.
- Overlay `prompt`/`bash` that inserts a dangling `$node.output` ref → 400 `invalid_overlay_graph` before worktree. A schema-valid string is not sufficient.
- Resume / retry-node / retry-run: re-apply snapshot; edited or deleted ENV row and request `envId` have no effect.
- Include: `specify` hits the root node; include child requires `includeId__nodeId`.
- Patching a `loop_group` **body** id is `unknown_node`. Patching the `loop_group` node itself is allowed.
- Console: `startRun` JSON + multipart carry `envId`; omit sends no field.

Schema / API seams (required):

- Additive table + index mirrored in Postgres and SQLite.
- `bun run generate:bundled-schema` (committed generated file).
- Schema parity test and `migration-statement-order` test.
- `bun run check:schema-upgrades` against PostgreSQL.
- OpenAPI routes generate; `packages/web/src/lib/api.generated.d.ts` updated.

One end-user-like flow (API or console test, no live provider): start with ENV → run metadata has snapshot → resume reapplies snapshot after the ENV row is patched to a different model.

Units stay deterministic: no real network; follow `mock.module` factory rules.

## Phases

1. Schema (both dialects) + bundled schema + upgrade/parity tests
2. Store + HTTP CRUD + OpenAPI types
3. Executor apply + snapshot + resume/retry isolation + validation
4. `POST .../run` `envId` (JSON + multipart)
5. Console picker + Manage editor + run-detail chip

1→2→3→4→5.

## Non-goals

- CLI `--env` / chat env flags
- Pricing, duration dashboards, automatic provider×model sweeps
- Overlay of graph fields, `command` bodies, `loop.prompt`, `loop_group` body nodes (no path syntax), `script` source, plannotator rework config
- Per-project or per-source ENV identity
- Deep-merge PATCH of individual node keys
- Migrating ENV rows when a workflow file is renamed
- Legacy start surfaces
- Changing `resolveNodeModel` origin enum
- Inheriting parent overlay into `workflow:` children

## Open items

None.
Run-time DAG validation (not create-time) is the chosen answer to YAML drift under identity B.
