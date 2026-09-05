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
