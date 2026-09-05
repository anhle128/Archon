# Workflow ENV Overlay Ralph PRD

Source plan: `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md`

Slug: `2026-09-05-workflow-env-overlay`

## Overview

Workflow ENV Overlay lets an operator save named, install-wide workflow overlays and choose one from the console when starting a run. The overlay patches a bounded allowlist of node execution fields on a cloned workflow definition, never the discovered YAML or discovery cache. The run persists the filtered patch snapshot and latest resolved request metadata so resume and node retry replay the same selected overlay even if the ENV row is later edited or deleted.

The plan's product outcome is anchored at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:9-17`: compare prompt/model/provider variants of the same workflow without duplicating workflow files. The implementation must preserve the verified current-state baseline in `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:19-40`.

## Problem

Operators need to compare prompt/model/provider variants of one workflow. Today the practical workaround is duplicating workflow YAML, which creates drift and makes resume/retry provenance ambiguous. A mutable overlay row alone is unsafe: existing run creation and resume/retry paths are spread across orchestrator, executor, CLI retry, web retry, child recovery, and parent auto-resume (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:31-35`), so every selected run needs an immutable run-owned snapshot.

## Solution

Add a Workflow ENV feature as an invocation/storage overlay, not workflow-language surface. Store named ENVs in a new install-wide table keyed by `(workflow_name, name)`. Add a pure workflow-engine overlay module that schema-validates patch documents, symbol-preserving-clones expanded workflow definitions, applies only the approved node-field matrix, validates the patched graph, and computes resolved request metadata through the same path used by runtime `node_started` events. Thread selected ENVs through HTTP Start and orchestrator dispatch out-of-band, persist filtered pending snapshot metadata at the first run-row insert, replace it atomically with complete resolved metadata before DAG execution, and replay only that run metadata on every resume/retry path. Console v1 adds ENV selection, preview, management, and run-detail rendering.

## Goals and Success Metrics

| Goal | Success metric | Evidence required |
| --- | --- | --- |
| Operators can create, preview, select, start, inspect, and delete workflow ENVs from the console. | Manual console flow covers create/edit/select/preview/start/detail/resume/delete for JSON and multipart Start paths. | Acceptance plan at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:670-689` and validation commands at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:691-747`. |
| ENV patches cannot mutate discovered definitions or contaminate future no-ENV runs. | Engine tests prove symbol metadata, original workflow objects, and caller patch objects remain unchanged across ENV A, ENV B, and no-ENV reuse. | Engine matrix at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:607-622`. |
| Resume/retry uses frozen run metadata, not live ENV rows. | Direct executor, CLI-style resume/retry, web retry, child recovery, parent auto-resume tests pass and prove ENV edit/delete after Start has no effect. | Dispatch/execution matrix at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:634-648`. |
| Request metadata is truthful and not an approximation. | Preview/snapshot resolved rows equal persisted `node_started` request fields for executed provider-turn nodes. | Metadata contract at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:162-190`. |
| Schema is additive and portable across SQLite/PostgreSQL. | Fresh/parity/integration tests, `bun run check:schema-upgrades`, `bun run validate`, and generated-schema checks pass. | Persistence requirements at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:217-245` and validation matrix at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:623-633`. |

## Non-Goals

These remain out of scope exactly as the plan states in `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:69-82`:

- CLI `--env`, chat command syntax, or natural-language ENV selection.
- Applying a parent ENV to a fresh child `workflow:` sub-run.
- Patching nodes inside a `loop_group` body.
- Patching graph/control fields, node mode, includes, child workflow/fan-out/isolation policy, command names, loop prompt/command, script source, approval/plannotator nested prompts, or workflow-level fields.
- Unsetting YAML values.
- Per-project ENV identity.
- Automatic migrations when workflow/node names change.
- Experiment matrices, pricing, duration comparisons, scheduled sweeps, or statistical reports.
- Optimistic locking between Preview and Start.
- Moving workflow-run creation ahead of isolation.
- Destructive down migration or feature flag.

## Technical Context

### Current-state constraints

- Discovery returns fully expanded definitions; include children are top-level `<includeId>__<childId>` nodes while `loop_group` bodies stay nested (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:23`).
- `include-expander.ts` attaches symbol-keyed metadata; `structuredClone` drops those symbols, so ENV cloning must reuse a symbol-preserving clone path (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:24`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:194-197`).
- `validateDagStructure()` validates top-level dependencies/cycles/output refs and recurses into sealed groups; patched clones must run it after apply (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:25`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:201`).
- Node kind support is intentionally uneven. The overlay field matrix must follow executor behavior, not the broader base Zod object (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:86-105`).
- `resolveNodeModel()` currently resolves only provider/model/effort intent; the authoritative request metadata is built later and must be extracted to one pure resolution path (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:27`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:162-190`).
- `loop_group.model` is already parsed/documented as meaningful but not actually forwarded; this feature must fix that existing runtime mismatch (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:28`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:207-215`).
- Start route parsing is manual JSON/multipart and intentionally lacks OpenAPI request body validation (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:29`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:314-328`).
- Fresh foreground/background row creation timing means pending overlay metadata must be written at each existing INSERT point, not only by a later update (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:32-33`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:386-394`).
- Existing run metadata updates are top-level merged and SQLite `json_patch` deep-merges nested objects, so `metadata.envOverlay` needs a narrow exact replacement method (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:36-38`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:267-275`).
- Web auth gates `/api/*` when enabled, but this feature adds no per-resource ACL; `created_by_user_id` is provenance only (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:40`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:279-281`).

### Files and boundaries

The plan identifies the affected packages and concrete files at `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:440-514`:

- `packages/workflows`: schemas, clone/apply, node-model resolution, DAG executor, executor, store boundary, workflow tests, package exports.
- `packages/core`: row schemas, DB CRUD, SQLite schema, workflow metadata update, store adapter, orchestrator threading/tests, generated bundled schema.
- `packages/server`: workflow ENV route schemas, CRUD/preview routes, Start `envId` parsing, generated OpenAPI types.
- `packages/web`: console skills/cache keys/start path, picker, preview table, management dialog, run primitive/detail/header/table tests.
- `migrations/000_combined.sql`, `packages/docs-web` API/authoring docs, generated `api.generated.d.ts`, and `AGENTS.md` database inventory.

## Story Overview

Lower priority number runs first. `dependsOn` contains only lower-priority story ids.

| Priority | Story | Title | Depends on | Plan coverage |
| --- | --- | --- | --- | --- |
| 1 | US-001 | Engine overlay schemas and apply module | - | Phase 1 schema/clone/apply, engine tests (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:518-528`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:607-619`) |
| 2 | US-002 | Shared request metadata and loop-group parity | US-001 | Phase 1 resolution/group parity (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:523-528`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:616-622`) |
| 3 | US-003 | Workflow ENV database schema and CRUD store | - | Phase 2 schema/store (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:530-539`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:623-630`) |
| 4 | US-004 | Atomic run envOverlay metadata replacement | US-003 | Phase 2 run metadata store (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:536-539`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:631-632`) |
| 5 | US-005 | Executor snapshot ownership and universal replay | US-001, US-002, US-004 | Phase 3 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:541-552`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:634-648`) |
| 6 | US-006 | Orchestrator pre-isolation overlay gate and background handoff | US-001, US-005 | Phase 4 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:554-564`) |
| 7 | US-007 | HTTP CRUD and preview API | US-001, US-002, US-003 | Phase 5 CRUD/preview (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:566-575`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:649-658`) |
| 8 | US-008 | Start route envId freeze and orchestrator handoff | US-006, US-007 | Phase 5 Start (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:570-575`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:651-654`) |
| 9 | US-009 | Console start picker and preview | US-007, US-008 | Phase 6 Start card (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:577-584`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:660-665`) |
| 10 | US-010 | Console ENV management dialog | US-009 | Phase 6 manager (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:416-428`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:666`) |
| 11 | US-011 | Run detail, docs, generated files, and full validation | US-005, US-009, US-010 | Phase 7/8 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:586-604`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:670-689`) |
| 12 | US-012 | Resume ignores newly selected ENV | US-006 | Convergence task 1: resume ignores newly selected ENV (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-795`) |
| 13 | US-013 | Complete runtime resolution context | US-002, US-005, US-007, US-012 | Convergence task 2: full Preview/snapshot resolution context (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-797`) |
| 14 | US-014 | Preset effort warns while explicit effort fails | US-002, US-013 | Convergence task 3: preset effort warn/drop semantics (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-799`) |
| 15 | US-015 | Console editor preserves empty ENV values | US-010, US-014 | Convergence task 4: empty ENV and body preservation (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-801`) |
| 16 | US-016 | Defensive unknown patch-key rejection | US-001, US-015 | Convergence task 5: defensive unknown patch-key rejection (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-803`) |
| 17 | US-017 | Malformed run metadata hides ENV UI | US-011, US-016 | Convergence task 6: malformed run-detail metadata omission (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-805`) |
| 18 | US-018 | Exact ENV name-conflict classification | US-003, US-017 | Convergence task 7: exact ENV conflict classification (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-807`) |
| 19 | US-019 | Plan Constitution Check evidence | - | Convergence 2 task 8 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:813`) |
| 20 | US-020 | Resume claim delayed until gates pass | US-006, US-012, US-019 | Convergence 2 task 9 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:815`) |
| 21 | US-021 | Overlay pre-created preamble failures become terminal | US-005, US-006, US-020 | Convergence 2 task 10 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:817`) |
| 22 | US-022 | Exact envId HTTP omission and type contract | US-007, US-008, US-021 | Convergence 2 task 11 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:819`) |
| 23 | US-023 | Stable ENV request validation errors | US-007, US-022 | Convergence 2 task 12 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:821`) |
| 24 | US-024 | Mounted ENV manager saves no-op patches | US-010, US-015, US-023 | Convergence 2 task 13 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:823`) |
| 25 | US-025 | Picker and start component race regressions | US-009, US-024 | Convergence 2 task 14 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:825`) |
| 26 | US-026 | Missing-node raw patch keys rejected | US-001, US-016, US-025 | Convergence 2 task 15 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:827`) |
| 27 | US-027 | Programmatic modelReasoningEffort parity | US-002, US-005, US-007, US-013, US-026 | Convergence 2 task 16 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:829`) |
| 28 | US-028 | Strict run-detail ENV parser fields | US-017, US-027 | Convergence 2 task 17 (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:831`) |

