# Workflow ENV Overlay Implementation Plan

**Status:** Reviewed against the current repository and ready to implement once the decisions and gates in this document are kept intact.

**Issue:** [#70](https://github.com/anhle128/Archon/issues/70)

**Historical design context:** commit `7a60023ca734d23f2935d90253e2576701c1b4d0` contains the earlier spec and architecture notes. Those files are not present in this worktree. This plan is self-contained and supersedes their implementation details where current code contradicts them.

## Outcome

An operator can save a named, install-wide ENV for a workflow, select it from the console when starting a run, and override a small, explicit set of top-level node execution fields without editing the workflow YAML.

The run must execute a patched clone, never mutate the discovered definition, and persist enough immutable selection data to replay the same overlay on resume or node retry even if the ENV row is later edited or deleted. The console must show both a non-authoritative pre-run preview and the latest resolved request metadata recorded for the run.

This solves the concrete use case in issue #70: compare prompt/model/provider variants of the same workflow without duplicating workflow files. It does not build experiment scheduling, pricing comparison, result ranking, or a second workflow language.

“Workflow ENV” is the issue's product term for a named overlay. It is not a process environment-variable set and must not reuse `remote_agent_codebase_env_vars` or `config.envVars`.

## Verified Current-State Baseline

The implementation must preserve these existing facts:

- Workflow discovery returns fully expanded definitions. `include:` children are top-level nodes named `<includeId>__<childId>`; `loop_group` bodies remain nested.
- `include-expander.ts` attaches symbol-keyed `COMPOSED_NODE` and `COMPILED_LOOP_COMMAND` metadata. `structuredClone` drops those symbols, so a plain clone is not execution-equivalent.
- `validateDagStructure()` validates top-level dependencies, cycles, output references, and recursively validates sealed `loop_group` bodies.
- The loader deliberately supports different AI fields per node kind. A plain `loop` executes provider turns but drops `thinking`; a `loop_group` makes no provider call and only treats `provider` and `model` as group defaults. `effort` and `thinking` on a group are ignored today.
- `resolveNodeModel()` only resolves provider/model/effort intent. Actual `node_started` metadata is built later, after provider capability checks, preset-effort validation, assistant-config fallback, and thinking precedence are applied.
- `loop_group` currently forwards its resolved provider to body nodes but passes the outer workflow model/preset/tier. Consequently, a group-level `model` is documented and parsed as meaningful but is not actually forwarded. Supporting group-level model overlays requires fixing this existing runtime mismatch and testing it explicitly.
- `POST /api/workflows/:name/run` manually parses JSON or multipart and intentionally has no OpenAPI `request.body`. It persists the user message and dispatches through the orchestrator; later dispatch failures are surfaced through the platform/SSE path while HTTP still acknowledges the dispatch.
- `validateCwd()` accepts a registered codebase root or any descendant of it, not only an exact registered path.
- The orchestrator performs input and requirement gates before isolation, may resume an existing run, and then executes in foreground or through `dispatchBackgroundWorkflow()`.
- Background web runs create their run row only after worker isolation. The row is pre-created so the UI does not briefly receive a 404.
- Fresh foreground runs create their row inside `executeWorkflow()`. If the applied patch set is written only by a later metadata update, a process crash between INSERT and that update leaves a run that cannot replay its selected ENV.
- `executeWorkflow()` is also called directly by CLI resume, CLI node retry, web node retry, child-run recovery, and parent auto-resume. Orchestrator-only restoration would therefore be incomplete.
- Several direct retry/recovery callers pass a pre-created run but no `userId`; reading preferences/credentials only from the option would recompute an ENV snapshot under the wrong config-only identity.
- Workflow-run metadata is top-level merged by `updateWorkflowRun()`. SQLite `json_patch` deep-merges nested objects, so that method cannot safely replace `metadata.envOverlay.resolved`; stale node keys would survive.
- `IWorkflowStore` is the workflow engine boundary for run lifecycle storage. A new narrow store capability inherited by it still requires updates to the core adapter and several concrete in-memory test stores.
- SQLite rejects `UPDATE ... RETURNING`; workflow ENV updates must use `UPDATE`, check `rowCount`, and then read the row.
- The current schema has 20 application tables and 155 compared non-auth columns. Better Auth tables physically appear before later application tables in the combined migration; the new application table belongs after `remote_agent_usage_ledger` and immediately before the final index/comment section.
- Web auth gates all `/api/*` routes when enabled, but resource visibility inside one install remains open. `created_by_user_id` is provenance, not an ACL.

## Evidence Reviewed

- Node shapes, transforms, ignored-field lists, and recursive DAG validation: `packages/workflows/src/schemas/dag-node.ts`, `packages/workflows/src/loader.ts`, and their tests.
- Include expansion and execution-private symbols: `packages/workflows/src/include-expander.ts`, `packages/workflows/src/compiled-command.ts`, and `include-expander.test.ts`.
- Provider/model/effort/thinking resolution and persisted start metadata: `packages/workflows/src/node-model-resolution.ts`, `packages/workflows/src/dag-executor.ts`, and `dag-executor.test.ts`.
- Run creation, resume hydration, sub-run creation/recovery, and workflow-start ordering: `packages/workflows/src/executor.ts`, `executor.test.ts`, `executor-preamble.test.ts`, and `subrun.test.ts`.
- Storage boundary and JSON merge behavior: `packages/workflows/src/store.ts`, `packages/core/src/workflows/store-adapter.ts`, `packages/core/src/db/workflows.ts`, and their tests.
- Foreground/background orchestration and pre-isolation gates: `packages/core/src/orchestrator/orchestrator-agent.ts`, `packages/core/src/orchestrator/orchestrator.ts`, `orchestrator-agent.test.ts`, `orchestrator.test.ts`, and `orchestrator-isolation.test.ts`.
- Direct resume/retry callers: `packages/cli/src/commands/workflow.ts`, `packages/core/src/operations/workflow-retry.ts`, and `packages/server/src/routes/api.ts` (`dispatchPreparedWebRetry`).
- HTTP Start parsing, auth, cwd validation, route-registration style, and generated schemas: `packages/server/src/routes/api.ts`, `packages/server/src/routes/schemas/workflow.schemas.ts`, and segmented API tests.
- Console request/state/detail conventions: `packages/web/src/experiments/console/skills/startRun.ts`, `store/keys.ts`, `DraftRunCard.tsx`, `primitives/run.ts`, and run-detail components/tests.
- Both database schemas, statement-order/parity/upgrade checks, generated schema/types, package test segmentation, root validation scripts, issue #70, and the historical design at commit `7a60023ca734d23f2935d90253e2576701c1b4d0`.

## Product and Scope Decisions

### In scope

- Named workflow ENVs stored in the database and keyed by install-wide workflow name.
- CRUD over HTTP and the experimental console.
- Optional `envId` on console/HTTP Start, in both JSON and multipart requests.
- A pre-run preview using the selected project path, current workflow definition, current ENV row, current config, and current user's model aliases/tiers.
- A frozen applied-patch snapshot on the workflow run.
- Replay of that snapshot on every resume and node-retry entry point.
- Latest resolved provider request metadata for all direct overlay-addressable provider-turn nodes on the run, refreshed on resume/retry from the live config/profile.
- Top-level expanded nodes, including namespaced include children.
- `provider`/`model` group defaults on a top-level `loop_group`, with the existing group-model forwarding defect fixed as part of this feature.

### Out of scope

- CLI `--env`, chat command syntax, or natural-language ENV selection.
- Applying an ENV to a child `workflow:` sub-run. Child runs only use a snapshot if that child row already owns one; they never inherit the parent's.
- Patching nodes inside a `loop_group` body.
- Patching graph/control fields (`id`, `depends_on`, `when`, `trigger_rule`, `retry`, node mode, `include`, `workflow`, `fan_out`, or isolation policy).
- Patching `command` names, `loop.prompt`/`loop.command`, `script` source, approval/plannotator nested prompts, or workflow-level fields.
- Unsetting a YAML value. Every supplied patch value replaces the YAML value; omission preserves YAML.
- Per-project ENV identity. The same workflow name in bundled, global, and project sources shares one ENV namespace by design.
- Automatic migrations when a workflow or node is renamed.
- Experiment matrices, pricing, duration comparisons, scheduled sweeps, or statistical reports.
- Optimistic locking between Preview and Start. Start freezes the row version it reads.
- Moving workflow-run creation ahead of isolation. Pending overlay metadata is added at each existing INSERT point.
- A destructive down migration or feature flag.

## Authoritative Contracts

### 1. Node-field compatibility

The overlay must follow what the executor actually honors, not the broader base Zod object that the loader later warns and drops.

| Existing top-level node | Allowed patch fields | Reason |
| --- | --- | --- |
| `prompt:` | `prompt`, `provider`, `model`, `effort`, `thinking` | Direct provider turn with inline prompt. |
| `command:` | `provider`, `model`, `effort`, `thinking` | Direct provider turn; the command body itself is not patchable. |
| `loop:` | `provider`, `model`, `effort` | The loop makes provider turns, but its parser deliberately drops `thinking`. |
| `loop_group:` | `provider`, `model` | The group is an execution scope, not a provider turn; only these values are documented as body defaults. |
| `bash:` | `bash` | Deterministic shell node. |
| Every other node kind | none | The allowed fields are ignored or belong to a nested execution surface. |

Consequences:

- `thinking` on `loop` and `effort`/`thinking` on `loop_group` must fail instead of creating a new accidental runtime behavior.
- A body node id such as `review` inside group `iterate` is not a target and is skipped as unknown. An expanded include child such as `quality__review` is a target.
- An existing node with an incompatible field fails. A missing target id is skipped.
- An empty per-node patch is invalid; an empty ENV patch map is valid and is a no-op ENV.

### 2. Patch validation and bounds

Create `packages/workflows/src/schemas/env-overlay.ts` with strict schemas and inferred types. Import `z` from `@hono/zod-openapi`, derive types with `z.infer`, and use explicit record key schemas.

The patch-record key schema must accept the existing safe node-id character set and reject empty/reserved object keys (`__proto__`, `prototype`, `constructor`). Do not reuse the base node schema's 64-character cap: include expansion prefixes otherwise-valid ids with `<includeId>__` and can produce a longer legitimate top-level target. The 1 MiB document bound limits total key size.

The six document-level keys are `provider`, `model`, `effort`, `thinking`, `prompt`, and `bash`. Unknown keys are rejected at API/storage boundaries and again defensively during apply.

Validation rules:

- `provider`: trim before storage; require a non-empty registered provider id when applied.
- `model`: trim before storage and require a non-empty result. This is intentionally stricter than the legacy YAML schema's technically accepted empty string; an ENV cannot use an empty value as an implicit unset.
- `effort`: the existing `effortLevelSchema`.
- `thinking`: the existing `thinkingConfigSchema`, including its shorthand normalization.
- `prompt` and `bash`: arbitrary strings, preserved byte-for-byte. Empty and whitespace-only values remain valid because the current prompt/bash node schemas use plain `z.string()`; ENV must not silently tighten YAML semantics.
- Maximum 256 target entries per ENV.
- Maximum 1 MiB UTF-8 for `JSON.stringify(patches)`, measured with `TextEncoder`. Enforce the same exported constants in the route and store boundary so persisted snapshots cannot be used for unbounded run-metadata amplification.

The size limits bound this feature's new database multiplier; they are not a replacement for a future server-wide request body limit.

### 3. Runtime overlay types

Use distinct shapes for each lifecycle stage:

```ts
type EnvOverlayCandidate = {
  envId: string;
  envName: string;
  workflowName: string;
  patches: EnvPatches; // frozen row contents, before target filtering
};

type AppliedEnvOverlay = {
  envId: string;
  envName: string;
  workflowName: string;
  patches: EnvPatches; // only ids that existed and applied at the original start
  skippedNodeIds: string[]; // ids absent at the original start, sorted
};

type EnvOverlaySnapshot = AppliedEnvOverlay & {
  latestMissingNodeIds: string[]; // frozen patch ids absent now, sorted
  resolved: Record<string, NodeExecutionMetadata>;
};
```

Persist the applied/complete forms at the exact run metadata key `metadata.envOverlay`, using the camelCase property names above and the canonical discovered workflow name. The run API already exposes metadata, so it needs no separate snapshot endpoint. Engine reads must schema-parse this untrusted JSON rather than cast it.

Export a stored-overlay union schema that accepts exactly the pending applied form or the complete snapshot form. If the component schemas are strict, parse the complete form first so its `resolved` and `latestMissingNodeIds` keys are not rejected as extras by the pending form.

For a fresh run, `latestMissingNodeIds` is empty. `patches` and `skippedNodeIds` are immutable after the original start. A later resume may temporarily find that an originally applied node has disappeared; record it in `latestMissingNodeIds` without deleting its frozen patch. If that node returns on a still later resume, the original patch applies again. An id skipped at the original start is never added to `patches`, so it can never begin applying later.

`applyEnvOverlay()` always reports which supplied ids exist now and which are missing. On a fresh start, use that result to filter `EnvOverlayCandidate.patches` into `AppliedEnvOverlay.patches`. On replay, apply the currently present entries but retain the stored `AppliedEnvOverlay.patches` unchanged; the current missing result becomes `latestMissingNodeIds`. Never reconstruct an applied descriptor from the replay result, because doing so would silently delete a frozen patch when YAML temporarily removes a node.

A freshly inserted foreground/background row may briefly hold `AppliedEnvOverlay` before `resolved` is available. Metadata readers and a later supported execution attempt must accept this pending form, but a run may not emit workflow-start events or begin DAG execution until the complete snapshot has been atomically written. A process crash still follows the existing run-lifecycle/orphan policy; this feature must not guess that an externally owned non-terminal run is dead.

### 4. Resolved request metadata

`NodeExecutionMetadata` is the prospective provider request metadata Archon resolves before DAG scheduling, not proof that the node executed and not a claim about which backend model ultimately answered:

```ts
type NodeExecutionMetadata = {
  provider: string;
  model?: string;
  tier?: 'small' | 'medium' | 'large';
  modelReasoningEffort?: string;
  effort?: EffortLevel;
  thinking?: ThinkingConfig;
};
```

Rules:

- Extract one pure resolution result in `node-model-resolution.ts` that accounts for node/workflow/preset precedence, provider capabilities, rejected preset effort, and legacy assistant `modelReasoningEffort` fallback.
- `resolveNodeProviderAndModel()` must consume that result when building `SendQueryOptions`; `node_started` must serialize the same metadata object. Do not compute a second approximation for ENV preview/audit.
- The helper may return structured decisions used by the runtime warning layer, but it must perform no I/O and send no messages.
- Unsupported explicit portable effort continues to fail as it does today. Unsupported thinking continues to be represented as a requested setting while the existing runtime warning says the provider may ignore it.
- Provider-reported final model identity remains in the existing `node_completed.data.model_usage.resolved` field. UI copy must distinguish it from ENV resolved-request metadata.
- A node already completed on resume may appear in the refreshed map without issuing another request. Persisted `node_started` events remain the authoritative attempt history; `resolved` is the latest plan against the live profile.
- Because the table covers the whole workflow, an unresolvable provider/model/effort on any provider-turn node fails a selected ENV run before workflow-start events even if a later `when:` might have skipped that node. Preview exposes the same failure. No-ENV runs retain today's lazy per-node resolution.
- Build the ENV `resolved` map for every direct overlay-addressable provider turn in the patched workflow: unpatched or patched `prompt`, `command`, and `loop` nodes at top level and inside every `loop_group`. Recurse through nested groups with their actual inherited/overridden scope. This whole-workflow table is a confirmed product requirement: it provides the effective baseline needed to compare ENV runs and lets an unpatched tier alias visibly follow the current profile on resume.
- Use persisted workflow-event step names (`group.child`, recursively) for nested rows. Do not add a row for a group container because it never calls `sendQuery`. If a listed node executes, its persisted `node_started` request fields must equal its row in `resolved`.
- Do not invent rows for conditional synthetic provider turns from approval rejection or plannotator gates. Their nested prompt/config surfaces are not ENV targets, and their actual attempts remain visible in their existing `node_started` events.
- Traverse in workflow declaration order and depth-first group-body order; the console sorts displayed rows by qualified node id so serialization order is not a UI contract.
- Do not include bash or other deterministic nodes in `resolved`; their applied body remains proven by the frozen `patches` snapshot.

### 5. Clone and apply behavior

Create `packages/workflows/src/env-overlay.ts` as a pure engine module.

- Generalize/export the symbol-preserving node clone currently private as `cloneNodeForInclude` in `include-expander.ts`; use the same helper for includes and ENV cloning. Update the load-bearing comment in `compiled-command.ts`. Do not duplicate the list of private symbols.
- Clone the workflow root and every node, recursively preserving composed and compiled-loop metadata.
- Build one top-level id map and match only expanded top-level ids; do not scan all nodes once per patch.
- For each existing target, validate the field matrix, explicit provider registration, assign only supplied keys, and run `dagNodeSchema.safeParse()` against the patched node. Use the parse result for validation only; continue with the symbol-preserving clone rather than a parsed object that drops engine-private metadata.
- Deep-copy object values such as `thinking` into the node and returned applied map; neither result may retain mutable aliases into the supplied patch document.
- After all patches, run `validateDagStructure()` on the cloned nodes.
- Return the clone, filtered applied map, and sorted skipped ids. Never mutate the input definition or patch document.
- Expose current present/missing ids separately enough that replay callers can retain the original frozen patch map as described above.
- Errors carry a stable code, safe message, optional node id, and optional field. At minimum cover `forbidden_field`, `field_not_supported_for_node`, `unknown_provider`, `invalid_patched_node`, `invalid_overlay_graph`, `workflow_mismatch`, and `invalid_overlay_snapshot`.
- Error text and logs must never include `prompt` or `bash` bodies.

### 6. Loop-group execution parity

Because `loop_group.model` is already accepted and documented as a body default, correct the executor while adding ENV support:

- Extend the node resolution return value so the group dispatch has its resolved provider, model, effective preset, and tier.
- Pass that group scope into `executeLoopGroupNode()` and then into its body `RunLayersContext` instead of combining the group provider with the outer workflow's model/preset/tier.
- Preserve the outer workflow's explicit effort/thinking precedence; a group model alias may supply its normal lower-precedence preset values.
- Apply the same logic recursively for nested groups.
- Add regression tests for existing YAML without ENV as well as overlaid group provider/model. This is a behavior fix, not permission to support group effort/thinking fields.

### 7. Persistence model

Add application table 21 to both dialects:

```text
remote_agent_workflow_envs
  id                    UUID/TEXT primary key with the dialect's existing generated-id default
  workflow_name         VARCHAR(255)/TEXT not null
  name                  VARCHAR(64)/TEXT not null
  patches               JSONB/TEXT not null default {}
  created_at            timestamptz/TEXT not null
  updated_at            timestamptz/TEXT not null
  created_by_user_id    nullable users FK, ON DELETE SET NULL
  CONSTRAINT uq_workflow_envs_workflow_name_name UNIQUE (workflow_name, name)
```

Use case-sensitive names, trimmed to 1–64 characters and matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`. ENV identity is `(workflow_name, name)`; `created_by_user_id` is provenance only.

Keep the existing PostgreSQL `gen_random_uuid()` and SQLite `lower(hex(randomblob(16)))` schema defaults. The create store still supplies `getDialect().generateUuid()` like neighboring modules, so both dialects return the same application-generated id; updates use `getDialect().now()` to refresh `updated_at`. Both timestamps also have current-time schema defaults for non-application inserts.

Migration requirements:

- Add the PostgreSQL table after `remote_agent_usage_ledger`, immediately before the final `Indexes and column comments` section. Do not move Better Auth tables merely to make physical order match inventory numbering.
- Put `idx_workflow_envs_workflow_name` and every `COMMENT ON COLUMN` in the final section. A `COMMENT ON TABLE` may stay with the table.
- Mirror the table and index in SQLite `createSchema()`; do not use `migrateColumns()` for a new table.
- Update the combined migration inventory and `AGENTS.md` to 21 application tables and Better Auth tables 22–25.
- Raise the parity floor from 155 to the verified post-change count of 162. If the parity test reports a different actual count, investigate the schema rather than blindly changing the constant.
- Regenerate `packages/core/src/db/bundled-schema.generated.ts`.
- No backfill is required. Existing runs and installs remain valid.

### 8. Store contracts

Create the core row schema and `packages/core/src/db/workflow-envs.ts` with these operations:

- `listWorkflowEnvSummaries(workflowName)` without the `patches` body; deterministic `LOWER(name), name, id` ordering.
- `getWorkflowEnvById(envId)`; callers must identity-check `workflow_name`. Start uses the unscoped result to distinguish not-found from workflow mismatch; detail maps both cases to 404.
- `createWorkflowEnv({ workflow_name, name, patches, created_by_user_id })`.
- `updateWorkflowEnv(workflowName, envId, { name?, patches? })`; both SQL identity predicates are required.
- `deleteWorkflowEnv(workflowName, envId)`; both identity predicates are required.

Use one shared workflow-name schema (`isValidWorkflowName` plus maximum 255), the ENV-name schema, and `envPatchesSchema` at route and store write boundaries. Do not rely on PostgreSQL `VARCHAR` to enforce limits that SQLite would accept.

The PATCH body must contain at least one field. When present, `patches` replaces the whole JSON document. Update and delete through a mismatched workflow path must not mutate another workflow's ENV.

Normalize PostgreSQL JSONB objects and SQLite JSON strings through `envPatchesSchema`; validate the complete row at the boundary. A corrupt stored document throws a typed `WorkflowEnvCorruptRowError` and emits an id-only log. Never log serialized patches. Follow the existing `dbTimestamp = z.union([z.date(), z.string()])` row convention and the server's `toISOString` wire helper rather than assuming both drivers return the same runtime type.

Map PostgreSQL `23505` only when `constraint === 'uq_workflow_envs_workflow_name_name'`, and SQLite's `UNIQUE constraint failed` only when the message names both ENV identity columns, to a typed `WorkflowEnvNameConflictError`. Do not classify unrelated unique or database errors as name conflicts.

Use `getDatabase().withTransaction()` for create+read and update+read. Do not use `UPDATE ... RETURNING`: run the scoped update, check `rowCount`, then read the row inside the same transaction so the response is the version that operation wrote. Concurrent completed edits remain last-commit-wins in v1.

Define a narrow `IWorkflowEnvOverlayStore` with required `setWorkflowRunEnvOverlay(runId, snapshot): Promise<WorkflowRun>`, then have `IWorkflowStore` extend it so the existing dependency object remains unchanged without making this operation look like a generic metadata API. Update core's adapter and every concrete test store. Its core implementation must:

- replace only `metadata.envOverlay` with `jsonb_set(COALESCE(metadata, '{}'::jsonb), '{envOverlay}', ...)` on PostgreSQL;
- replace only `metadata.envOverlay` with `json_set(COALESCE(metadata, '{}'), '$.envOverlay', json(...))` on SQLite;
- preserve sibling metadata;
- require one affected run row and throw otherwise;
- update and read the complete run in one transaction, returning that row without `RETURNING` on SQLite.

This write is audit-critical. If it fails, execution fails closed before the first DAG node rather than running an unrecorded overlay.

### 9. HTTP API

All new routes use `registerOpenApiRoute(createRoute(...), handler)` and server route schemas. The general API auth gate supplies authentication; no new per-resource ACL is introduced.

For create provenance, use the server-resolved web user id when available and otherwise store null; never accept `createdByUserId` from the request body.

#### CRUD

- `GET /api/workflows/{name}/envs` → `200 { envs }` with summary rows only
- `GET /api/workflows/{name}/envs/{envId}` → `200 { env }`, or `404` for an absent/mismatched id
- `POST /api/workflows/{name}/envs` with `{ name, patches }` → `201 { env }`
- `PATCH /api/workflows/{name}/envs/{envId}` with `{ name?, patches? }` → `200 { env }`, `404` when the id is absent or belongs to another workflow
- `DELETE /api/workflows/{name}/envs/{envId}` → `200 { deleted }`; false for absent or mismatched id

Use one camelCase wire mapper:

```ts
type WorkflowEnvSummaryResponse = {
  id: string;
  workflowName: string;
  name: string;
  updatedAt: string;
};

type WorkflowEnvResponse = WorkflowEnvSummaryResponse & {
  patches: EnvPatches;
  createdAt: string;
  createdByUserId: string | null;
};
```

List omits `patches` deliberately: one ENV may contain 1 MiB, and the picker needs only identity. The manager fetches the selected detail explicitly. V1 leaves the lightweight summary list unpaginated; do not add per-row detail queries to build it.

Validate the path with `isValidWorkflowName` and the storage maximum of 255 characters. CRUD does not need a `cwd` and does not require the workflow to be currently discoverable; this permits configuring a globally named ENV before a project override appears.

Use stable `{ error: '<code>', detail?: string }` bodies: invalid path/name/patch/size is 400, the named unique conflict is `409 env_name_conflict`, and scoped GET/PATCH returns `404 env_not_found` for both absent and mismatched ids. `env_workflow_mismatch` is the Start/Preview identity error described below, where distinguishing a selected global row is useful. Map `WorkflowEnvCorruptRowError` to `500 env_store_corrupt` before any Start side effects. Include `detail` only for safe validation/resolution summaries; never include patch values.

#### Start

Extend the existing manually parsed contract:

- JSON: `{ conversationId, message, inputs?, envId? }`
- Multipart: `conversationId`, `message`, optional JSON-encoded `inputs`, optional plain `envId`, and files

An omitted or empty `envId` means YAML only. A non-string/duplicated multipart field or non-string JSON value is a normal HTTP 400 request-shape error.

When `envId` is present, load and validate the row after parsing the request fields but before persisting uploaded files or the run-start user message. Return `400 { error: 'env_not_found' }` if absent and `400 { error: 'env_workflow_mismatch' }` if the row's workflow name differs from the decoded route parameter. Schema-parse into a newly allocated JSON tree, construct `{ envId: row.id, envName: row.name, workflowName: row.workflow_name, patches }`, and treat that value as immutable in `HandleMessageContext`; do not retain a live row or patches reference.

Do not discover/apply YAML in the route. Existing input validation 400s remain. Node compatibility, provider, profile, and graph errors travel through the existing dispatch/SSE error path, not as synchronous Start 400s.

Update `runWorkflowBodySchema` and the route description even though the schema remains intentionally unwired. The new CRUD/preview routes will still contribute generated OpenAPI types.

#### Preview

Add `GET /api/workflows/{name}/env-preview?cwd=<path>&envId=<optional>`; absent or empty `envId` means baseline YAML.

Use a distinct route name rather than overloading the existing single-workflow endpoint. `cwd` is required and must pass the existing root-or-descendant `validateCwd()` rule. Discover using that cwd and resolve the workflow by existing router rules. Return 404 when it cannot be resolved.

If an ENV is supplied, return the same `400 env_not_found`/`env_workflow_mismatch` identity errors as Start and require its stored workflow name to match both the request name and the canonical resolved workflow name. Apply the same clone helper and build the same resolution metadata using current merged config and the current web user's tiers/aliases. Mirror the executor's corrupt-user-preference fallback to config-only.

Return:

```ts
{
  preview: true;
  authoritative: false;
  workflowName: string; // canonical resolved name
  envId: string | null;
  envName: string | null;
  skippedNodeIds: string[];
  targets: Array<{ id: string; nodeType: string; allowedFields: EnvOverlayPatchKey[] }>;
  resolved: Array<{ nodeId: string } & NodeExecutionMetadata>;
}
```

`targets` is the console editor's field matrix source, including bash nodes. `resolved` contains all provider turns under the same traversal rule as section 4. Map `EnvOverlayError` to its typed code and all profile/request-resolution failures to `400 { error: 'env_preview_resolution_failed', detail?: <safe summary> }`; do not classify error-message prose. The response is a hint because the ENV row, workflow file, config, and user prefs may change before Start; the run snapshot and node events are authoritative afterward.

### 10. Dispatch, execution, resume, and retry

#### Fresh dispatch through the orchestrator

Thread the frozen candidate through `HandleMessageContext` and `WorkflowDispatchOptions` without putting it in the natural-language command string.

In `dispatchOrchestratorWorkflow()`, after declared-input and external-requirement gates but before conversation mutation or `validateAndResolveIsolation()`:

1. Determine whether this invocation genuinely continues the existing run.
2. For a continuation, ignore the request candidate and parse the run's stored overlay. If the run has no overlay, continue with YAML only. Tell the user when a newly supplied ENV is ignored because an existing run owns its original selection. Apply only entries whose nodes still exist, but pass the original stored `patches` and `skippedNodeIds` onward unchanged.
3. For a fresh run, use the request candidate.
4. Require candidate/snapshot `workflowName` to equal the canonical discovered `workflow.name`. This is the defense against a fuzzy route name applying a globally named ENV to a different workflow.
5. Apply to a symbol-preserving clone and replace the local workflow with that clone.
6. On error, send a safe code/message and return before isolation. A malformed stored resume snapshot also returns without changing the paused/failed run.
7. Pass `AppliedEnvOverlay` beside the cloned workflow to foreground execution or `dispatchBackgroundWorkflow()`. The descriptor must be a detached value; no caller may mutate it after this handoff.

Log only env id/name, applied node ids, skipped ids, and error codes. Never log patch values.

For a background run, include the pending applied-overlay metadata in the pre-created row after worker isolation, and pass the same object to `executeWorkflow()` for both the pre-created and fallback-insert paths.

#### Executor backstop

Add `appliedEnvOverlay?: AppliedEnvOverlay` to `ExecuteWorkflowOptions`.

At executor entry:

- For an overlay-bearing pre-created run, derive execution identity as `preCreatedRun.user_id ?? undefined` and use it consistently for user AI preferences, provider/GitHub credentials, and child-run attribution during that attempt. A resume/retry requester's authorization is checked by its caller; it must not replace the original run owner's execution profile. Preserve today's `opts.userId` behavior when no overlay exists, avoiding an unrelated identity change in this feature.
- If `appliedEnvOverlay` is supplied, the workflow is already patched. Verify workflow identity and that every currently present patched field equals the descriptor; derive current missing ids without filtering the descriptor. Throw instead of running if the caller violates this invariant.
- Otherwise, parse `preCreatedRun.metadata.envOverlay`. If present, reapply its frozen `patches` to a clone before config/model resolution. This is the universal backstop for CLI resume, CLI node retry, web node retry, child recovery, and parent auto-resume.
- Absence of overlay metadata bypasses all overlay clone/snapshot work. The only intentional no-ENV execution change in this plan is the separately tested `loop_group.model` forwarding correction in section 6.
- An invalid snapshot or incompatible current workflow must stop safely. If the caller has already flipped it to `running`, attempt to mark it `failed` so it remains recoverable. If that status write also fails, emit a critical id/code-only log and still execute nothing; do not later guess that the ambiguous non-terminal row is orphaned.

When the executor creates a fresh foreground row with an overlay, include the pending `AppliedEnvOverlay` in that INSERT's metadata alongside inputs/isolation/GitHub context. Do the same in every fallback INSERT. This makes the immutable filtered patches durable at the first possible run-row write; the later complete snapshot update is not their first persistence.

After loading current config/user prefs, resolving the path lock/setup gates, and obtaining a run row, but before the workflow-start emitter event, persisted `workflow_started` event, start notification, or DAG execution:

1. Build `resolved` from the patched workflow and current profile.
2. Build the complete snapshot, keeping original `patches`/`skippedNodeIds` and replacing `latestMissingNodeIds`/`resolved` for this attempt.
3. Atomically replace `metadata.envOverlay` through the required store method.
4. Replace the executor's in-memory run with the returned row.
5. Attempt to fail the run before returning if resolution or persistence fails; regardless of whether that second database write succeeds, execute nothing.

Execution builds provider options from the patched workflow and shared resolution logic. It never reads the persisted `resolved` object as input.

Fresh child `workflow:` runs do not receive the parent's overlay in their create options or metadata. Existing child/parent auto-resume calls require no special caller changes because the executor backstop reads only the row being resumed.

### 11. Console UX

The console is the only v1 UI. Do not modify the legacy dashboard workflow launcher.

#### Start card

In `DraftRunCard`:

- Load ENVs for the selected canonical workflow.
- Add `None (YAML)` as the default/empty selection.
- Clear the ENV selection, preview state, and declared input values when the workflow changes so state from one workflow cannot leak into another.
- Fetch preview for the selected ENV using `projectCwd`; cancel or key requests by cwd/workflow/env id so a slower prior response cannot overwrite a newer selection.
- Show provider-turn rows plus skipped-id warnings. Label it: “Preview only — the ENV, workflow, or model profile may change before Start.”
- A list failure may leave `None (YAML)` usable. Once an ENV is selected, retain that selection and disable Start while its detail/preview is loading or invalid; never reset to None and silently start YAML-only after an ENV fetch error.
- Pass `envId` through both JSON and multipart branches of `startRun()`; omit it for None.

#### Manage dialog

Create a workflow-specific management dialog modeled visually, not semantically, on `EnvVarsDialog`.

- Fetch baseline preview to obtain `targets` and allowed fields from the server rather than duplicating the node matrix in React.
- Fetch summary rows for the list and fetch one full ENV only when it is opened for editing; do not make the list endpoint return every prompt/bash body.
- Let the operator choose a target node, then edit only fields in that target's `allowedFields`.
- Normalize thinking through explicit UI choices supported by the schema; provide a structured editor or validated JSON only where the existing thinking object needs it.
- Require a non-empty patch per chosen node, show include-expanded ids as returned, and explain that loop-group body ids cannot be targeted.
- PATCH sends the complete patch map, not a deep delta.
- Confirm delete, surface 409 conflicts, and invalidate the ENV list and all affected preview cache keys after mutations.
- State that prompt/bash bodies are stored in plaintext and visible to users who can access this install; do not describe them as secrets or encrypted values.

#### Run detail

Defensively parse `metadata.envOverlay` in the console primitive without importing `@archon/workflows`.

- Add an `env: <name>` chip when pending or complete overlay metadata exists.
- Render the latest `resolved` rows with node, provider, requested model/tier, effort, and thinking.
- Caption: “Latest planned request settings at this start/resume; providers may ignore unsupported thinking. A resume may skip completed nodes. Node events show actual attempts and provider-reported final models.”
- Show `skippedNodeIds` and `latestMissingNodeIds` as warnings when non-empty.
- Never render frozen prompt/bash bodies in the resolved table.
- A malformed/legacy metadata object must not crash run detail; omit the table and keep the rest of the run usable.

## Files

### Create

- `packages/workflows/src/schemas/env-overlay.ts`
- `packages/workflows/src/schemas/env-overlay.test.ts`
- `packages/workflows/src/env-overlay.ts`
- `packages/workflows/src/env-overlay.test.ts`
- `packages/workflows/src/node-model-resolution.test.ts`
- `packages/core/src/schemas/workflow-env.ts`
- `packages/core/src/schemas/workflow-env.test.ts`
- `packages/core/src/db/workflow-envs.ts`
- `packages/core/src/db/workflow-envs.test.ts`
- `packages/core/src/db/workflows.env-overlay.integration.test.ts`
- `packages/server/src/routes/schemas/workflow-env.schemas.ts`
- `packages/server/src/routes/api.workflow-envs.test.ts`
- `packages/web/src/experiments/console/skills/workflowEnvs.ts`
- `packages/web/src/experiments/console/skills/workflowEnvs.test.ts`
- `packages/web/src/experiments/console/components/WorkflowEnvPicker.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvPicker.test.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvPreviewTable.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.test.tsx`
- `packages/web/src/experiments/console/components/DraftRunCard.test.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.tsx`
- `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx`

### Modify

- `packages/workflows/src/schemas/index.ts`
- `packages/workflows/src/include-expander.ts`
- `packages/workflows/src/compiled-command.ts`
- `packages/workflows/src/node-model-resolution.ts`
- `packages/workflows/src/dag-executor.ts`
- `packages/workflows/src/executor.ts`
- `packages/workflows/src/store.ts`
- relevant workflow tests: `dag-executor.test.ts`, `executor.test.ts`, `subrun.test.ts`, `executor-preamble.test.ts`, `script-node-deps.test.ts`, `plannotator-gate-executor.test.ts`, `plannotator-gate-supervisor.test.ts`, and any further concrete `IWorkflowStore` fixture found by type-check
- `packages/workflows/package.json` for the `./env-overlay` export and only the test segmentation actually required by `mock.module` isolation
- `packages/core/src/schemas/index.ts`
- `packages/core/src/db/workflows.ts`
- `packages/core/src/db/workflows.test.ts`
- `packages/core/src/workflows/store-adapter.ts`
- `packages/core/src/workflows/store-adapter.test.ts`
- `packages/core/src/types/index.ts`
- `packages/core/src/orchestrator/orchestrator-agent.ts`
- `packages/core/src/orchestrator/orchestrator-agent.test.ts`
- `packages/core/src/orchestrator/orchestrator.ts`
- `packages/core/src/orchestrator/orchestrator.test.ts`
- `packages/core/src/orchestrator/orchestrator-isolation.test.ts`
- `packages/core/src/db/adapters/sqlite.ts`
- `packages/core/src/db/adapters/sqlite.test.ts`
- `packages/core/package.json` to include all new Core test files in the appropriate existing segments; add a separate process only if `mock.module()` isolation requires it
- `packages/server/src/routes/api.ts`
- `packages/server/src/routes/schemas/workflow.schemas.ts`
- `packages/server/src/routes/api.workflow-runs.test.ts`
- `packages/server/src/routes/api.workflows.test.ts` and any shared API mock factory affected by the new static imports
- `packages/server/package.json` to run the mock-heavy API file in its own existing-style segment
- `packages/web/src/experiments/console/skills/index.ts`
- `packages/web/src/experiments/console/skills/startRun.ts`
- `packages/web/src/experiments/console/skills/startRun.test.ts`
- `packages/web/src/experiments/console/store/keys.ts`
- `packages/web/src/experiments/console/components/DraftRunCard.tsx`
- `packages/web/src/experiments/console/primitives/run.ts`
- `packages/web/src/experiments/console/primitives/run.test.ts`
- `packages/web/src/experiments/console/components/RunDetailHeader.tsx`
- `packages/web/src/experiments/console/components/RunDetailHeader.test.tsx`
- `packages/web/src/experiments/console/routes/RunDetailPage.tsx`
- `migrations/000_combined.sql`
- generated `packages/core/src/db/bundled-schema.generated.ts`
- generated `packages/web/src/lib/api.generated.d.ts`
- `packages/docs-web/src/content/docs/reference/api.md`
- `packages/docs-web/src/content/docs/guides/authoring-workflows.md`
- `AGENTS.md` database inventory

Do not modify workflow YAML schemas to add an ENV field. This is an invocation/storage feature, not workflow-language surface, so the Workflow Language Constitution does not need a new language rule.

## Implementation Sequence

### Phase 1: Engine schemas, clone, apply, and resolution parity

- [ ] Add strict patch/candidate/applied/snapshot/resolution schemas, limits, inferred types, and exports.
- [ ] Generalize the existing symbol-preserving clone helper and cover composed metadata, compiled command-loop payloads, and nested groups.
- [ ] Implement pure top-level apply with the verified field matrix, full patched-node validation, provider validation, graph validation, deterministic skip lists, and safe typed errors.
- [ ] Extract the pure node execution-resolution result and make normal prompt/command `node_started` metadata consume it.
- [ ] Wire loop `node_started` to the same metadata where supported.
- [ ] Fix loop-group provider/model/preset/tier forwarding and make whole-workflow resolved-table traversal use the same scope rules and qualified body ids.
- [ ] Export `@archon/workflows/env-overlay`.

Exit gate: engine tests demonstrate that preview metadata and `node_started` agree for node/workflow/preset precedence, valid/rejected preset effort, assistant fallback, thinking, loops, includes, and nested group scope.

### Phase 2: Additive database schema and ENV CRUD store

- [ ] Add table 21 and the SQLite twin in the correct physical sections.
- [ ] Add the trailing PostgreSQL index/comments, SQLite index, parity assertions, inventory changes, and bundled-schema generation.
- [ ] Add the core row/name schemas and dialect-normalizing CRUD store.
- [ ] Scope update/delete by workflow name, enforce whole-document PATCH replacement, and type unique conflicts.
- [ ] Add the exact nested metadata replacement method to DB, the narrow overlay-store interface inherited by `IWorkflowStore`, the core adapter, and concrete stores/mocks.
- [ ] Register the new unit and integration files in Core's explicit package test script, preserving process isolation.

Exit gate: both dialect schema/parity tests pass; CRUD covers JSON round-trip and mismatch scoping; the SQLite integration test proves a second snapshot removes stale resolved keys while preserving sibling metadata.

### Phase 3: Executor snapshot ownership and universal replay

- [ ] Add the applied-overlay executor option and pending metadata support.
- [ ] Restore a stored snapshot at executor entry when the caller did not already apply it.
- [ ] Verify identity/patched-field equality when the caller already applied it; preserve the frozen descriptor when nodes are currently missing.
- [ ] Include the pending applied descriptor in every fresh foreground/background/fallback run INSERT.
- [ ] Build and atomically persist complete resolved metadata before workflow/DAG start.
- [ ] Attempt to mark already-claimed runs failed on snapshot corruption/apply/audit-write failure, with a critical no-execution path if that status write also fails.
- [ ] Verify child creation does not copy a parent overlay.
- [ ] Cover CLI-style direct resume/retry, web retry, child recovery, and parent auto-resume through executor-level tests; do not duplicate overlay reapplication in those callers.

Exit gate: every direct `executeWorkflow` path either has no overlay or deterministically restores the row's frozen one; none reads the live ENV row.

### Phase 4: Orchestrator pre-isolation gate and background handoff

- [ ] Thread the frozen candidate through typed context/options.
- [ ] Select request candidate versus stored resume snapshot using `willContinueExistingRun` semantics.
- [ ] Apply after input/requirement gates and before conversation mutation/isolation.
- [ ] Refuse canonical workflow mismatches, invalid node types, and invalid graph references before isolation.
- [ ] Pass the patched clone and applied descriptor to foreground/background execution.
- [ ] Stamp the pending descriptor on a background pre-created row and keep the executor fallback path equivalent.
- [ ] Verify request ENVs are ignored, with a notice, when resuming an existing run.

Exit gate: tests spy on `validateAndResolveIsolation()` and prove it is not called for invalid overlays while valid/missing-id overlays retain current isolation behavior.

### Phase 5: HTTP CRUD, Start freeze, and preview

- [ ] Add OpenAPI CRUD/preview schemas and route registrations.
- [ ] Add stable error codes, 201/200/404/409 behavior, summary-list/full-detail responses, size limits, scoped mutation, and nullable creator provenance.
- [ ] Parse `envId` in both Start content types before file/message persistence, freeze the row, and pass it out-of-band.
- [ ] Update the unwired Start schema documentation and route description.
- [ ] Implement cwd-rooted discovery, current-user profile resolution, canonical identity check, targets, skips, and resolved preview.
- [ ] Update all API test mocks affected by the new imports.

Exit gate: route tests cover auth-gated normal registration, JSON/multipart parity, no-ENV behavior, identity errors, CRUD conflict/mismatch cases, preview cwd semantics, and safe failures.

### Phase 6: Console Start and management

- [ ] Add generated-type-based ENV skills and encoded cache keys.
- [ ] Extend `startRun()` JSON and multipart shapes.
- [ ] Add picker, loading/error states, race-safe preview, skip warnings, workflow-change reset, and Start gating.
- [ ] Add server-driven target/field management, full-map PATCH, conflict/delete behavior, cache invalidation, and plaintext-storage notice.

Exit gate: unit/component tests cover request shapes, stale response races, selection reset, disabled-on-error behavior, allowed-field rendering, and full-map replacement.

### Phase 7: Run detail, docs, and generated files

- [ ] Defensively map pending/complete overlay metadata into the console `Run` primitive.
- [ ] Add the header chip, resolved-request table, skip warnings, and accurate capability/final-model copy.
- [ ] Document CRUD, Start JSON/multipart, preview, install-wide identity, field matrix, include ids, group-body exclusion, resume semantics, error channels, size bounds, plaintext storage, and the absence of CLI selection.
- [ ] Call out the `loop_group.model` behavior correction in the PR's review guidance/release-note input; leave `CHANGELOG.md` to the repository's release workflow.
- [ ] Regenerate OpenAPI types with the server running.
- [ ] Update the application-table inventory.

Exit gate: generated files are clean, docs examples match route handlers, and malformed/legacy metadata does not break run detail.

### Phase 8: Full validation and manual acceptance

- [ ] Run focused tests during each phase from the owning package. Add a separate `bun test <file>` package-script segment only where conflicting `mock.module()` calls require process isolation.
- [ ] Run all package tests via `bun run test` from the repository root; never run root `bun test`.
- [ ] Run `bun run validate` before PR.
- [ ] Run `bun run check:schema-upgrades` against live PostgreSQL. This is mandatory for this schema change, not an optional follow-up.
- [ ] Manually exercise create/edit/select/preview/start/detail/resume/delete in the console with JSON and multipart Start paths.

## Required Test Matrix

### Engine

- Schema accepts every allowed value/shorthand and long include-expanded ids; it rejects unsafe/reserved target keys, unknown patch keys, empty per-node patches, over-256 targets, and over-1-MiB documents.
- Stored-overlay schema accepts both strict pending and complete forms and rejects partial/corrupt hybrids.
- Prompt/command/loop/group/bash accept exactly the matrix above; every unsupported combination fails safely.
- Empty/whitespace prompt and bash apply and remain byte-for-byte unchanged; non-string bodies fail.
- Unknown target ids are skipped and sorted; an incompatible existing id fails.
- `quality__review` include id applies; unexpanded `review` skips.
- Group body ids skip as patch targets; their qualified ids appear in resolved output.
- Resolved output includes unpatched direct/loop/group-body provider turns, excludes group containers and deterministic nodes, and reports a latent resolution error consistently in Preview and Start.
- Dangling output refs introduced through prompt/bash fail graph validation.
- Original discovered object and both symbol payloads remain unchanged after ENV A, ENV B, and no-ENV reuse.
- Mutating the caller's patch/thinking object after apply changes neither the patched workflow nor the applied descriptor.
- Resolution equals `node_started` for direct nodes and loops across node/workflow/preset/assistant precedence.
- Group model/provider reaches body nodes for ordinary YAML and overlay, including nested groups.

### Database/core

- Fresh SQLite contains the table/index; PostgreSQL parser parity finds all seven columns.
- Upgrade and idempotent reapply succeed from every shipped schema baseline.
- Name validation, empty map, bounds, JSONB/TEXT normalization, create/list/get/update/delete, and exact unique conflict classification.
- Corrupt full rows throw the typed id-only error; summary listing remains independent of patch parsing.
- PATCH replaces the map; `{}` is allowed as a replacement; empty PATCH body is rejected.
- Mismatched workflow path cannot update/delete another row.
- Atomic run metadata replacement drops stale resolved/latest-missing keys and preserves unrelated metadata in both SQL shapes; run-not-found throws.
- Store adapter exposes the required method and delegates it exactly.

### Dispatch/execution

- Omitted ENV leaves the same cached definition byte-for-byte.
- Fresh ENV patch reaches provider/bash execution while the cached source stays unchanged.
- Fresh orchestrator application rejects incompatible fields, explicit unknown providers, invalid patched nodes, and invalid graphs before isolation.
- Missing start-time id proceeds, is omitted from frozen patches, and never starts applying after YAML later adds that id.
- Originally applied id missing on resume appears in `latestMissingNodeIds` without mutating frozen patches.
- ENV edit/delete after Start does not affect resume or retry.
- Fresh foreground, background pre-create, and fallback INSERT rows already contain the pending filtered patch descriptor before the complete snapshot update; capture the INSERT argument and reparse the stored pending form to prove no patch data gap.
- Resume recomputes alias/tier metadata for an unpatched `model: large` node from the current live profile and `sendQuery` uses that live resolution, never the old persisted `resolved` object.
- Overlay-bearing direct resume/retry/recovery uses the pre-created row's `user_id` for profile and credential resolution even when its caller omits or supplies a different `userId`; a null row owner remains config-only.
- Audit write failure produces no `workflow_started`, `node_started`, bash/script process, or `sendQuery`; when the fail-status write succeeds the row is recoverable as `failed`, and a double-write failure is critically logged without a later automatic orphan mutation.
- Orchestrator resume, direct CLI-style resume, CLI-style node retry, web node retry, child recovery, and parent auto-resume restore correctly.
- Parent ENV is absent from fresh child run metadata while the parent run owner remains the child's `user_id`.

### HTTP

- CRUD statuses and stable error bodies, valid workflow name/length, summary list without patches, scoped full detail, full replacement, workflow scoping, nullable creator.
- Start no-ENV, JSON ENV, multipart ENV, malformed/duplicate env id, missing id, row/path mismatch, and corrupt stored row before side effects.
- ENV identity failure occurs before upload/message persistence.
- Start passes a frozen copy; later mocked store mutation does not change context data.
- Preview accepts a registered root and descendant cwd, rejects unrelated/missing cwd, resolves canonical name, and returns targets/resolved/skips.
- Preview uses user tiers/aliases and matches the snapshot produced by an immediate unchanged Start.
- Preview errors never echo prompt/bash content.
- OpenAPI contains CRUD and preview schemas while Start retains the documented multipart exception.

### Console

- `startRun` sends/omits `envId` correctly for JSON and multipart.
- Workflow switch clears ENV/preview/input values.
- A list failure still permits an explicit None/YAML Start; selected ENV detail or preview failure prevents accidental YAML-only Start.
- Old preview response cannot replace a newer selection.
- Manager renders server-allowed fields, full-map PATCH, conflict, delete, and invalidation.
- Run primitive accepts pending/complete/legacy/malformed metadata without throwing.
- Header/table/warnings render correct labels and do not expose prompt/bash bodies.

## Acceptance Criteria

- [ ] An operator can create a named ENV, select it, preview it, and start a run from the console without changing YAML.
- [ ] With no ENV selected, overlay discovery/isolation/metadata paths behave as before; the only execution difference is the documented `loop_group.model` forwarding bug fix.
- [ ] Only the verified node-field matrix can alter execution; graph and nested execution structure cannot be patched.
- [ ] A selected ENV modifies a clone and cannot contaminate later runs from the discovery cache.
- [ ] On a fresh orchestrator dispatch, overlay application errors—unsupported fields, an explicit unknown provider, invalid patched nodes, or invalid graph references—fail before isolation; live profile/model-resolution errors fail before workflow events or nodes but may occur after isolation. Missing ids are visibly skipped.
- [ ] Start freezes exactly the row it read. ENV edits/deletion cannot change an existing run.
- [ ] Every resume/retry surface reapplies the frozen snapshot and never queries the live ENV table.
- [ ] Overlay-bearing resume/retry resolves live preferences and credentials for the run's stored owner, never an omitted or different requester option; no-overlay identity behavior remains unchanged.
- [ ] Originally skipped ids never begin applying on later YAML revisions.
- [ ] Latest whole-workflow resolved-request metadata is atomically persisted before execution and matches the persisted `node_started` request fields for every listed provider-turn node that executes.
- [ ] A failed audit write prevents node execution.
- [ ] `loop_group` provider/model defaults actually reach body nodes; group effort/thinking remain unsupported.
- [ ] Child sub-runs do not inherit the parent ENV.
- [ ] CRUD and preview are OpenAPI-documented; JSON/multipart Start documentation is accurate.
- [ ] SQLite fresh-install/parity/integration tests and PostgreSQL upgrade/idempotence checks pass.
- [ ] Console UI accurately labels preview versus persisted request metadata versus provider-reported final model.
- [ ] Logs, errors, and the resolved table contain no prompt/bash bodies.
- [ ] `bun run validate` and `bun run check:schema-upgrades` pass.

## Validation Commands

Run focused commands from each package while implementing, then the release gates from the root:

```bash
# workflows
cd packages/workflows
bun test src/schemas/env-overlay.test.ts src/env-overlay.test.ts
bun test src/node-model-resolution.test.ts
bun test src/dag-executor.test.ts
bun test src/executor.test.ts
bun test src/subrun.test.ts
bun test src/executor-preamble.test.ts
bun test src/script-node-deps.test.ts
bun x tsc --noEmit

# core
cd ../core
bun test src/schemas/workflow-env.test.ts
bun test src/db/workflow-envs.test.ts src/db/workflows.test.ts
bun test src/db/workflows.env-overlay.integration.test.ts
bun test src/db/adapters/sqlite.test.ts src/db/migration-statement-order.test.ts src/db/bundled-schema.test.ts
bun test src/workflows/store-adapter.test.ts
bun test src/orchestrator/orchestrator.test.ts
bun test src/orchestrator/orchestrator-agent.test.ts
bun test src/orchestrator/orchestrator-isolation.test.ts
bun x tsc --noEmit

# server
cd ../server
bun test src/routes/api.workflow-envs.test.ts
bun test src/routes/api.workflow-runs.test.ts
bun test src/routes/api.workflows.test.ts
bun x tsc --noEmit

# web
cd ../web
bun test src/experiments/console/skills/startRun.test.ts
bun test src/experiments/console/skills/workflowEnvs.test.ts
bun test src/experiments/console/primitives/run.test.ts
bun test src/experiments/console/components/DraftRunCard.test.tsx
bun test src/experiments/console/components/WorkflowEnvPicker.test.tsx
bun test src/experiments/console/components/WorkflowEnvManageDialog.test.tsx
bun test src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx
bun test src/experiments/console/components/RunDetailHeader.test.tsx
bun x tsc --noEmit

# generated files and repository gates
cd ../..
bun run generate:bundled-schema
# In another shell: bun run dev:server
bun --filter @archon/web generate:types
bun run check:bundled-schema
bun run check:schema-upgrades
bun run validate
git diff --check
```

Do not paste these examples into a shell as one uninterrupted block without managing the server process used for type generation.

## Deployment, Compatibility, and Rollback

- The migration is additive and is applied by the existing startup schema path; no manual SQL or backfill is required. No existing row changes and no down migration is permitted.
- Roll out the server and any CLI binary that can access the same database together. Until all such executors are upgraded, do not use ENV on resumable work; a pre-feature CLI cannot understand the snapshot and cannot be made safe by the additive schema alone.
- Old binaries ignore the new table and unknown run metadata; they do not drop it. However, a pre-feature binary will also ignore an overlay snapshot when resuming a run. Before rolling back, finish or abandon every overlay-bearing run in `pending`, `running`, `paused`, or `failed`; do not resume one with the old binary. Identify them with `metadata ? 'envOverlay'` on PostgreSQL or `json_type(metadata, '$.envOverlay') IS NOT NULL` on SQLite, plus that explicit status set.
- Existing runs without overlay metadata continue unchanged. New code treats absent metadata as YAML-only.
- ENV deletion affects only future starts; run snapshots remain self-contained.
- The snapshot freezes the ENV delta, not the entire workflow/config/profile. Resume intentionally applies that delta to the current discovered YAML and recomputes resolution; missing nodes are reported and incompatible type changes fail closed.
- ENV names and patches are last-write-wins. Preview/Start and concurrent editor races are accepted and disclosed; the run snapshot shows what won.
- Prompt/bash bodies and snapshots are plaintext database content and are returned by existing open-within-install APIs. They must not be used for secrets. The current auth gate remains the security boundary.
- Each selected run duplicates at most 1 MiB of patch data into run metadata. Clone/apply/resolution use bounded linear passes over workflow nodes plus patch entries and occur only for selected/resumed ENV runs. List responses omit patch bodies, detail reads one body, and no per-node database queries are allowed.
- Rollback leaves the additive table in place. A later forward deployment reuses it. Do not attempt to remove its rows or columns.

## Final Design Audit

| Perspective | Result and gate |
| --- | --- |
| Product outcome | Directly supports named workflow variants and comparison runs without duplicating YAML; experiment orchestration remains out of scope. |
| Architecture | Logic lives at the correct layers: pure apply/resolution in workflows, persistence in core, transport in server, presentation in web. No new YAML feature or reverse package dependency. |
| Contracts | Field matrix matches loader/executor behavior; HTTP, snapshot, preview, and node-event meanings are distinguished. |
| Safety and integrity | Clone preserves private symbols, structural apply errors on fresh orchestrator starts stop before isolation, model-resolution/audit errors stop before workflow events or nodes, exact JSON replacement prevents stale keys, and resume never reads mutable ENV rows. |
| Performance | One indexed ENV lookup, bounded linear clone/validation/resolution passes, one atomic metadata write, bounded patch size, and no per-node I/O. |
| Lifecycle completeness | Fresh foreground/background, orchestrator resume, direct retry/resume, child recovery, and parent auto-resume are covered through an executor backstop. |
| Testability | Unit, dialect, integration, dispatch-order, API, UI, full validation, and PostgreSQL upgrade tests each prove a distinct invariant. |
| Operations | Additive schema, no backfill, explicit old-binary resume warning, safe persistent table on rollback, and accepted last-write-wins race are documented. |
| Simplicity | One ENV table, one allowlist/matrix, one clone/apply module, one shared resolution path, and one nested metadata replacement method; no feature flag, ACL layer, experiment engine, or custom expression language. |

## Remaining Known Risks

- Preview can become stale before Start; this is intentional and visible.
- Selecting even an empty ENV eagerly validates resolution for every provider-turn node so the whole-workflow audit table cannot lie; this can surface a latent error in a conditionally skipped node that a no-ENV run would not reach.
- Install-wide workflow-name identity means source-shadowed workflows can have different node sets. Skip/type validation and canonical-name defense make this safe, but operators must inspect preview per project.
- Correcting loop-group model forwarding changes existing workflows that declared a group model but were unknowingly receiving the outer model. The regression tests and release notes must call out this bug fix.
- Last-write-wins CRUD can overwrite another operator's concurrent edit. This is acceptable for v1; add revision-based concurrency only after a demonstrated need.
- The summary list is unpaginated. It excludes large patch bodies and is adequate for the expected small per-workflow ENV set; add cursor pagination only if observed ENV counts justify it.
- A database outage can make both the audit snapshot write and the subsequent fail-status write fail. Execution still stops, but the row may remain ambiguously non-terminal and requires the existing explicit operator lifecycle action.
- Mixed-version execution—or rolling back while overlay-bearing runs remain resumable—is unsafe because the old executor cannot replay their snapshots. The deployment/version check above is mandatory.

No unresolved design question blocks implementation.

## Convergence

The following tasks were added by the 2026-09-05 skeptical converge review. Complete them in order. For every task, write the named failing regression first, confirm it fails for the stated reason, make the smallest scoped correction, and then run the listed focused command. After all tasks, run the existing Phase 8 gates; do not treat earlier Ralph claims as validation evidence for the corrected tree.

1. **[HIGH][contradicts] Ignore even an invalid newly selected ENV when a run genuinely resumes.** Source refs: Authoritative Contract 10, steps 1–3 (lines 362–364), Phase 4 (lines 554–564), and the dispatch matrix (lines 634–646). In `packages/core/src/orchestrator/orchestrator-agent.test.ts`, first add a regression in which a paused resumable run owns a valid stored ENV (and a second YAML-only case), the new request candidate contains a field incompatible with the current node, hydration returns a real resume payload, and the run still resumes with its stored selection/YAML plus the ignored-ENV notice. Also cover the hydrate-null branch so it remains a fresh start whose request candidate is rejected before isolation. Then refactor `packages/core/src/orchestrator/orchestrator-agent.ts` (and `packages/core/src/orchestrator/env-overlay-dispatch.ts` only if its pure contract needs adjustment) so `resolveFreshDispatchEnvOverlay()` cannot reject a candidate that Contract 10 says is ignored, while preserving the pre-isolation rejection guarantee for a hydrate-null fresh fallback. Acceptance: a genuine continuation never validates or applies the request candidate; it restores only `metadata.envOverlay`, or YAML when absent; hydrate-null still uses and validates the request candidate as a fresh run before isolation; messages/logs contain ids/names/codes only. Verify with `cd packages/core && bun test src/orchestrator/env-overlay-dispatch.test.ts && bun test src/orchestrator/orchestrator-agent.test.ts`.

2. **[HIGH][partial][hidden] Pass the complete runtime resolution context to ENV Preview and snapshot builders.** Source refs: Authoritative Contract 4 (lines 177–187), Preview (lines 329–352), and executor snapshot steps (lines 388–396). First add regressions to `packages/workflows/src/executor.test.ts` and `packages/server/src/routes/api.workflow-envs.test.ts` using `assistants.<provider>.modelReasoningEffort` with no portable effort, and a workflow-level `thinking` fallback, and assert that Preview and `metadata.envOverlay.resolved` equal the request fields emitted by runtime `node_started`. Then update both call sites in `packages/workflows/src/executor.ts` and `packages/server/src/routes/api.ts` to pass every `ResolveNodeExecutionOptions` input used by `resolveNodeProviderAndModel()`—including `assistants: config.assistants` and the effective workflow thinking—instead of `{ aiProfile }` alone. Keep `packages/workflows/src/node-model-resolution.ts` as the single pure computation path; do not add another approximation. Acceptance: the unchanged Preview response, stored snapshot row, runtime send options, and persisted `node_started` fields all include the same legacy fallback/thinking values for top-level and nested group turns. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/executor.test.ts && bun test src/dag-executor.test.ts`, then `cd ../server && bun test src/routes/api.workflow-envs.test.ts`.

3. **[HIGH][contradicts][hidden] Make rejected preset effort warn/drop while explicit portable effort remains fatal.** Source refs: Authoritative Contract 4 (lines 179–182) and Phase 1 exit gate (lines 518–528). First add a failing `packages/workflows/src/node-model-resolution.test.ts` case for an OpenCode tier/alias preset carrying `effort: high`, plus a `packages/workflows/src/dag-executor.test.ts` runtime case. Prove the preset path returns `presetEffortDropped: true`, omits applied/metadata effort, and reaches the existing warning layer, while a node/workflow-authored explicit effort on the same provider still throws. Then correct `resolveNodeExecutionRequest()` in `packages/workflows/src/node-model-resolution.ts`: the explicit capability failure check must not fold `preset?.effort` into `declaredEffort`, otherwise the later `resolvePresetEffort()` decision is unreachable. Keep `packages/workflows/src/dag-executor.ts` consuming the structured decision. Acceptance: rejected preset effort is never sent or recorded as applied, produces the existing id/value-only warning, and is consistent in Preview, selected-run eager resolution, and ordinary lazy runtime; explicit portable effort still fails closed. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/dag-executor.test.ts`.

4. **[HIGH][partial] Make the console editor preserve valid empty ENV and empty body values.** Source refs: Node-field compatibility (line 104), patch validation (lines 114–122), Manage dialog (lines 416–427), and Console test matrix (lines 660–668). First extend `packages/web/src/experiments/console/lib/workflow-env-editor.test.ts` with round trips for zero drafts → `{}`, explicit `prompt: ''`, explicit `bash: ''`, whitespace-only bodies, and absent body fields; extend `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.test.tsx` to prove create and full-map PATCH can submit `{}` and can save an explicitly enabled empty body. Then update `packages/web/src/experiments/console/lib/workflow-env-editor.ts` and `packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx` so the draft model distinguishes “field omitted” from “field present with an empty string”; retain the non-empty-per-chosen-node rule and do not treat a workflow with zero targets as an error when the operator is saving a no-op ENV. Acceptance: create/update can send `patches: {}`; stored `prompt: ''` and `bash: ''` survive edit/save byte-for-byte; whitespace stays unchanged; untouched body controls remain omitted. Verify with `cd packages/web && bun test src/experiments/console/lib/workflow-env-editor.test.ts && bun test src/experiments/console/components/WorkflowEnvManageDialog.test.tsx`.

5. **[HIGH][partial] Reject unknown patch keys defensively inside `applyEnvOverlay()`.** Source refs: Patch validation and bounds (line 112), Clone/apply behavior (lines 194–205), and Engine test matrix (lines 607–619). First add a `packages/workflows/src/env-overlay.test.ts` regression that deliberately bypasses the Zod boundary with a mixed patch such as `{ model: 'x', typo: 'secret-value' }` on an existing node and asserts a safe `forbidden_field` error with the unknown field name but not its value. Then update `packages/workflows/src/env-overlay.ts` so validation inspects the original raw patch keys before `copyNodePatch()` can discard them; keep the detached normalized copy for assignment and snapshotting. Acceptance: mixed known/unknown raw patches cannot silently succeed, normal schema-validated patches behave unchanged, and error/log text never includes prompt/bash or unknown-field values. Verify with `cd packages/workflows && bun test src/env-overlay.test.ts src/schemas/env-overlay.test.ts`.

6. **[MEDIUM][partial] Omit ENV run-detail UI for malformed pending/complete metadata instead of presenting false audit state.** Source refs: Runtime overlay types (lines 126–160), Run detail (lines 429–438), and Console test matrix (lines 667–668). First change `packages/web/src/experiments/console/primitives/run.test.ts` to require `null` for malformed hybrids: missing/non-object `patches`, non-array `skippedNodeIds`/`latestMissingNodeIds`, non-object `resolved`, or any invalid resolved row. Add `packages/web/src/experiments/console/routes/RunDetailPage.test.tsx` coverage proving no ENV chip/table appears for such input while the rest of the run renders, and keep valid pending/complete rendering assertions in `packages/web/src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx` and `RunDetailHeader.test.tsx`. Then tighten `parseRunEnvOverlay()` in `packages/web/src/experiments/console/primitives/run.ts`; keep valid strict pending and complete shapes, never expose patch bodies, and let `RunDetailPage.tsx` continue rendering only a non-null parsed overlay. Acceptance: malformed/legacy metadata cannot manufacture `complete: true`, cannot produce the misleading “No provider-turn request rows” state, and cannot crash or hide the rest of run detail. Verify with `cd packages/web && bun test src/experiments/console/primitives/run.test.ts && bun test src/experiments/console/routes/RunDetailPage.test.tsx && bun test src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx`.

7. **[MEDIUM][contradicts] Make workflow-ENV name-conflict classification exact.** Source refs: Store contracts (line 263) and Database/core test matrix (lines 623–632). First extend `packages/core/src/db/workflow-envs.test.ts` with negative cases for: PostgreSQL `23505` whose constraint is absent/wrong even if the message mentions `uq_workflow_envs_workflow_name_name`; the same duplicate-key prose without code `23505`; and a SQLite UNIQUE error for another table that happens to have `workflow_name` and `name` columns. Then tighten `isWorkflowEnvNameConflict()` in `packages/core/src/db/workflow-envs.ts` to return true only for PostgreSQL `code === '23505' && constraint === 'uq_workflow_envs_workflow_name_name'`, or for the SQLite message naming both fully qualified ENV identity columns. Acceptance: only the named identity constraint maps to `WorkflowEnvNameConflictError`/HTTP 409; unrelated DB failures propagate to their normal error path. Verify with `cd packages/core && bun test src/db/workflow-envs.test.ts`.

## Convergence 2

The following tasks were added by the second 2026-09-05 skeptical converge review after inspecting the present implementation and its callers. They supplement, rather than replace, the first Convergence section. Continue the same red-green discipline and complete these in order; several tasks deliberately extend an earlier task with an uncovered edge case.

8. **[CRITICAL][missing] Add the mandatory Constitution Check evidence to this implementation plan.** Source refs: `.specify/memory/constitution.md`, Plan Quality Gate (lines 154–156), plus this plan's Pre-Implementation Gate and Final Design Audit. Append a retrospective pre-Phase-0 check and a current post-design re-check that explicitly evaluate package-layer direction, typed/OpenAPI schema rules, additive schema and generated-file handling, fail-closed lifecycle behavior, secret-safe audit metadata, focused/full validation, and any intentional complexity. For every gate, record concrete repository evidence, any violation, its accepted-use justification, and rollback/simplification path; do not merely claim PASS. Acceptance: reviewers can determine from the plan alone which constitutional constraints were evaluated at both required times, and every unresolved violation is explicitly marked as a release blocker. Verify the documentation change with `git diff --check` and a manual comparison to the constitution's Plan Quality Gate.

9. **[CRITICAL][contradicts][hidden] Do not claim a resumable run before conversation and isolation gates have succeeded.** Source refs: Authoritative Contract 10 (lines 360–367), Phase 4 lifecycle ordering (lines 554–564), and the dispatch matrix (lines 634–646). `hydrateResumableRun()` currently calls `resumeWorkflowRun()` before returning, while `orchestrator-agent.ts` invokes it early whenever an ENV candidate accompanies a possible continuation. First add regressions to `packages/core/src/orchestrator/orchestrator-agent.test.ts` for a paused run plus any supplied ENV id where (a) `updateConversation()` fails and (b) isolation returns `IsolationBlockedError`; assert the run is never transitioned to `running`, execution is not invoked, and the original paused/failed state remains resumable. Then split read-only eligibility/snapshot inspection from the compare-and-set resume claim (updating `packages/workflows/src/executor.ts` and its tests if needed), and perform that claim exactly once only after all pre-execution conversation and isolation gates succeed. Preserve the hydrate-null fresh-start behavior and the rule that a genuine continuation ignores the request candidate. Acceptance: no return/throw between eligibility discovery and executor dispatch can strand a run as `running`; the eventual claim remains atomic and rejects a concurrent claimant. Verify with `cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts`, then `cd ../workflows && bun test src/executor.test.ts`.

10. **[HIGH][partial][hidden] Fail an overlay-bearing pre-created run when executor preamble resolution throws.** Source refs: Authoritative Contracts 4 and 10 (lines 177–187 and 360–367), Phase 4 executor snapshot ordering (lines 388–396), and background dispatch (lines 372–384). First add an executor regression with an overlay-bearing `preCreatedRun` and a broken repo tier/alias layer (or another deterministic workflow-scope resolution failure) that throws after `prepareExecutionEnvOverlay()` but before the run/event block; assert `failWorkflowRun()` is called once and no snapshot, workflow event, or DAG node is emitted. Add a background-orchestrator regression proving an already-created pending row does not remain pending for that failure. Then place config/profile/scope/provider eager resolution for active overlays inside an executor-owned fail-closed boundary; keep no-overlay behavior unchanged and do not rely on the background caller's log-only catch to repair state. Acceptance: every exception after an overlay-bearing row exists either returns before claiming it or leaves it terminally failed, with an id/name/code-only user message and no execution events. Verify with `cd packages/workflows && bun test src/executor.test.ts`, then `cd ../core && bun test src/orchestrator/orchestrator.test.ts`.

11. **[HIGH][contradicts] Enforce the exact absent/empty/non-string `envId` HTTP contract.** Source refs: HTTP API contract (lines 304–319), Preview semantics (lines 329–352), Start semantics (lines 354–384), and Server/API test matrix (lines 646–659). First add a Preview regression in `packages/server/src/routes/api.workflow-envs.test.ts` proving `?envId=` returns the YAML-only baseline without an ENV lookup, and Start regressions in `packages/server/src/routes/api.workflow-runs.test.ts` proving JSON `{ "envId": null }` and other non-string values return `400 { error: 'invalid_env_id' }` before lookup or dispatch. Then adjust the Preview query schema so empty reaches the documented baseline handler, and make `parseOptionalEnvIdField()` treat only absent or empty strings as omission—never JSON null. Retain duplicate/non-string multipart rejection. Acceptance: omitted/empty string is YAML-only on Preview and Start, every present non-string is 400, and neither rejected nor baseline cases read a mutable ENV unnecessarily. Regenerate the checked-in web API types if the OpenAPI shape changes. Verify with `cd packages/server && bun test src/routes/api.workflow-envs.test.ts && bun test src/routes/api.workflow-runs.test.ts`, followed by the focused generated-type check required by the repository.

12. **[HIGH][partial] Return stable workflow-ENV error codes when OpenAPI body validation fails before the handler.** Source refs: HTTP API contract (lines 304–327), Phase 5 CRUD routes (lines 566–570), and Server/API test matrix (lines 646–655). First extend `packages/server/src/routes/api.workflow-envs.test.ts` with exact-body assertions for an invalid ENV name, unknown node patch field, empty per-node patch, over-256-node patch map, over-1-MiB request, and empty PATCH body; assert `400 { error: 'invalid_env_request', detail: <safe summary> }` and prove prompt/bash/unknown-field values are absent. Then add route-scoped validation mapping compatible with `registerOpenApiRoute()` so request-schema failures cannot be converted by the global default hook into field-path prose before the handler. Do not alter unrelated routes' validation bodies. Acceptance: every planned ENV validation failure has a stable machine-readable code, safe optional detail, correct 409 conflict behavior, and no secret-bearing value echo. Regenerate checked-in API types only if the schema changes. Verify with `cd packages/server && bun test src/routes/api.workflow-envs.test.ts`.

13. **[HIGH][partial] Let the mounted ENV manager create and replace with a valid no-op patch map.** Source refs: Node-field compatibility (line 104), Manage dialog behavior (lines 416–427), Console test matrix (lines 660–668), and Convergence task 4 above. The helper accepts zero drafts, but `WorkflowEnvManageDialog.tsx` currently rejects every submit when `targets.length === 0`. First replace the helper-only assertions in `WorkflowEnvManageDialog.test.tsx` with mounted create and edit flows for a workflow with no editable targets (and an edit whose patches are all removed); resolve workflow-detail loading, submit, and assert POST/PATCH receives `{ patches: {} }`. Then make submit distinguish “target discovery is still loading/failed” from “discovery succeeded with zero targets”; only the former blocks. Acceptance: the dialog copy promising a no-op ENV is true, create and full-map replacement can persist `{}`, and loading/error states still cannot overwrite an ENV accidentally. Verify with `cd packages/web && bun test src/experiments/console/components/WorkflowEnvManageDialog.test.tsx src/experiments/console/lib/workflow-env-editor.test.ts`.

14. **[MEDIUM][missing] Add the plan-required component regressions for picker/start wiring and workflow-switch races.** Source refs: Preview/Start wiring (lines 392–415), race/reset requirements (lines 458–463), Phase 6 exit gate (lines 573–584), and Validation commands (lines 729–733). Create `packages/web/src/experiments/console/components/WorkflowEnvPicker.test.tsx` and `DraftRunCard.test.tsx`; pure `lib/draft-env.test.ts` coverage is not a substitute for component behavior. Mount with controlled asynchronous list/detail/preview responses and prove: None is the default; a retained selected id may display its own load/error state; changing workflow resets ENV and inputs immediately; a stale prior-workflow response cannot replace the current options/preview; selected-ENV loading or error retains selection and disables Start; list failure still permits None/YAML-only Start; and the outbound Start payload omits `envId` for None but includes it when selected. Acceptance: both named test files exist and exercise the rendered components/network boundary, not only extracted reducers. Verify with `cd packages/web && bun test src/experiments/console/components/WorkflowEnvPicker.test.tsx src/experiments/console/components/DraftRunCard.test.tsx src/experiments/console/lib/draft-env.test.ts`.

15. **[HIGH][partial][hidden] Validate raw patch keys even when the target node no longer exists.** Source refs: Patch validation and bounds (lines 110–122), Clone/apply behavior (lines 194–205), and Engine test matrix (lines 607–619), plus Convergence task 5 above. First extend `packages/workflows/src/env-overlay.test.ts` with a schema-bypassing patch for a missing node such as `{ missing: { typo: 'secret-value' } }`; assert safe `forbidden_field` failure mentioning only the key, while a missing-node patch containing only allowed fields still succeeds and reports the node as skipped. Then move raw-key validation ahead of the missing-node early continue in `applyEnvOverlay()`. Acceptance: node disappearance does not create a defensive-validation bypass, and missing valid patches retain the intended skip semantics without leaking values. Verify with `cd packages/workflows && bun test src/env-overlay.test.ts src/schemas/env-overlay.test.ts`.

16. **[HIGH][partial][hidden] Keep audit/Preview parity for programmatic workflows using legacy `modelReasoningEffort`.** Source refs: Authoritative Contract 4 (lines 177–187), Preview (lines 329–352), executor snapshot steps (lines 388–396), and the plan's requirement that unexpanded programmatic definitions behave consistently. First add `packages/workflows/src/node-model-resolution.test.ts` and `executor.test.ts` cases for an unexpanded workflow with workflow-level `modelReasoningEffort` but no portable `effort`; compare the resolved scope/snapshot row to the runtime `node_started` and provider request fields. Then extend the shared workflow-scope resolver input/fallback to use `workflow.effort ?? workflow.modelReasoningEffort`, matching the existing DAG runtime fallback; do not add a second resolver. Acceptance: loader-normalized YAML and programmatic legacy definitions produce the same effective effort in Preview, stored snapshot, node event, and provider request. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts src/executor.test.ts src/dag-executor.test.ts`.

17. **[MEDIUM][partial][hidden] Make the run-detail ENV parser strict for present optional fields and unknown keys.** Source refs: Runtime overlay types (lines 126–160), Run detail behavior (lines 429–438), Console test matrix (lines 667–668), and Convergence task 6 above. First add `packages/web/src/experiments/console/primitives/run.test.ts` cases where a resolved row has a present non-string `model`, invalid `tier`, invalid `effort`, malformed/unsupported `thinking`, or an unexpected key, plus a complete overlay object with an unexpected top-level key; each must parse to `null`. Then tighten the local web parser to require the exact pending/complete shapes and exact resolved-row field types without importing runtime code from `@archon/workflows`. Acceptance: malformed present fields cannot be silently dropped to manufacture a valid-looking provider-only row, valid metadata remains unchanged, and run detail omits only the corrupt ENV section. Verify with `cd packages/web && bun test src/experiments/console/primitives/run.test.ts src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx`.

## Constitution Check

_GATE source: `.specify/memory/constitution.md` Plan Quality Gate (lines 154–156) and Compliance review (lines 172–175). Template: `.specify/templates/plan-template.md` § Constitution Check._

This section is the mandatory plan evidence that was missing at design time (Convergence 2 task 8). It records a **retrospective pre-Phase-0 check** (what the design claimed before implementation) and a **current post-design re-check** (what the repository actually contains after Phases 1–7 + Convergence 1). Every gate lists concrete evidence, any violation, accepted-use justification, and a rollback/simplification path. Generic “PASS” alone is insufficient.

**Release-blocker rule:** any unresolved constitutional violation blocks PR readiness (constitution lines 172–175). Open Convergence 2 implementation gaps that violate lifecycle safety are called out explicitly below; they remain blockers until their stories land.

---

### A. Retrospective Pre-Phase-0 Constitution Check

_Recorded as of the plan’s Authoritative Contracts + Files + Final Design Audit, before engine/store/API/console code existed. Evidence is the plan text itself._

| Gate | Verdict | Concrete plan evidence | Violation? | Accepted-use justification | Rollback / simplification path |
| --- | --- | --- | --- | --- | --- |
| **I. Single-developer scope** | PASS with documented non-goals | Outcome (lines 9–17); Non-Goals (plan product section + PRD non-goals): no multi-tenant ACL, no per-project ENV identity, no CLI/chat selection, no experiment matrix, no optimistic locking, no feature flag. `created_by_user_id` is provenance only (Persistence §7, HTTP §9). | None. Open-within-install visibility retained. | N/A | Drop the feature; table is additive and unused when no ENV is selected. |
| **II. Package-layer direction** | PASS by design | Files (lines 440–514): pure apply/resolution in `@archon/workflows`; CRUD + run metadata in `@archon/core`; OpenAPI transport in `@archon/server`; console presentation in `@archon/web`. Explicit ban: “Do not modify workflow YAML schemas… not workflow-language surface” (line 514). Web must not import `@archon/workflows`. Engine receives store via `IWorkflowStore` / `WorkflowDeps`, not core imports. | None designed. | N/A | Delete planned packages’ ENV modules; no reverse dependency to unwind. |
| **III. Typed / OpenAPI schema rules** | PASS by design | Engine schemas in `packages/workflows/src/schemas/env-overlay.ts`; core row schemas in `packages/core/src/schemas/workflow-env.ts`; route schemas in `packages/server/src/routes/schemas/workflow-env.schemas.ts`. Contracts require `z` from `@hono/zod-openapi`, `z.infer`, explicit `z.record`, `.strict()` patch docs, `registerOpenApiRoute` for CRUD/preview. Start retains the existing multipart/manual-parse exception (HTTP §9 / Start contract) — same exception as conversation message routes, not a new bypass. | None. Multipart Start is a documented exception, not a waiver of typed contracts. | N/A | Remove ENV routes/schemas; Start `envId` field is optional and omittable. |
| **IV. Additive schema + generated files** | PASS by design | Persistence §7 (lines 217–245): ADD table `remote_agent_workflow_envs` after `usage_ledger`; indexes/comments in trailing migration section; SQLite `createSchema()` twin (not `migrateColumns`); inventory 21 + Better Auth 22–25; regenerate `bundled-schema.generated.ts` and `api.generated.d.ts`; no backfill; no down migration. | None. | N/A | Leave additive table in place on rollback (Deployment § lines 751–761); stop writing ENVs. |
| **IV/V. Fail-closed lifecycle** | PASS by design (with known residual ops risk) | Contract 10 (lines 354–398): apply before isolation; invalid overlay returns before isolation; pending metadata at first INSERT; complete snapshot via exact `setWorkflowRunEnvOverlay` before `workflow_started`/DAG; audit/resolution failure → fail closed, execute nothing; resume reads frozen run metadata only; ambiguous non-terminal after double DB failure is **not** auto-abandoned (lines 384, 786) — explicit operator action. | None designed. Residual: DB outage can leave non-terminal row (Known Risks) — constitutionally correct (no autonomous lifecycle mutation). | N/A | Disable ENV selection; abandon/finish overlay-bearing runs before binary rollback. |
| **VI. Secret-safe audit metadata** | PASS by design | Patch allowlist excludes secrets channels beyond plaintext prompt/bash bodies; bodies are install-visible plaintext (not encrypted) and **must not hold secrets** (Deployment + Console UX). Errors/logs: env id/name, applied/skipped ids, safe codes only — never patch values/prompt/bash (Contract 10 line 370; apply errors). List omits patches; run detail never renders bodies. | None as a secret store — feature explicitly refuses secret semantics. | N/A | Delete ENV rows; run snapshots retain historical plaintext until run delete. |
| **IV. Focused / full validation** | PASS by design | Required Test Matrix (lines 605–668) + Validation Commands (lines 691–747): package-isolated `bun test <path>` segments; `bun x tsc --noEmit` per package; root `bun run validate`; `bun run check:schema-upgrades`; explicit ban on root `bun test` as signal. | None. | N/A | N/A |
| **I/Simplicity intentional complexity** | WAIVED items tracked below | Final Design Audit (lines 764–776) + Remaining Known Risks. Complexity is bounded: one table, one matrix, one clone/apply module, one shared resolution path, one nested metadata replacement method. | See Complexity Tracking (pre-Phase-0). | See table. | See table. |
| **UI/brand** | PASS by design | Console-only v1; reuse existing dialog/card patterns (EnvVarsDialog-like manage shell); no new brand tokens required. | None. | N/A | Hide console ENV UI; routes can remain inert. |
| **Workflow Language Constitution** | PASS (out of surface) | Line 514: invocation/storage overlay, not YAML language. No new `when:`/node fields/workflow-level ENV key. | None. | N/A | N/A |

#### Complexity Tracking (pre-Phase-0 intentional complexity)

| Complexity | Why needed | Simpler alternative rejected | Rollback / simplification |
| --- | --- | --- | --- |
| Symbol-preserving clone (`cloneNodeWithEngineMetadata`) instead of `structuredClone` | Include/composed metadata and compiled loop payloads are symbol-keyed; `structuredClone` drops them (Verified Baseline line 24; Contract clone behavior). | `structuredClone` only | Revert to no-ENV path; no clone required when overlay absent. |
| Narrow `setWorkflowRunEnvOverlay` (jsonb_set / json_set) instead of `updateWorkflowRun` merge | SQLite `json_patch` deep-merges nested objects; stale `resolved` keys would survive complete snapshot replacement (Baseline lines 36–38; Store §8 lines 267–275). | Generic metadata merge | Stop writing overlays; method becomes unused. |
| Two-phase pending → complete `metadata.envOverlay` | Fresh FG/BG row creation timing: first INSERT must carry filtered patches before DAG; complete `resolved` needs live profile after setup (Contract 10 lines 386–394). | Single write after isolation only | Loses crash-window provenance; rejected because audit must exist at first row. |
| Install-wide `(workflow_name, name)` identity (not per-project) | Operators compare variants across checkouts of the same workflow name; per-project multiplies rows without v1 need (Non-Goals). | Per-codebase ENV table | Add project scope later; current unique constraint stays valid. |
| Out-of-band `EnvOverlayCandidate` (not NL command string) | Natural Language Is Not a Wire Format — ENV must not be grepped from prose (Contract 10; orchestrator handoff). | Embed env id in message text | Remove candidate field; YAML-only starts. |
| Fix `loop_group.model` forwarding as part of shared resolution | Existing runtime mismatch: group model parsed/documented but not forwarded (Baseline line 28; Contract 6). Shared resolution path makes lying audit impossible. | Leave group model inert | Revert group scope forwarding only; ENV feature still works for top-level nodes. |
| No per-resource ACL on ENV CRUD | Constitution I + existing open-within-install model; auth gate is install-wide API gate only (HTTP §9 line 279–281). | Role matrix per ENV | Not required; would violate single-developer simplicity. |

**Pre-Phase-0 unresolved constitutional violations:** none. Design was constitution-compatible on paper; the missing artifact was this evidence section itself (process gate, not product gate).

---

### B. Current Post-Design Re-Check

_Recorded 2026-09-05 after implementation through Convergence 1 (US-001–US-018) and before Convergence 2 code tasks. Evidence is live repository paths._

| Gate | Verdict | Concrete repository evidence | Violation? | Accepted-use justification | Rollback / simplification path |
| --- | --- | --- | --- | --- | --- |
| **II. Package-layer direction** | PASS | `packages/workflows/src/env-overlay.ts` + `schemas/env-overlay.ts` (pure engine; imports `@archon/providers` registry + local schemas only). `packages/core/src/db/workflow-envs.ts` + `schemas/workflow-env.ts` + `db/workflows.ts` (`setWorkflowRunEnvOverlay`). `packages/server/src/routes/schemas/workflow-env.schemas.ts` + `api.ts` CRUD/preview/Start. `packages/web/src/experiments/console/**` consumes `@/lib/api.generated` only; `primitives/run.ts` hand-parses overlay and documents “without importing `@archon/workflows`”. No workflow YAML schema ENV field. | None. | N/A | Revert ENV commits; additive table unused. |
| **III. Typed / OpenAPI schema rules** | PASS | Engine: `import { z } from '@hono/zod-openapi'`; types via `z.infer`; `z.record(z.string(), nodeExecutionMetadataSchema)` in snapshot schema (`schemas/env-overlay.ts`). Core row schemas mirror bounds. Server: `registerOpenApiRoute` for list/get/create/update/delete/preview (`api.ts` ~5282–5463); Start keeps multipart exception with empty `request.body` (~1122–1139) matching prior conversation/run pattern. | None new. | Multipart exception pre-existed; ENV adds optional string field only. | Remove route registrations + schemas. |
| **IV. Additive schema + generated files** | PASS | `migrations/000_combined.sql`: table after usage_ledger (~725); `idx_workflow_envs_workflow_name` + `COMMENT ON COLUMN` in trailing section (~932+). SQLite twin in `packages/core/src/db/adapters/sqlite.ts` (~1064–1075). `AGENTS.md` inventory item 21 `workflow_envs`. `packages/core/src/db/bundled-schema.generated.ts` regenerated. `packages/web/src/lib/api.generated.d.ts` present for ENV paths. Parity floor raised in `sqlite.test.ts`. | None. | N/A | Table remains on rollback; stop API writes. |
| **V. Fail-closed lifecycle** | PASS design / **OPEN implementation blockers** | Implemented: `prepareExecutionEnvOverlay` + complete snapshot before DAG in `executor.ts`; orchestrator `resolveFreshDispatchEnvOverlay` / `resolveContinuationDispatchEnvOverlay` before `validateAndResolveIsolation` (`orchestrator-agent.ts`); isolation spy tests in `orchestrator-agent.test.ts`; resume ignores new ENV (US-012). **OPEN (release blockers until fixed):** Convergence 2 task 9 / US-020 — `hydrateResumableRun()` still claims via `resumeWorkflowRun()` before conversation + isolation gates when an ENV candidate accompanies a possible continuation; task 10 / US-021 — overlay-bearing pre-created preamble failures must terminal-fail the pending row inside executor-owned boundary. | **YES — lifecycle claim ordering (task 9) and pending-row terminalization (task 10).** | Not accepted: these contradict Contract 10 and constitution V (no unsafe lifecycle mutation / claim before gates). They are **release blockers**, not waivers. | Land US-020 and US-021 before PR ready; do not ship overlay resume paths until claim is post-gate and preamble failures terminalize. |
| **VI. Secret-safe audit metadata** | PASS | `EnvOverlayError` codes without bodies (`env-overlay.ts`); defensive `assertRawPatchKeys` before copy (US-016); list endpoints omit patches; manage dialog `data-testid="env-plaintext-notice"`; run detail omits chip/table on malformed metadata and never renders patches (US-017). Logs/messages: id/name/codes only (orchestrator dispatch + Start freeze). | None. Prompt/bash remain plaintext install data by contract — UI states they are not secrets. | Accepted product fact, not a secret-hygiene violation. | Delete ENV rows; avoid putting secrets in prompt/bash patches. |
| **IV. Focused / full validation** | PASS (commands remain the gate) | Package test segments exist: `packages/workflows` env-overlay + resolution + executor; `packages/core` workflow-envs + env-overlay integration + orchestrator; `packages/server` `api.workflow-envs.test.ts` + runs; `packages/web` console ENV tests. Plan Validation Commands (lines 691–747) still name exact focused paths + root `bun run validate` + `bun run check:schema-upgrades`. Root `bun test` still forbidden. | None for the check format. Remaining Convergence 2 stories add more regressions before full green claim. | N/A | N/A |
| **I. Single-developer / no ACL creep** | PASS | No per-ENV ACL; create provenance via soft `resolveWebUserId` (null OK); install-wide API auth gate only. | None. | N/A | N/A |
| **Intentional complexity (post-design)** | WAIVED items still justified | Live code matches Complexity Tracking rows: `cloneNodeWithEngineMetadata` export from `include-expander.ts`; `setWorkflowRunEnvOverlay` PG `jsonb_set` / SQLite `json_set`+`json(...)`; pending stamp at INSERT + complete replace; out-of-band `HandleMessageContext.envOverlay`; `resolveGroupModelScope` forwards group model. | No new unjustified complexity beyond open Convergence 2 hardening. | Same as pre-Phase-0 table. | Same rollback paths. |
| **UI/brand** | PASS | Console components reuse existing tokens/patterns (`WorkflowEnvManageDialog`, `DraftRunCard`, `RunDetailHeader`); no new color/font tokens introduced for ENV. | None. | N/A | N/A |

#### Complexity Tracking (post-design) — deltas only

| Complexity | Status after implementation | Still needed? | Simplification if wrong |
| --- | --- | --- | --- |
| Exact name-conflict classifier (US-018) | Tightened beyond first draft (PG constraint exact; SQLite fully-qualified columns) | Yes — prevents false HTTP 409 | Loosen only with proven driver evidence |
| Defensive raw patch-key rejection (US-016) | Apply inspects raw keys before allowlist copy | Yes — Zod boundary is bypassable by in-process callers | Relying on Zod alone rejected |
| Strict run-detail parser (US-017) | Malformed → `null`, no manufactured complete | Yes — false audit UI is worse than omission | Tolerant parse rejected |

#### Unresolved constitutional / release blockers (must clear before PR ready)

1. **US-020 / Convergence 2 task 9 — Resume claim before gates** — Claiming `running` inside early hydrate when an ENV candidate is present violates Contract 10 ordering and constitution V lifecycle safety. **Blocker until claim is delayed until after conversation + isolation success.**
2. **US-021 / Convergence 2 task 10 — Overlay pre-created preamble failure terminalization** — Pending overlay-bearing rows must not remain non-terminal when eager resolution throws before events/DAG. **Blocker until executor fail-closed boundary covers that path.**
3. **Process gate (this section)** — Satisfied by appending this evidence; reviewers must still re-read gates on final PR.

Other Convergence 2 tasks (11–17) are correctness/UX hardenings. They are required by the plan’s own acceptance bar but are not additional constitution principle violations beyond the two lifecycle blockers above.

---

### C. Verification of this evidence section

- Manual comparison against `.specify/memory/constitution.md` lines 154–156 (plan must document Constitution Check before Phase 0 and re-check after design) and lines 172–175 (package boundaries, type/schema contracts, validation commands, git lifecycle safety, observability, secret handling).
- Manual comparison against `.specify/templates/plan-template.md` Constitution Check bullet list and Complexity Tracking table shape.
- `git diff --check` on this plan file must be clean (no whitespace errors).
- This section does **not** change implementation code (US-019 scope).

**Constitution Check owner sign-off shape for PR (historical US-019 wording):** reviewers confirm (1) both A and B tables are present, (2) every gate has evidence ≠ “PASS”, (3) release blockers list is empty or explicitly waived with Complexity Tracking. At US-019 write time, blockers 1–2 remained open in code and blocked PR readiness. **Superseded for current release readiness by §D below** — do not treat B’s open-blocker list as the live gate after 2026-09-05 Convergence 3.

---

### D. Post-Convergence-3 Re-Check (current)

_Recorded 2026-09-05 after US-020–US-032 landed (Ralph stories through Convergence 3 tasks 9–21) and focused + Phase 8 package suites were re-run for this re-check. Sections A–C above are **historical evidence** and are preserved verbatim except for the sign-off pointer in C. This section is the single authoritative **current** release-blocker list._

**How to read this section:** B’s “OPEN implementation blockers” row and the US-020/US-021 bullet list under B were true at US-019 / pre-Convergence-2-code time. They are **not** current open violations. Closed items below cite final symbols + focused tests; any still-open item would appear only under “Current release blockers.”

#### Historical → current disposition (lifecycle blockers from B)

| Historical blocker (B) | Current status | Final code evidence | Focused test evidence (2026-09-05 re-run) |
| --- | --- | --- | --- |
| **US-020 / Convergence 2 task 9 — Resume claim before gates** | **CLOSED** | `packages/workflows/src/executor.ts`: exported `inspectResumableRun` (read-only eligibility/snapshot, no CAS) and `hydrateResumableRun` (claims via `resumeWorkflowRun` only after inspect). `packages/core/src/orchestrator/orchestrator-agent.ts`: early ENV path selection calls `inspectResumableRun` only; `hydrateResumableRun` runs once after conversation + isolation succeed. | `packages/workflows/src/executor.test.ts` — `inspectResumableRun` never calls resume; hydrate still claims (100 pass). `packages/core/src/orchestrator/orchestrator-agent.test.ts` — `US-020: updateConversation failure with ENV never claims paused run`; `US-020: IsolationBlockedError with ENV never claims paused run` (253 pass). |
| **US-021 / Convergence 2 task 10 — Overlay pre-created preamble terminalization** | **CLOSED** | `packages/workflows/src/executor.ts`: eager config/profile/scope/provider resolution wrapped so overlay-bearing throws call `failClosedAfterOverlayError` (safe env id/name log + message) and return without snapshot/events/DAG; no-overlay still rethrows. `packages/core/src/db/workflows.ts` `failWorkflowRun`: `WHERE status IN ('running', 'pending')` so background pre-create rows terminalize before status→running. Background orchestrator catch remains log-only (not the repair path). | `packages/workflows/src/executor.test.ts` — `US-021: overlay-bearing pending preCreatedRun fails closed on preamble resolution throw`; `US-021: no-overlay preamble resolution throw still propagates` (100 pass). `packages/core/src/orchestrator/orchestrator.test.ts` background pending overlay ends `failed` (73 pass). `packages/core/src/db/workflows.test.ts` fail CAS/status coverage (112 pass). |
| **Process gate (Constitution Check evidence itself)** | **CLOSED** (US-019) + **reconciled** (this §D / US-033) | Plan §A–§C from US-019; this dated §D supersedes stale “open in code” claims without deleting A–C history. | `git diff --check` on this plan; manual compare to `.specify/memory/constitution.md` 154–156 and 172–175. |

#### Convergence 3 hardenings closed after B (not additional constitution principle violations at B-time; required before final readiness)

| Story / task | Current status | Final code evidence | Focused test evidence (2026-09-05 re-run) |
| --- | --- | --- | --- |
| **US-029 / task 18 — Inspect before stored ENV parse** | **CLOSED** | `orchestrator-agent.ts`: every provisional continuation calls `inspectResumableRun` before `resolveContinuationDispatchEnvOverlay`; inspect-null → `resolveFreshDispatchEnvOverlay(request|undefined)` and ignores stale/malformed stored overlay; `workflow.env_overlay_prepared.continuing` is `isGenuineContinuation`. | `orchestrator-agent.test.ts` — `US-029: inspect-null + malformed stored ENV starts fresh YAML without request`; applies valid request; ignores YAML-incompatible stored; genuine continuation with malformed stored fails before gates (253 pass). |
| **US-030 / task 19 — Strict frozen patch validation in run ENV UI** | **CLOSED** | `packages/web/src/experiments/console/primitives/run.ts` `isValidEnvPatchesDocument` / `isValidEnvNodePatch` mirror engine target-key, allowlist, non-empty, thinking, 256/1 MiB contracts before pending/complete accept; never copy bodies onto `RunEnvOverlay`. | `primitives/run.test.ts` corrupt frozen patches → null; valid empty map/bodies parse; `RunDetailPage.test.tsx` hides only ENV surfaces (web focused suite green). |
| **US-031 / task 20 — Console editor rejects zero thinking budget** | **CLOSED** | `workflow-env-editor.ts` `thinkingToPatch`: present `budgetTokens` must be positive int per `thinkingConfigSchema`; blank omits; `0`/`-0`/negative/fractional/non-finite throw. | `workflow-env-editor.test.ts` + mounted `WorkflowEnvManageDialog.test.tsx` zero-budget: no POST/PATCH, local error (63 pass across editor/dialog/run focused files). |
| **US-032 / task 21 — Stored ENV authoritative name schemas** | **CLOSED** | `packages/core/src/schemas/workflow-env.ts`: `workflowEnvRowSchema` / `workflowEnvSummarySchema` compose `workflowEnvWorkflowNameSchema` + `workflowEnvNameSchema` (not length-only). Corrupt identities → `WorkflowEnvCorruptRowError` id-only. | `workflow-env.test.ts` (9 pass); `workflow-envs.test.ts` injected invalid identities on detail+summary (10 pass). |
| **US-022–US-028 / Convergence 2 tasks 11–17** | **CLOSED** (prior Ralph iterations) | HTTP `envId` omission vs `invalid_env_id`; route-scoped `invalid_env_request`; mounted no-op `{}` patches; picker/start race harness; missing-node raw keys; programmatic `modelReasoningEffort` scope fallback; strict run-detail optional fields. | Prior story progress + re-confirmed packages: `api.workflow-envs.test.ts` (18 pass); `env-overlay` engine tests (29 pass); console picker/start/detail suites (43 pass). |

#### Gate re-check (constitution lines 154–156 process + 172–175 compliance)

| Gate | Current verdict | Concrete repository evidence | Violation? | Accepted-use / rollback |
| --- | --- | --- | --- | --- |
| **II. Package-layer direction** | PASS | Unchanged boundary: pure apply/resolution in `@archon/workflows` (`env-overlay.ts`, `node-model-resolution.ts`, executor ownership); CRUD + `setWorkflowRunEnvOverlay` / `failWorkflowRun` in `@archon/core`; OpenAPI transport in `@archon/server`; console via `@/lib/api.generated` + local parsers only (no `@archon/workflows` import in web). | None. | Revert ENV commits; additive table unused. |
| **III. Typed / OpenAPI schema rules** | PASS | Engine/core/server Zod via `@hono/zod-openapi` + `z.infer` + explicit records; `registerOpenApiRoute` CRUD/preview; Start multipart exception unchanged; US-023 route-scoped `invalid_env_request` hook; US-032 row schemas compose write-path name schemas. | None new. | Remove ENV routes/schemas. |
| **IV. Additive schema + generated files** | PASS | `remote_agent_workflow_envs` additive; trailing indexes/comments; SQLite twin; bundled schema + `api.generated.d.ts`; inventory 21. No destructive migration. | None. | Leave table; stop writes. |
| **V. Fail-closed lifecycle** | PASS (blockers closed) | Pre-isolation overlay gate; inspect-before-claim (US-020); inspect-before-stored-parse (US-029); pending+running `failWorkflowRun` + preamble fail-closed (US-021); complete snapshot before DAG; resume ignores new ENV (US-012); no autonomous abandon of ambiguous non-terminal rows. | None current. Historical B OPEN items closed with evidence above. | Disable ENV selection; abandon/finish overlay-bearing runs before binary rollback. |
| **VI. Secret-safe observability** | PASS | Errors/logs: env id/name/codes only; list omits patches; run UI never renders prompt/bash; defensive raw keys (US-016/026); corrupt frozen patches hide ENV UI (US-030); plaintext notice remains product honesty, not secret store. | None. | Delete ENV rows; do not put secrets in prompt/bash. |
| **IV. Focused / full validation** | PASS | Focused re-run 2026-09-05: workflows `executor.test.ts` 100; `env-overlay`+schema 29; core `orchestrator-agent` 253; `orchestrator` 73; `workflow-env` schema 9; `workflow-envs` 10; `workflows` DB 112; server `api.workflow-envs` 18; web console ENV suites 63+43. Root gates same day: `check:bundled` / `check:bundled-schema` clean; `type-check` clean (all packages); `lint --max-warnings 0` clean; `format:check` clean; `test:install` passed; `bun run test` 0 fail. `git diff --check` clean on this plan. `check:schema-upgrades` remains CI/Postgres-live (not a local constitution code gap). Root `bun test` still forbidden. | None. | N/A |
| **I. Single-developer / no ACL creep** | PASS | No per-ENV ACL; provenance-only `created_by_user_id`; install-wide API gate only. | None. | N/A |
| **Intentional complexity** | WAIVED items still justified | Prior Complexity Tracking rows remain; post-B deltas still needed: inspect vs hydrate split (US-020), pending fail CAS (US-021), inspect-before-parse (US-029), local frozen-patch validator (US-030), positive budget client guard (US-031), authoritative identity compose (US-032). | No new unjustified complexity. | Same rollback paths as A/B tables. |
| **UI/brand** | PASS | Existing console tokens/patterns only. | None. | Hide ENV UI. |
| **Workflow Language Constitution** | PASS (out of surface) | Still invocation/storage overlay; no YAML language ENV field. | None. | N/A |
| **Plan Quality Gate (const. 154–156)** | PASS | Pre-Phase-0 check = §A; post-design check = §B (historical); post-implementation Convergence 3 re-check = this §D. | None. | N/A |

#### Complexity Tracking (post-Convergence-3) — deltas only

| Complexity | Status after Convergence 3 | Still needed? | Simplification if wrong |
| --- | --- | --- | --- |
| `inspectResumableRun` vs `hydrateResumableRun` split (US-020) | Live; claim only after conversation + isolation | Yes — prevents paused→running before gates | Merging claim back into early path reopens B blocker 1 |
| `failWorkflowRun` accepts `pending` (US-021) | Live CAS `IN ('running','pending')` | Yes — background pre-create is pending until DAG | Reverting to running-only re-strands overlay pending rows |
| Inspect-before-stored-overlay-parse (US-029) | Live on every provisional continuation | Yes — inspect-null must not fail-closed on stale metadata | Parsing stored overlay before inspect reopens H1 |
| Console frozen-patch mirror validator (US-030) | Local allowlist/bounds without importing workflows | Yes — false audit UI worse than omission | Trusting non-array object only rejected |
| Positive thinking `budgetTokens` client guard (US-031) | Matches `thinkingConfigSchema` | Yes — avoids server-only reject after UI accept | Allowing 0 reopens H3 |
| Authoritative identity on row/summary schemas (US-032) | Compose write-path name schemas | Yes — corrupt identities must not escape list/detail | Length-only strings rejected |

#### Current release blockers (authoritative)

**None.**

All constitutional lifecycle blockers listed under B (US-020 delayed claim, US-021 pending preamble terminalization) are closed with the code and focused-test evidence above. Convergence 3 tasks 18–21 (US-029–US-032) are closed. Remaining work for PR shipping is ordinary release process (PR template, `Closes` linkage, reviewer pass) — not an open constitution violation. Mixed-version resume risk for overlay-bearing runs remains an **ops deployment constraint** (Deployment § lines 751–761), not an unresolved design/implementation constitution breach.

#### Verification of §D

- Manual comparison against `.specify/memory/constitution.md` lines 154–156 (documented pre-Phase-0 + post-design checks; this file now also carries post-Convergence-3 re-check) and lines 172–175 (package boundaries, type/schema contracts, validation commands, git lifecycle safety, observability, secret handling).
- Historical A–C preserved; verdicts changed from “open blocker” to “closed” only where the table cites final symbols and re-run tests.
- `git diff --check` on this plan file must be clean.
- This section does **not** change implementation code (US-033 scope = plan evidence only).

**Current Constitution Check owner sign-off for PR:** reviewers confirm (1) A, B, and D are present, (2) D’s current release-blocker list is empty or explicitly waived with Complexity Tracking, (3) US-020/US-021 rows cite inspect/hydrate and pending fail-closed evidence, (4) focused package tests above are green and the root validate legs recorded in the Focused/full validation row are green (`check:schema-upgrades` when Postgres is available remains the remaining CI-only schema leg).


## Convergence 3

The following tasks were added by the third 2026-09-05 skeptical converge review after all 28 Ralph stories were claimed complete. The claim was not treated as evidence. Continue the same red-green discipline: add the named failing regression first, confirm the concrete failure, make the smallest scoped correction, run the focused command, and finally rerun the plan's Phase 8 gates. These tasks supplement, rather than replace, both earlier Convergence sections.

18. **[HIGH][partial][hidden] Decide genuine continuation before parsing or logging the stored ENV.** Source refs: Authoritative Contract 10 steps 1–3 (lines 360–367), Phase 4 (lines 554–564), and hidden finding H1 from the third converge audit. `packages/core/src/orchestrator/orchestrator-agent.ts:921-956` calls `resolveContinuationDispatchEnvOverlay()` before `inspectResumableRun()`, and only performs the early inspection when a request ENV exists. First add regressions to `packages/core/src/orchestrator/orchestrator-agent.test.ts` for a paused candidate with no completed nodes/no rerunnable gate state and malformed (and separately current-YAML-incompatible) stored `metadata.envOverlay`: without a request ENV it must start fresh on YAML, and with a valid request candidate it must start fresh with that candidate. Also retain a genuine-continuation control proving the same malformed stored overlay still fails before conversation mutation/isolation and before the resume CAS. Then reorder the dispatch decision so every provisional continuation is inspected read-only before its stored overlay is parsed, applied, or logged; inspect-null follows the fresh request/YAML path, while a genuine continuation alone parses the run-owned snapshot. Keep `resumeWorkflowRun()` after conversation and isolation gates, preserve concurrent-claim rejection, and do not query the mutable ENV table. Acceptance: an ineligible prior row cannot make a fresh start fail because of that row's stale/corrupt overlay; no `workflow.env_overlay_prepared` entry claims the discarded stored ENV or reports `continuing: true` for an inspect-null fresh start; genuine continuations remain fail-closed on malformed stored metadata. Verify with `cd packages/core && bun test src/orchestrator/env-overlay-dispatch.test.ts && bun test src/orchestrator/orchestrator-agent.test.ts`.

19. **[MEDIUM][partial][hidden] Validate the complete frozen patch document before rendering run ENV audit UI.** Source refs: Runtime overlay types (lines 126–160), Run detail (lines 429–438), Required Console tests (lines 667–668), Convergence tasks 6/17, and hidden finding H2. The local parser in `packages/web/src/experiments/console/primitives/run.ts:313-320` checks only that `patches` is a non-array object, so a stored pending/complete overlay such as `patches: { n: { prompt: 42, typo: 'value' } }` is presented as valid even though `storedEnvOverlaySchema` rejects it. First extend `packages/web/src/experiments/console/primitives/run.test.ts` with pending and complete cases covering non-object per-node patches, unsafe/reserved target ids, empty patches, unknown fields, wrong field types, invalid thinking (including zero budget), and the 256-target/1-MiB bounds; assert the whole ENV section parses to `null` while valid empty-map and body-string cases remain accepted. Add/retain `RunDetailPage.test.tsx` proof that corrupt patches hide only the ENV section and never expose body contents. Then add a fail-closed local patch-shape validator without importing `@archon/workflows`; it must mirror the authoritative target-key, field, per-node non-empty, thinking, and document-bound contracts but never copy patch bodies into `RunEnvOverlay`, errors, or rendered data. Acceptance: the web primitive accepts only lifecycle objects whose frozen `patches` could pass the engine stored-overlay boundary, valid pending/complete display is unchanged, and malformed body values cannot manufacture a trustworthy-looking ENV chip/table. Verify with `cd packages/web && NODE_ENV=development bun test src/experiments/console/primitives/run.test.ts src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx`.

20. **[MEDIUM][partial][hidden] Reject zero thinking budgets in the console editor before submitting.** Source refs: Patch validation's existing `thinkingConfigSchema` rule (lines 118–120), Manage dialog behavior (lines 420–427), Console test matrix (line 666), and hidden finding H3. `packages/web/src/experiments/console/lib/workflow-env-editor.ts:87-97` currently accepts `budgetTokens: '0'` even though `thinkingConfigSchema` requires a positive integer, so the manager builds a request the server must reject. First add a failing helper regression in `workflow-env-editor.test.ts` for `0` (and `-0`) and a mounted `WorkflowEnvManageDialog.test.tsx` submit case proving no POST/PATCH occurs and an actionable local error appears; retain controls for omitted budget and a positive integer. Then make `thinkingToPatch()` enforce a positive integer and align its comment/error text with the shared schema. Acceptance: blank means the optional budget is omitted, positive integers serialize unchanged, zero/negative/fractional/non-finite inputs never reach the HTTP skill, and the rest of the draft stays editable. Verify with `cd packages/web && NODE_ENV=development bun test src/experiments/console/lib/workflow-env-editor.test.ts src/experiments/console/components/WorkflowEnvManageDialog.test.tsx`.

21. **[MEDIUM][partial][hidden] Reuse the authoritative workflow/ENV name schemas when validating stored rows.** Source refs: Store contracts (lines 257–265), Database/core test matrix (lines 627–629), and hidden finding H4. `packages/core/src/schemas/workflow-env.ts:38-45` weakens `workflow_name` and `name` to length-only strings inside `workflowEnvRowSchema`, so externally corrupted rows such as `workflow_name: 'bad//workflow'` or `name: 'has space'` pass the advertised complete-row boundary. First add schema regressions in `packages/core/src/schemas/workflow-env.test.ts` and injected SQLite row regressions in `packages/core/src/db/workflow-envs.test.ts`; prove full-detail reads and summary reads reject invalid stored identities with `WorkflowEnvCorruptRowError` carrying/logging the id only, while summary listing remains independent of patch parsing. Then compose `workflowEnvRowSchema` from `workflowEnvWorkflowNameSchema` and `workflowEnvNameSchema` (and let the summary schema inherit them) rather than duplicating weaker constraints. Acceptance: route/store writes and stored-row reads agree on valid identity, corrupt identities cannot escape through list/detail, no patch body is loaded merely to validate a summary, and valid Date/string timestamp behavior is unchanged. Verify with `cd packages/core && bun test src/schemas/workflow-env.test.ts && bun test src/db/workflow-envs.test.ts`.

22. **[MEDIUM][contradicts] Reconcile the Constitution Check with the post-Convergence-2 tree.** Source refs: `.specify/memory/constitution.md` Plan Quality Gate, this plan's Constitution Check lines 833–917, and Pass A finding A1 from the third converge audit. The current evidence section still says Convergence 2 tasks 9/10 are open in code and that they block PR readiness, although the present executor/orchestrator contain their delayed-CAS and pending-row fail-closed fixes and focused regressions. After tasks 18–21 land, update or append a clearly dated post-Convergence-3 re-check that distinguishes historical findings from current blockers and cites the final code/tests for every closed or open item. Do not simply delete history or change verdicts without evidence. **Status (2026-09-05): DONE via Constitution Check §D (US-033)** — historical A–C retained; current release-blocker list is empty with cited US-020/US-021/US-029–US-032 evidence.


## Convergence 4

The following tasks were added by the fourth 2026-09-05 skeptical converge review after Ralph claimed all 33 stories and the current Constitution Check complete. The claim and recorded green counts were not treated as proof, and the project test suite was not run during this review. GitNexus 1.6.11 was available but this checkout had no index, so blast radius was traced through source callers, callees, shared resolution helpers, and focused tests. Continue red-green discipline: add the named failing regression first, confirm the concrete failure, make the smallest scoped correction, run the focused command, and finally rerun the plan's Phase 8 gates. This section supplements all earlier Convergence sections and supersedes §D's “Current release blockers: None” claim until tasks 23–27 are evidenced closed.

23. **[CRITICAL][contradicts][hidden] Do not let an informational delivery failure strand a continuation after the resume CAS.** Source refs: Authoritative Contract 10's post-gate claim/dispatch sequence (lines 360–384), Constitution V's fail-closed lifecycle rule, and hidden finding H1 from the fourth converge audit. `packages/core/src/orchestrator/orchestrator-agent.ts:1114-1207` calls `hydrateResumableRun()` (which wins the paused/failed → running CAS) and then awaits the supplied-input notice at lines 1152–1164 and the newly added ignored-ENV notice at lines 1166–1185 before calling `executeWorkflow()` at line 1187. A rejecting adapter therefore exits this path with the row still `running` and no executor owning it. First add regressions to `packages/core/src/orchestrator/orchestrator-agent.test.ts` for a genuine paused continuation where (a) supplied inputs trigger a notice and (b) a selected request ENV triggers the ignored-ENV notice; make `platform.sendMessage` reject immediately after the winning CAS and prove `executeWorkflow` is still invoked exactly once with the stored run inputs/overlay. Then make each post-claim notice independently best-effort using the established safe-delivery/logging pattern, without moving a potentially false “resuming” notice before the CAS and without weakening the concurrent losing-CAS return. Acceptance: after a successful resume claim, informational transport failure cannot prevent executor handoff; both notices remain attempted when applicable; no fresh row or second dispatch is created; logs contain ids/names only and never patch bodies. Verify with `cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts`.

24. **[HIGH][partial][hidden] Make container preflight recurse through the actual `loop_group` model scope and check provider turns, not group containers.** Source refs: Authoritative Contract 4 lines 186–187, Contract 6 lines 209–215, acceptance criterion line 683, and hidden finding H2. `packages/workflows/src/dag-executor.ts:9030-9074` checks the group container's resolved provider even though the group never calls `sendQuery`, then visits its body with the unchanged outer `workflowProvider`; runtime instead derives `groupScope` at lines 8216–8264 and passes that provider/model/preset/tier into the body. Concrete failures include outer `codex` + group `claude` + inherited prompt (preflight falsely retains `codex`) and a group resolving to `codex` whose every provider-turn child explicitly selects `claude` (the non-turn group itself falsely rejects). First extend `packages/workflows/src/dag-executor.test.ts` with those two controls plus nested-group inheritance/model-alias cases and an actually incompatible inherited body that must still reject. Then replace the string-only recursion with a scope-aware walker supplied the effective workflow scope and assistant defaults: derive each group scope through the shared pure resolver, recurse with it, and never add a provider solely for the group container. Apply the same inherited scope to approval/plannotator provider turns inside groups; retain the dispatch-time container capability backstop. Acceptance: preflight and runtime choose the same provider for every actual AI turn at every group depth, valid container runs are not falsely rejected, and an incompatible body still fails before any node executes. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/dag-executor.test.ts`.

25. **[MEDIUM][partial][hidden] Consume preset-derived unsupported-thinking decisions in the runtime capability warning path.** Source refs: Authoritative Contract 4 lines 177–182, Phase 1 exit gate line 528, run-detail capability copy lines 434–435, and hidden finding H3. `packages/workflows/src/node-model-resolution.ts:302-350` correctly sets `thinkingUnsupported` after node/workflow/preset precedence, but `packages/workflows/src/dag-executor.ts:1245-1267` decides whether `thinking` was requested from node/workflow fields only and no runtime caller reads the structured flag. A codex/opencode/grok tier or alias preset carrying `thinking` with no explicit node/workflow thinking is therefore sent and recorded as requested but silently misses the existing `dag.unsupported_capabilities` warning. First add a pure preset-only regression to `packages/workflows/src/node-model-resolution.test.ts` and runtime regressions to `packages/workflows/src/dag-executor.test.ts` proving the requested thinking remains in prospective metadata/send options while the existing provider-may-ignore warning/log fires exactly once; retain controls for supported providers and explicit thinking. Then make the capability warning layer consume `request.thinkingUnsupported` (without duplicating warning mechanisms or dropping the requested setting). Acceptance: every unsupported effective thinking value—whether authored at node, workflow, or preset precedence—is represented truthfully and warns through the same safe path; supported thinking produces no warning. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/dag-executor.test.ts`.

26. **[MEDIUM][contradicts][hidden] Preserve the existing provider/model conflict warning when resolving a `loop_group` body scope.** Source refs: Verified Baseline line 27, the “only intentional no-ENV execution change” rule at line 383, Contract 6 lines 209–215, and hidden finding H4. Before this feature the group dispatch called `resolveNodeProviderAndModel()`, whose runtime layer emits the deduplicated `dag.model_provider_conflict` warning. The new `resolveGroupModelScope()` in `packages/workflows/src/node-model-resolution.ts:362-379` discards `resolveNodeModel()`'s `providerConflict`, and the group branch in `packages/workflows/src/dag-executor.ts:8216-8279` never emits it; inherited body nodes see only the already-resolved provider and cannot recover the conflict. First add shared-resolution and executor regressions for a group declaring `provider: claude` with a model alias resolving to `codex`, including nested and matching-provider controls; prove the resolved provider/model still reach the body and the established log/user warning occurs once per deduplicated conflict. Then expose the group resolution decision (or a narrow companion result) from the shared pure helper and let the runtime group branch consume its `providerConflict` through the existing safe warning layer. Do not add a group container row to ENV `resolved`, and do not recompute alias policy independently in the executor. Acceptance: no-ENV and ENV group runs retain the established loud conflict behavior while body scope forwarding and preview/snapshot rows remain unchanged. Verify with `cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/dag-executor.test.ts && bun test src/executor.test.ts`.

27. **[MEDIUM][contradicts] Reconcile the current Constitution Check with the fourth converge evidence.** Source refs: `.specify/memory/constitution.md` Plan Quality Gate and lifecycle principles, §D lines 921–985, and Pass A finding A1 from the fourth converge audit. §D currently calls itself authoritative and says the release-blocker list is empty, which is contradicted by task 23's post-CAS orphan path and task 24's core group-scope preflight failure. After tasks 23–26 land and their focused tests pass, append a dated post-Convergence-4 re-check that preserves historical §A–§D, records each finding's actual disposition with final symbol/test evidence, and makes one unambiguous current blocker list. Until then, keep this Convergence 4 section as the authoritative non-empty gap list; do not mark a task closed or repeat Ralph's test counts without rerunning the cited command. Acceptance: plan evidence and the live tree agree, the lifecycle gate cannot read PASS while task 23 is open, every waiver has rollback/simplification rationale, and the final shipping gate names `bun run validate` plus the PostgreSQL schema-upgrade CI leg. Verify the documentation edit with `git diff --check -- docs/superpowers/plans/2026-09-05-workflow-env-overlay.md` before the normal Phase 8 validation.