## User Stories

### US-001 — Engine overlay schemas and apply module

As a workflow operator, I want a safe patch schema and pure symbol-preserving apply path, so that selected ENVs change only supported execution fields without mutating discovered workflows.

Acceptance criteria:

- `packages/workflows/src/schemas/env-overlay.ts` exports strict Zod schemas/types for patch/candidate/applied/snapshot/resolution; imports `z` from `@hono/zod-openapi`; derives types with `z.infer`; uses explicit record key schemas.
- ENV patch validation allows only `provider`, `model`, `effort`, `thinking`, `prompt`, and `bash`; rejects reserved/empty target keys, empty per-node patch, more than 256 targets, over-1-MiB serialized patches, and unknown document keys; accepts long include-expanded ids and empty/whitespace prompt/bash strings.
- `packages/workflows/src/env-overlay.ts` clones workflow roots, nodes, and nested groups with composed/compiled-loop metadata preserved through the generalized clone helper.
- Apply matches only expanded top-level ids, skips missing ids deterministically, rejects incompatible field/node combinations and unknown providers, validates patched nodes and graph structure, and emits stable safe error codes without prompt/bash bodies.
- Tests cover field matrix behavior, include id application, group-body target skipping, graph validation, deep-copy of object values, and preservation of original workflow/patch objects across ENV A, ENV B, and no-ENV reuse.

### US-002 — Shared request metadata and loop-group parity

As an operator comparing runs, I want preview/snapshot metadata to match runtime `node_started` requests, so that request settings are auditable without approximations.

Acceptance criteria:

- `packages/workflows/src/node-model-resolution.ts` exposes one pure resolution result used by `resolveNodeProviderAndModel()`, `node_started` serialization, ENV preview, and ENV snapshot metadata.
- `NodeExecutionMetadata` preserves provider, model, tier, `modelReasoningEffort`, effort, and thinking semantics; unsupported explicit portable effort still fails and unsupported thinking still uses the existing warning semantics.
- Resolved metadata includes every direct provider turn under the patched workflow: top-level prompt/command/loop nodes and provider-turn body nodes inside nested `loop_group`s, using persisted qualified step names such as `group.child`; it excludes group containers, bash, and other deterministic nodes.
- `loop_group` provider/model/preset/tier forwarding is fixed for ordinary YAML and overlaid group provider/model, recursively; group effort/thinking remain unsupported.
- Tests prove preview/snapshot rows equal `node_started` request fields across node/workflow/preset precedence, rejected preset effort, assistant fallback, thinking, loops, includes, and nested group scope.

### US-003 — Workflow ENV database schema and CRUD store

As an operator, I want named install-wide workflow ENVs persisted safely, so that variants survive across sessions and can be listed, edited, and deleted.

Acceptance criteria:

- PostgreSQL adds `remote_agent_workflow_envs` after `remote_agent_usage_ledger`, with id, workflow_name, name, patches, created_at, updated_at, created_by_user_id, and unique `(workflow_name, name)`; index and column comments live in the final migration section.
- SQLite `createSchema()` mirrors the new table/index; database inventory updates to 21 application tables; parity floor is investigated and raised to the verified post-change count; bundled schema is regenerated.
- Core row/name schemas validate workflow name maximum 255, ENV name trimmed 1-64 with `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and patches through `envPatchesSchema`; empty `{}` patches are valid.
- `packages/core/src/db/workflow-envs.ts` implements summary list without patches ordered by `LOWER(name), name, id`, get-by-id, create, workflow-scoped update with whole-document patch replacement, and workflow-scoped delete.
- Store boundaries normalize PostgreSQL JSONB and SQLite JSON strings through `envPatchesSchema`; corrupt stored documents throw typed `WorkflowEnvCorruptRowError` with id-only logging; unique conflict mapping is constraint/message exact.
- Core tests cover fresh SQLite, PostgreSQL parser parity, upgrade/idempotent reapply, CRUD JSON round-trip, name/bounds validation, corrupt row handling, summary independence from patch parsing, full replacement, and mismatch scoping.

### US-004 — Atomic run envOverlay metadata replacement

As the workflow engine, I want a narrow run-overlay persistence method, so that audit-critical overlay snapshots replace stale nested keys without clobbering sibling metadata.

Acceptance criteria:

- `IWorkflowStore` extends a new required `IWorkflowEnvOverlayStore` with `setWorkflowRunEnvOverlay(runId, snapshot): Promise<WorkflowRun>`.
- Core's workflow store adapter and every concrete in-memory test store/mock implement the method.
- PostgreSQL replaces only `metadata.envOverlay` with `jsonb_set(COALESCE(metadata, '{}'::jsonb), '{envOverlay}', ...)`; SQLite replaces only `metadata.envOverlay` with `json_set(COALESCE(metadata, '{}'), '$.envOverlay', json(...))`.
- Both dialect implementations update and read the complete run in one transaction, avoid SQLite `RETURNING`, require one affected row, and throw otherwise.
- Integration tests prove a second complete snapshot removes stale nested keys, preserves sibling metadata, and surfaces run-not-found as an error.

### US-005 — Executor snapshot ownership and universal replay

As a run owner, I want selected ENV patches frozen and replayed from run metadata, so that resume/retry never depends on mutable ENV rows.

Acceptance criteria:

- `ExecuteWorkflowOptions` accepts `appliedEnvOverlay?: AppliedEnvOverlay`; fresh foreground, background pre-create, and fallback run inserts include pending applied metadata at the first run-row write.
- Executor entry restores `metadata.envOverlay` from a pre-created run when the caller did not already apply it; it verifies workflow identity and patched-field equality when `appliedEnvOverlay` is supplied.
- Overlay-bearing pre-created runs derive execution identity from the run row's `user_id` for user AI preferences, provider/GitHub credentials, and child-run attribution; no-overlay runs preserve current `opts.userId` behavior.
- Before workflow-start events or DAG execution, the executor builds latest resolved metadata from the patched workflow and live config/profile, atomically replaces `metadata.envOverlay`, swaps in the returned run row, and fails closed if resolution or audit write fails.
- Resume/retry records currently missing originally applied ids in `latestMissingNodeIds` without mutating frozen `patches`; originally skipped ids never start applying later; live ENV edits/deletion after Start have no effect.
- Tests cover direct CLI-style resume, CLI-style node retry, web retry, child recovery, parent auto-resume, audit-write failure with no execution, and fresh child runs not inheriting the parent's overlay.

### US-006 — Orchestrator pre-isolation overlay gate and background handoff

As a dispatcher, I want ENV application before isolation and conversation mutation, so that invalid overlays fail cheaply and safely.

Acceptance criteria:

- `HandleMessageContext` and `WorkflowDispatchOptions` carry a frozen `EnvOverlayCandidate` out-of-band; it is never embedded in the natural-language command string.
- `dispatchOrchestratorWorkflow()` applies the request candidate or stored resume snapshot after declared-input/external-requirement gates and before conversation mutation or `validateAndResolveIsolation()`.
- Continuations ignore a newly supplied ENV and notify the user when the existing run owns an original selection; fresh runs use the request candidate; canonical workflow mismatch fails safely.
- Unsupported fields, explicit unknown providers, invalid patched nodes, and invalid graph references stop before isolation with safe code/message; logs include only env id/name, applied ids, skipped ids, and error codes.
- Foreground/background execution receives the patched clone and detached `AppliedEnvOverlay`; background pre-created rows are stamped with pending metadata and fallback insert remains equivalent.
- Tests spy on isolation and prove it is not called for invalid overlays while valid overlays and missing-id overlays retain current isolation behavior.

### US-007 — HTTP CRUD and preview API

As a console client, I want typed CRUD and preview endpoints, so that ENV management and preview use server-authoritative validation and field matrices.

Acceptance criteria:

- New server routes use `registerOpenApiRoute(createRoute(...), handler)` and route schemas under `packages/server/src/routes/schemas/workflow-env.schemas.ts`; no new per-resource ACL is added.
- CRUD endpoints implement `GET /api/workflows/{name}/envs`, `GET /api/workflows/{name}/envs/{envId}`, `POST`, `PATCH`, and `DELETE` with the specified 200/201/404/409 statuses and stable `{ error, detail? }` bodies.
- List responses omit `patches`; detail/create/update include camelCase `WorkflowEnvResponse`; delete returns `{ deleted }`; create provenance uses the server-resolved web user or null, never request input.
- CRUD validates workflow name/path/name/patch/size and does not require cwd or the workflow to be currently discoverable.
- Preview implements `GET /api/workflows/{name}/env-preview?cwd=<path>&envId=<optional>` with required validated cwd, canonical workflow resolution, no-ENV baseline, ENV identity checks, server-side clone/apply, targets, skipped ids, and current-profile resolved metadata.
- Route tests cover auth-gated normal registration, CRUD scoping/conflicts, preview root/descendant cwd semantics, canonical mismatch, safe failures without prompt/bash echo, and OpenAPI generation for CRUD/preview while Start keeps its multipart exception.

### US-008 — Start route envId freeze and orchestrator handoff

As a console starter, I want Start to freeze the selected ENV row before side effects, so that the run owns exactly the version the operator chose.

Acceptance criteria:

- `POST /api/workflows/:name/run` accepts optional `envId` in JSON and multipart forms; omitted or empty means YAML-only; non-string/duplicated multipart or non-string JSON values produce normal 400 request-shape errors.
- When `envId` is present, the route loads and validates the row after parsing request fields but before file persistence or run-start message persistence.
- Missing env id returns `400 { error: 'env_not_found' }`; workflow mismatch returns `400 { error: 'env_workflow_mismatch' }`; corrupt stored row fails before Start side effects.
- The frozen candidate contains row id, row name, row workflow name, and a newly allocated parsed patches tree; later mocked store mutation cannot change the context passed downstream.
- The route does not discover/apply YAML; compatibility/provider/profile/graph errors continue through dispatch/SSE rather than synchronous Start 400.
- Tests cover no-ENV, JSON ENV, multipart ENV, malformed/duplicate envId, missing id, row/path mismatch, corrupt row before side effects, and frozen-copy behavior.

### US-009 — Console start picker and preview

As a console operator, I want to select None or a workflow ENV and see a race-safe preview before starting, so that I do not accidentally launch the wrong variant.

Acceptance criteria:

- Generated OpenAPI types drive new ENV skills and encoded cache keys; `startRun()` sends or omits `envId` correctly for JSON and multipart starts.
- `DraftRunCard` loads ENV summaries for the selected canonical workflow, includes `None (YAML)` as default, and clears ENV selection, preview, and declared input values when the workflow changes.
- Preview requests are keyed or cancelled by cwd/workflow/env id so a slower prior response cannot overwrite a newer selection.
- UI renders provider-turn rows, skipped-id warnings, and “Preview only — the ENV, workflow, or model profile may change before Start.”
- List failure leaves explicit None/YAML Start usable; selected ENV detail or preview loading/failure disables Start and never silently resets to YAML-only.
- Unit/component tests cover JSON/multipart request shapes, stale response races, selection reset, disabled-on-error behavior, and preview/skipped rendering.

### US-010 — Console ENV management dialog

As a console operator, I want a workflow-specific ENV management dialog, so that I can create, edit, and delete patch maps using server-allowed target fields.

Acceptance criteria:

- The management dialog fetches baseline preview targets and `allowedFields` from the server instead of duplicating the node matrix in React.
- Summary list fetching excludes patch bodies; a full ENV is fetched only when opened for editing.
- The editor lets the operator choose target nodes and edit only fields in each target's allowed matrix; include-expanded ids render as returned; loop-group body ids are explained as non-targets.
- UI requires a non-empty patch per chosen node and normalizes thinking through explicit schema-supported choices or validated JSON.
- PATCH sends the complete patch map, not a deep delta; create/update/delete flows surface 409 conflicts, require delete confirmation, and invalidate ENV list plus affected preview cache keys.
- The dialog states prompt/bash bodies are plaintext install-visible data and does not describe them as secrets or encrypted.
- Component tests cover allowed-field rendering, full-map PATCH replacement, conflict/delete behavior, cache invalidation, and plaintext notice.

### US-011 — Run detail, docs, generated files, and full validation

As an operator reviewing a run, I want persisted ENV metadata documented and rendered accurately, so that preview, planned request metadata, node events, and final provider models are not confused.

Acceptance criteria:

- The console `Run` primitive defensively parses pending, complete, legacy, and malformed `metadata.envOverlay` without importing `@archon/workflows`; malformed metadata cannot crash run detail.
- Run detail adds an `env: <name>` chip for pending/complete overlay metadata, renders latest resolved rows with node/provider/requested model or tier/effort/thinking, and shows `skippedNodeIds` plus `latestMissingNodeIds` warnings.
- Run detail and table copy distinguish non-authoritative preview, latest planned request settings at start/resume, persisted node events as actual attempts, and provider-reported final models; prompt/bash bodies are never rendered.
- Docs update the API and workflow-authoring references for CRUD, Start JSON/multipart, preview, install-wide identity, field matrix, include ids, loop-group body exclusion, resume semantics, error channels, size bounds, plaintext storage, and absence of CLI selection.
- Generated OpenAPI types and bundled schema are refreshed; the application-table inventory is updated; PR review/release-note input calls out the `loop_group.model` behavior correction while leaving `CHANGELOG.md` to the release workflow.
- Implementation gate requires focused package tests, `bun run test`, `bun run validate`, `bun run check:schema-upgrades`, and manual console create/edit/select/preview/start/detail/resume/delete coverage for JSON and multipart Start paths.

### US-012 — Resume ignores newly selected ENV

As a dispatcher resuming a run, I want any newly selected ENV ignored before validation, so that a genuine continuation restores only its stored selection or YAML baseline.

Acceptance criteria:

- packages/core/src/orchestrator/orchestrator-agent.test.ts covers a paused resumable run with a valid stored ENV and an incompatible new request candidate; hydration returns a real resume payload and the run resumes with the stored selection plus the ignored-ENV notice.
- The same test file covers a YAML-only resumable run with an incompatible new request candidate; the run resumes as YAML-only and still emits the ignored-ENV notice instead of validating the candidate.
- The hydrate-null branch remains a fresh start: the request candidate is validated, incompatible fields are rejected before isolation, and the existing pre-isolation guarantee remains observable.
- dispatchOrchestratorWorkflow()/resolveFreshDispatchEnvOverlay() never validates or applies a request candidate for a genuine continuation; it restores only metadata.envOverlay or YAML when no stored overlay exists.
- Messages and logs for ignored or rejected ENVs contain only env ids, names, safe codes, and safe summaries; no prompt/bash bodies or patch values are emitted.
- Focused verification passes: cd packages/core && bun test src/orchestrator/env-overlay-dispatch.test.ts && bun test src/orchestrator/orchestrator-agent.test.ts.

Technical notes: Convergence task 1 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:791-795. Modify packages/core/src/orchestrator/orchestrator-agent.ts and, only if the pure contract requires it, packages/core/src/orchestrator/env-overlay-dispatch.ts. Preserve Contract 10 continuation semantics from plan lines 362-364 and the Phase 4 pre-isolation rejection guarantee for hydrate-null fresh starts.

### US-013 — Complete runtime resolution context

As an operator comparing ENV runs, I want Preview, snapshots, send options, and node_started fields resolved from the same full context, so that audit metadata cannot drift from runtime behavior.

Acceptance criteria:

- packages/workflows/src/executor.test.ts adds a regression using assistants.<provider>.modelReasoningEffort with no portable effort and workflow-level thinking fallback, then asserts metadata.envOverlay.resolved equals runtime node_started request fields.
- packages/server/src/routes/api.workflow-envs.test.ts adds the same coverage for ENV Preview and asserts the preview response matches the unchanged Start snapshot and runtime request metadata.
- packages/workflows/src/executor.ts passes every ResolveNodeExecutionOptions input used by resolveNodeProviderAndModel(), including config.assistants and effective workflow thinking, when building the snapshot resolved map.
- packages/server/src/routes/api.ts passes the same complete resolution context when building Preview; it does not approximate from { aiProfile } alone.
- packages/workflows/src/node-model-resolution.ts remains the single pure computation path for Preview, selected-run eager resolution, send options, and node_started serialization.
- Top-level and nested loop_group provider turns include the same legacy modelReasoningEffort fallback and thinking values in Preview, stored snapshot rows, runtime send options, and persisted node_started events.
- Focused verification passes: cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/executor.test.ts && bun test src/dag-executor.test.ts; then cd ../server && bun test src/routes/api.workflow-envs.test.ts.

Technical notes: Convergence task 2 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:797. Modify packages/workflows/src/executor.ts and packages/server/src/routes/api.ts. Follow Authoritative Contract 4 at plan lines 177-187, Preview at lines 329-352, and executor snapshot steps at lines 388-396. Depends on the existing shared-resolution, snapshot, preview, and resume-ignore stories.

### US-014 — Preset effort warns while explicit effort fails

As a workflow author, I want unsupported preset effort dropped with a warning while explicit portable effort still fails, so that tier aliases remain safe without weakening authored constraints.

Acceptance criteria:

- packages/workflows/src/node-model-resolution.test.ts adds a failing case for an OpenCode tier/alias preset carrying effort: high and proves the preset path returns presetEffortDropped: true.
- packages/workflows/src/dag-executor.test.ts adds runtime coverage proving the dropped preset effort reaches the existing warning layer and is not sent or recorded as applied metadata.
- A node-authored or workflow-authored explicit portable effort on the same provider still throws the existing fatal capability error.
- resolveNodeExecutionRequest() separates explicitly declared effort from preset?.effort so the later resolvePresetEffort() decision is reachable.
- packages/workflows/src/dag-executor.ts consumes the structured presetEffortDropped decision without adding a second classifier or string parser.
- Rejected preset effort is consistent in Preview, selected-run eager resolution, and ordinary lazy runtime.
- Focused verification passes: cd packages/workflows && bun test src/node-model-resolution.test.ts && bun test src/dag-executor.test.ts.

Technical notes: Convergence task 3 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:799. Modify packages/workflows/src/node-model-resolution.ts and packages/workflows/src/dag-executor.ts. Preserve Authoritative Contract 4: rejected preset effort warn/drop semantics and explicit portable effort fail-fast semantics from plan lines 179-182.

### US-015 — Console editor preserves empty ENV values

As a console operator editing ENVs, I want no-op ENVs and explicit empty prompt/bash bodies preserved, so that the UI does not erase values that the schema allows.

Acceptance criteria:

- packages/web/src/experiments/console/lib/workflow-env-editor.test.ts round-trips zero drafts to {}, explicit prompt: "", explicit bash: "", whitespace-only bodies, and absent body fields.
- packages/web/src/experiments/console/components/WorkflowEnvManageDialog.test.tsx proves create and full-map PATCH can submit patches: {}.
- WorkflowEnvManageDialog tests prove an explicitly enabled empty prompt or bash body can be saved and is not dropped by the editor.
- packages/web/src/experiments/console/lib/workflow-env-editor.ts represents field omission separately from field presence with an empty string.
- packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx preserves the non-empty-per-chosen-node rule while allowing a workflow with zero chosen targets to save a no-op ENV.
- Create/update keep prompt: "", bash: "", and whitespace byte-for-byte; untouched body controls remain omitted from the patch map.
- Focused verification passes: cd packages/web && bun test src/experiments/console/lib/workflow-env-editor.test.ts && bun test src/experiments/console/components/WorkflowEnvManageDialog.test.tsx.

Technical notes: Convergence task 4 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:801. Modify packages/web/src/experiments/console/lib/workflow-env-editor.ts and packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx. Follow node-field compatibility line 104, patch validation lines 114-122, Manage dialog lines 416-427, and Console matrix lines 660-668.

### US-016 — Defensive unknown patch-key rejection

As the workflow engine, I want applyEnvOverlay() to reject unknown raw patch keys even when a caller bypasses Zod, so that defensive validation cannot silently discard unsafe input.

Acceptance criteria:

- packages/workflows/src/env-overlay.test.ts bypasses the Zod boundary with a mixed raw patch such as { model: "x", typo: "secret-value" } on an existing node.
- The regression asserts applyEnvOverlay() fails with code forbidden_field and includes the unknown field name while excluding the unknown value and all prompt/bash bodies from error text.
- packages/workflows/src/env-overlay.ts validates original raw patch keys before copyNodePatch() can discard them.
- The detached normalized copy remains the source for assignment to cloned nodes and for returned applied/snapshot data.
- Mixed known/unknown raw patches cannot silently succeed; normal schema-validated patches behave unchanged.
- Focused verification passes: cd packages/workflows && bun test src/env-overlay.test.ts src/schemas/env-overlay.test.ts.

Technical notes: Convergence task 5 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:803. Modify packages/workflows/src/env-overlay.ts and packages/workflows/src/env-overlay.test.ts. Follow Patch validation line 112, Clone/apply behavior lines 194-205, and Engine matrix lines 607-619.

### US-017 — Malformed run metadata hides ENV UI

As an operator viewing run detail, I want malformed envOverlay metadata omitted instead of rendered as audit state, so that corrupted metadata cannot produce false confidence.

Acceptance criteria:

- packages/web/src/experiments/console/primitives/run.test.ts requires parseRunEnvOverlay() to return null for malformed hybrids: missing or non-object patches, non-array skippedNodeIds/latestMissingNodeIds, non-object resolved, and invalid resolved rows.
- packages/web/src/experiments/console/routes/RunDetailPage.test.tsx proves malformed metadata renders no ENV chip and no resolved table while the rest of the run detail still renders.
- Valid pending and complete overlay rendering remains covered in WorkflowEnvResolvedTable.test.tsx and RunDetailHeader.test.tsx.
- packages/web/src/experiments/console/primitives/run.ts accepts only strict pending and complete shapes, never exposes patch bodies, and returns null for malformed or legacy hybrids.
- RunDetailPage.tsx renders ENV-specific UI only for a non-null parsed overlay.
- Malformed metadata cannot manufacture complete: true, cannot show a misleading “No provider-turn request rows” state, and cannot crash or hide non-ENV run detail content.
- Focused verification passes: cd packages/web && bun test src/experiments/console/primitives/run.test.ts && bun test src/experiments/console/routes/RunDetailPage.test.tsx && bun test src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx.

Technical notes: Convergence task 6 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:805. Modify packages/web/src/experiments/console/primitives/run.ts and packages/web/src/experiments/console/routes/RunDetailPage.tsx. Follow runtime overlay types lines 126-160, Run detail lines 429-438, and Console matrix lines 667-668. Preserve the existing no-prompt/bash-body display rule.

### US-018 — Exact ENV name-conflict classification

As a store maintainer, I want workflow-ENV name conflicts classified only from the exact identity constraint, so that unrelated database failures are not converted into HTTP 409s.

Acceptance criteria:

- packages/core/src/db/workflow-envs.test.ts adds negative PostgreSQL cases where code is 23505 but constraint is absent or wrong, even if the message mentions uq_workflow_envs_workflow_name_name.
- The same test file covers duplicate-key prose without PostgreSQL code 23505 and verifies it is not classified as a workflow ENV name conflict.
- The SQLite negative case uses a UNIQUE error from another table whose message happens to include workflow_name and name columns, and verifies it is not classified as a workflow ENV conflict.
- packages/core/src/db/workflow-envs.ts returns true for PostgreSQL only when code === "23505" and constraint === "uq_workflow_envs_workflow_name_name".
- SQLite classification requires the UNIQUE message to name both fully qualified ENV identity columns for remote_agent_workflow_envs.
- Only the named workflow ENV identity conflict maps to WorkflowEnvNameConflictError and HTTP 409; unrelated database failures propagate through the normal error path.
- Focused verification passes: cd packages/core && bun test src/db/workflow-envs.test.ts.

Technical notes: Convergence task 7 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:807. Modify packages/core/src/db/workflow-envs.ts and packages/core/src/db/workflow-envs.test.ts. Follow Store contracts line 263 and Database/core matrix lines 623-632. Keep CRUD semantics from US-003; this story only tightens error classification.

### US-019 — Plan Constitution Check evidence

As a reviewer, I want the workflow ENV implementation plan to record constitution checks before and after design, so that PR readiness is auditable from the plan itself.

Acceptance criteria:

- The plan appends a retrospective pre-Phase-0 Constitution Check and a current post-design re-check tied to .specify/memory/constitution.md.
- Both checks explicitly evaluate package-layer direction, typed and OpenAPI schema rules, additive schema and generated-file handling, fail-closed lifecycle behavior, secret-safe audit metadata, focused/full validation, and intentional complexity.
- Every evaluated gate records concrete repository evidence, any violation, its accepted-use justification, and a rollback or simplification path instead of a generic PASS.
- Any unresolved constitutional violation is marked as a release blocker.
- Verification includes git diff --check and a manual comparison against the constitution Plan Quality Gate.

Technical notes: Convergence 2 task 8 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:813. Modify docs/superpowers/plans/2026-09-05-workflow-env-overlay.md only. Use .specify/memory/constitution.md:154-156 and .specify/memory/constitution.md:172-175 as the gate source. Do not change implementation code.

### US-020 — Resume claim delayed until gates pass

As a run owner, I want Archon to claim a resumable run only after conversation and isolation gates pass, so that a failed gate cannot strand the run as running.

Acceptance criteria:

- packages/core/src/orchestrator/orchestrator-agent.test.ts covers a paused run plus any supplied ENV id where updateConversation() fails; the run is never transitioned to running, execution is not invoked, and the original resumable state remains.
- The same test file covers a paused run plus any supplied ENV id where isolation returns IsolationBlockedError; the run is never transitioned to running, execution is not invoked, and the original resumable state remains.
- Read-only resume eligibility and stored snapshot inspection are split from the compare-and-set resume claim; the claim happens exactly once after conversation and isolation gates succeed.
- The hydrate-null branch remains a fresh start, and genuine continuations still ignore newly supplied request candidates.
- No return or throw between eligibility discovery and executor dispatch can leave a run running; concurrent claim rejection remains atomic.
- Focused verification passes: cd packages/core && bun test src/orchestrator/orchestrator-agent.test.ts; then cd ../workflows && bun test src/executor.test.ts.

Technical notes: Convergence 2 task 9 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:815. Modify packages/core/src/orchestrator/orchestrator-agent.ts and tests; update packages/workflows/src/executor.ts and executor tests only if the claim seam must move. Preserve Contract 10 continuation semantics and Convergence task 1 resume-candidate behavior.

### US-021 — Overlay pre-created preamble failures become terminal

As a background run owner, I want overlay-bearing pre-created runs failed when eager preamble resolution throws, so that audit failures cannot leave pending rows.

Acceptance criteria:

- packages/workflows/src/executor.test.ts covers an overlay-bearing preCreatedRun and a deterministic workflow-scope resolution failure after prepareExecutionEnvOverlay() but before workflow events or DAG scheduling.
- The executor regression asserts failWorkflowRun() is called once and no envOverlay snapshot write, workflow event, or DAG node execution is emitted.
- packages/core/src/orchestrator/orchestrator.test.ts covers background dispatch with an already-created pending row and proves the row does not remain pending after that failure.
- Config/profile/scope/provider eager resolution for active overlays runs inside an executor-owned fail-closed boundary; no-overlay behavior is unchanged.
- The failure path emits only env id/name/code-safe user messaging and never relies on the background caller's log-only catch to repair state.
- Focused verification passes: cd packages/workflows && bun test src/executor.test.ts; then cd ../core && bun test src/orchestrator/orchestrator.test.ts.

Technical notes: Convergence 2 task 10 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:817. Modify packages/workflows/src/executor.ts and packages/core/src/orchestrator/orchestrator.ts tests as needed. Follow Authoritative Contracts 4 and 10 plus background dispatch ordering; every exception after an overlay-bearing row exists must either return before claiming or leave the row terminally failed.

### US-022 — Exact envId HTTP omission and type contract

As a console/API caller, I want absent, empty, and non-string envId inputs handled exactly as documented, so that Start and Preview do not guess from malformed selection data.

Acceptance criteria:

- packages/server/src/routes/api.workflow-envs.test.ts proves Preview with ?envId= returns the YAML-only baseline without reading a workflow ENV row.
- packages/server/src/routes/api.workflow-runs.test.ts proves JSON { "envId": null } and other present non-string values return 400 { error: 'invalid_env_id' } before lookup or dispatch.
- The Preview query schema allows an empty envId to reach the baseline handler instead of failing generic validation.
- parseOptionalEnvIdField() treats only absence and empty strings as omission; JSON null is never treated as omission.
- Duplicate or non-string multipart envId remains rejected, and baseline/rejected cases avoid unnecessary mutable ENV lookups.
- Checked-in web API types are regenerated or proven unchanged if the OpenAPI request shape changes.
- Focused verification passes: cd packages/server && bun test src/routes/api.workflow-envs.test.ts && bun test src/routes/api.workflow-runs.test.ts, followed by the repository's focused generated-type check.

Technical notes: Convergence 2 task 11 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:819. Modify packages/server/src/routes/api.ts and the server route tests. Follow HTTP API contract lines 304-319, Preview lines 329-352, Start lines 354-384, and Server/API matrix lines 646-659.

### US-023 — Stable ENV request validation errors

As an API client, I want workflow-ENV schema failures to return stable safe error bodies even when OpenAPI validation rejects before the handler.

Acceptance criteria:

- packages/server/src/routes/api.workflow-envs.test.ts asserts 400 { error: 'invalid_env_request', detail: <safe summary> } for invalid ENV name, unknown node patch field, empty per-node patch, over-256-node patch map, over-1-MiB request, and empty PATCH body.
- The same tests prove prompt bodies, bash bodies, unknown-field values, and other patch values are absent from validation details and logs under these failures.
- Route-scoped validation mapping works with registerOpenApiRoute() so request-schema failures cannot fall through to the global default hook's field-path prose.
- Unrelated routes keep their existing validation body behavior.
- Workflow ENV name conflicts still map only to the existing 409 conflict response.
- Checked-in API types are regenerated only if the public schema changes.
- Focused verification passes: cd packages/server && bun test src/routes/api.workflow-envs.test.ts.

Technical notes: Convergence 2 task 12 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:821. Modify packages/server/src/routes/api.ts, packages/server/src/routes/schemas/workflow-env.schemas.ts, and route tests. Follow HTTP API contract lines 304-327, Phase 5 CRUD lines 566-570, and Server/API matrix lines 646-655. Do not broaden validation behavior outside workflow ENV routes.

### US-024 — Mounted ENV manager saves no-op patches

As a console operator, I want the mounted workflow ENV manager to create and replace with an empty patch map, so that no-op ENVs work in the real dialog.

Acceptance criteria:

- packages/web/src/experiments/console/components/WorkflowEnvManageDialog.test.tsx mounts create flow for a workflow with no editable targets and asserts POST receives { patches: {} }.
- The same mounted test covers edit flow where every patch is removed and asserts PATCH receives the complete replacement { patches: {} }.
- Workflow detail/target discovery loading is resolved in the tests so the assertions cover rendered dialog behavior, not only helper functions.
- WorkflowEnvManageDialog.tsx distinguishes target discovery loading or failure from successful discovery with zero targets; only loading/failure blocks submit.
- Dialog copy promising a no-op ENV remains true, while loading/error states still cannot overwrite an ENV accidentally.
- Focused verification passes: cd packages/web && bun test src/experiments/console/components/WorkflowEnvManageDialog.test.tsx src/experiments/console/lib/workflow-env-editor.test.ts.

Technical notes: Convergence 2 task 13 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:823. Modify packages/web/src/experiments/console/components/WorkflowEnvManageDialog.tsx and its mounted tests. Follow Convergence task 4/US-015 but replace helper-only coverage with component-level create/edit behavior.

### US-025 — Picker and start component race regressions

As a console operator, I want component tests for ENV picker/start wiring and workflow-switch races, so that async responses cannot launch or preview the wrong ENV.

Acceptance criteria:

- packages/web/src/experiments/console/components/WorkflowEnvPicker.test.tsx exists and mounts the rendered picker with controlled asynchronous list/detail/preview responses.
- packages/web/src/experiments/console/components/DraftRunCard.test.tsx exists and mounts the rendered start card with controlled asynchronous ENV responses and Start submission.
- Component tests prove None is the default, list failure still permits None/YAML-only Start, and outbound Start omits envId for None while including it for a selected ENV.
- Component tests prove a retained selected id can show its own loading/error state, selected-ENV loading/error retains the selection and disables Start, and changing workflow resets ENV and inputs immediately.
- Component tests prove a stale prior-workflow response cannot replace current options or preview; pure lib/draft-env.test.ts coverage remains only supporting coverage.
- Focused verification passes: cd packages/web && bun test src/experiments/console/components/WorkflowEnvPicker.test.tsx src/experiments/console/components/DraftRunCard.test.tsx src/experiments/console/lib/draft-env.test.ts.

Technical notes: Convergence 2 task 14 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:825. Add component-level tests for packages/web/src/experiments/console/components/WorkflowEnvPicker.tsx and DraftRunCard.tsx. Follow Preview/Start wiring lines 392-415, race/reset requirements lines 458-463, Phase 6 exit gate lines 573-584, and validation lines 729-733.

### US-026 — Missing-node raw patch keys rejected

As a workflow engine maintainer, I want raw patch-key validation to run before missing-node skipping, so that deleted targets cannot bypass defensive field checks.

Acceptance criteria:

- packages/workflows/src/env-overlay.test.ts bypasses the Zod boundary with a missing target patch such as { missing: { typo: 'secret-value' } }.
- The regression asserts applyEnvOverlay() fails with code forbidden_field, mentions only the unknown key, and does not leak the unknown value or any prompt/bash body.
- A missing-node patch containing only allowed fields still succeeds and reports the node in skipped ids.
- applyEnvOverlay() validates original raw patch keys before the missing-node early continue and before copyNodePatch() can discard unknown fields.
- Valid missing-node skip semantics and normal schema-validated patches remain unchanged.
- Focused verification passes: cd packages/workflows && bun test src/env-overlay.test.ts src/schemas/env-overlay.test.ts.

Technical notes: Convergence 2 task 15 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:827. Modify packages/workflows/src/env-overlay.ts and packages/workflows/src/env-overlay.test.ts. This extends US-016 to missing targets and must preserve skip behavior from the clone/apply contract.

### US-027 — Programmatic modelReasoningEffort parity

As an engine caller, I want programmatic workflows using legacy modelReasoningEffort to resolve like loader-normalized YAML, so that audit, Preview, events, and provider requests stay aligned.

Acceptance criteria:

- packages/workflows/src/node-model-resolution.test.ts covers an unexpanded programmatic workflow with workflow-level modelReasoningEffort and no portable effort.
- packages/workflows/src/executor.test.ts compares that workflow's envOverlay snapshot row to runtime node_started request fields and provider request options.
- The shared workflow-scope resolver uses workflow.effort ?? workflow.modelReasoningEffort as the fallback without adding a second resolver.
- Loader-normalized YAML and programmatic legacy definitions produce the same effective effort in Preview, stored snapshot, node_started events, and provider request options.
- Preview and audit parity remains routed through packages/workflows/src/node-model-resolution.ts as the single computation path.
- Focused verification passes: cd packages/workflows && bun test src/node-model-resolution.test.ts src/executor.test.ts src/dag-executor.test.ts.

Technical notes: Convergence 2 task 16 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:829. Modify packages/workflows/src/node-model-resolution.ts and packages/workflows/src/executor.ts/tests; update server Preview only if it consumes the workflow-scope resolver differently. Follow Authoritative Contract 4, Preview, and executor snapshot requirements.

### US-028 — Strict run-detail ENV parser fields

As a console operator, I want run-detail ENV metadata parsing to reject malformed optional fields and unknown keys, so that corrupt metadata cannot look like a valid provider-only row.

Acceptance criteria:

- packages/web/src/experiments/console/primitives/run.test.ts asserts parseRunEnvOverlay() returns null when a resolved row has a present non-string model, invalid tier, invalid effort, malformed or unsupported thinking, or an unexpected key.
- The same test file asserts a complete overlay object with an unexpected top-level key returns null.
- The local web parser requires exact pending and complete shapes plus exact resolved-row field types without importing runtime code from @archon/workflows.
- Valid pending and complete metadata rendering remains unchanged, and run detail omits only the corrupt ENV section while preserving the rest of the run detail.
- Focused verification passes: cd packages/web && bun test src/experiments/console/primitives/run.test.ts src/experiments/console/routes/RunDetailPage.test.tsx src/experiments/console/components/WorkflowEnvResolvedTable.test.tsx src/experiments/console/components/RunDetailHeader.test.tsx.
- After this final Convergence 2 story, Phase 8 gates are rerun for the corrected tree, including generated checks, check:schema-upgrades, validate, and git diff --check; earlier Ralph validation claims are not reused.

Technical notes: Convergence 2 task 17 in docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:831, plus Convergence instructions at docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:793 and validation gates at docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:691-747. Modify packages/web/src/experiments/console/primitives/run.ts, run.test.ts, and run-detail component tests. This extends US-017 strict malformed-metadata behavior.

## Implementation and Validation Gates

Ralph should implement exactly one story per fresh-context iteration. Each story is complete only when its acceptance criteria pass. The final story carries the repo-wide gates from `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:597-604` and `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:691-747`:

- Focused package tests during each owning story.
- `bun run test` from the repository root; never root `bun test`.
- `bun run validate` before PR.
- `bun run check:schema-upgrades` against live PostgreSQL for the schema change.
- Manual console exercise for create/edit/select/preview/start/detail/resume/delete with both JSON and multipart Start paths.

## Deployment, Compatibility, and Rollback Notes

- Migration is additive and startup-applied; no backfill or down migration (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:751-753`).
- Mixed-version execution is unsafe for overlay-bearing resumable runs because old executors cannot replay snapshots; finish or abandon overlay-bearing non-terminal runs before rollback (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:754-756`, `docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:787`).
- ENV deletion affects only future starts; run snapshots remain self-contained (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:757`).
- Snapshot freezes the ENV delta, not the full workflow/config/profile; resume reapplies the delta to current YAML and recomputes resolution (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:758`).
- Prompt/bash bodies and snapshots are plaintext database content visible within the install; they are not secrets (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:760`).
- Patch duplication is bounded to at most 1 MiB per selected run and uses bounded linear passes with no per-node database queries (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:761`).

## Open Questions

No unresolved design question blocks implementation (`docs/superpowers/plans/2026-09-05-workflow-env-overlay.md:789`).
