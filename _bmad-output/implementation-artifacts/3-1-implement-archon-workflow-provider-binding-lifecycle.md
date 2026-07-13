# Story 3.1: Implement Archon Workflow Provider Binding Lifecycle

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a workflow integration administrator,
I want Archon to manage provider-neutral reverse event bindings with provider and name identity,
so that external controllers can receive workflow events without Hermes-specific Archon commands or model names.

## Acceptance Criteria

1. **Given** Archon stores a Workflow Provider Binding
   **When** the binding is created or updated
   **Then** Archon persists the controller by project or codebase reference plus generic `provider` and `name`
   **And** the record includes the workflow event route or target reference required for event delivery.

2. **Given** an external controller needs to change an existing Workflow Provider Binding
   **When** it invokes `archon provider-binding update --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json`
   **Then** Archon returns a `binding.update` command envelope with the updated binding reference and machine-readable result
   **And** create remains a distinct command that fails closed instead of silently upserting when update is required.

3. **Given** a Workflow Provider Binding is inspected
   **When** Archon returns status JSON
   **Then** the response can represent missing, valid, stale, disabled, rotated, and conflicting states
   **And** the response uses the shared status result shape.

4. **Given** a Workflow Provider Binding needs rotation or disabling
   **When** Archon performs the lifecycle action
   **Then** Archon returns parseable CLI JSON with correlation id, actor when available, timestamp, resulting binding state, and machine-readable error shape when failed
   **And** Archon does not expose Hermes-specific command names or fields.

5. **Given** a provider binding command receives malformed input or cannot produce valid JSON
   **When** the command fails
   **Then** Archon returns a machine-readable failure envelope
   **And** downstream consumers can fail closed without inspecting human-readable text.

> **Note on AC4 "actor"**: the checked-in `workflow-command-envelope.schema.json` has `additionalProperties: false` and defines **no `actor` field**, and no local fixture uses one. Do not add a top-level `actor` key — it will fail contract validation. See "Known Contract Gaps" below for how to handle this without inventing a schema field.

## Tasks / Subtasks

- [ ] **Task 1 — Binding storage, migration, and create/status (AC: 1, 3, 5)**
  - [ ] Add `remote_agent_workflow_provider_bindings` to `migrations/000_combined.sql` (Postgres) AND `packages/core/src/db/adapters/sqlite.ts` `createSchema()` (SQLite) — see "DB Design Proposal" below for the exact columns. Both must be edited; SQLite does **not** read the SQL file.
  - [ ] Run `bun run generate:bundled-schema` after editing the SQL (verify with `bun run check:bundled-schema`).
  - [ ] Add `packages/core/src/schemas/workflow-provider-binding.ts` — Zod row schema mirroring the new table, **snake_case fields matching the DB columns 1:1** (e.g. `codebase_id`, `event_route`, `binding_version`, `created_at`) — this is the project convention (`env-var.ts`'s `codebaseEnvVarSchema` has `codebase_id`/`created_at`; `codebase.ts`'s `codebaseRowSchema` has `repository_url`/`default_cwd`; only the schema *variable name* is camelCase, never the row fields). Re-export from `packages/core/src/schemas/index.ts`.
  - [ ] Add `packages/core/src/db/provider-bindings.ts` (per architecture's Source Tree Seed) with `createBinding()`, `getBinding(provider, name)`, `getBindingByCodebase(...)` as needed. `createBinding()` must use `INSERT ... ON CONFLICT (provider, name) DO NOTHING` (or equivalent) and check `rowCount === 0` to detect an existing row — **never** upsert (AC2).
  - [ ] Add `packages/cli/src/commands/provider-binding.ts` implementing `create` and `status`. Register `provider-binding` in `packages/cli/src/cli.ts`'s command switch (alongside `workflow`/`isolation`) and add `provider`, `name`, `project-ref`, `route`, `correlation-id` to the `parseArgs` `options` map.
  - [ ] Resolve `--project-ref` to a registered `remote_agent_codebases` row (see "Project-Ref Resolution" below). `create`/`update` fail closed (`MALFORMED_REQUEST`) if it doesn't resolve — do **not** auto-register a codebase the way `workflow run` does.
  - [ ] Focused tests: `provider-bindings.test.ts` (mocked `pool.query`, mirror `user-provider-key-store.test.ts`) covering create-success, create-on-existing (must fail, not upsert), and status (missing + valid). CLI tests asserting `create`/`status` JSON output structurally matches `examples/providers/archon/commands/binding-create-success.json` and `binding-status-success.json` (see "Contract Fixture Test Strategy" below for field-name gotchas).
  - [ ] Run `bun run validate` (there is no scoped/partial mode — it always runs the full monorepo check:bundled/type-check/lint/format/test suite) before moving to Task 2.

- [ ] **Task 2 — Update lifecycle (AC: 2)**
  - [ ] Add `updateBinding()` in `packages/core/src/db/provider-bindings.ts` — `UPDATE ... WHERE provider=$1 AND name=$2`, check `rowCount === 0` → `BINDING_NOT_FOUND` failure (update on a nonexistent binding must fail, not create one).
  - [ ] Add `update` subcommand to `packages/cli/src/commands/provider-binding.ts` emitting a `binding.update` command envelope (`workflow-command-envelope.v1`), matching `examples/providers/archon/commands/binding-update-success.json`.
  - [ ] Tests: update-success (existing binding), update-on-missing (must fail closed), and a test proving `create` on an already-created `(provider, name)` still fails after an `update` was performed (i.e., update never silently creates a row `create` could have raced with).
  - [ ] Run `bun run validate` (full monorepo check, no partial mode) before moving to Task 3.

- [ ] **Task 3 — Rotate and disable (AC: 4)**
  - [ ] Add `rotateBinding()` — increments a `binding_version` counter and sets `state = 'rotated'`; implement as `UPDATE remote_agent_workflow_provider_bindings SET binding_version = binding_version + 1, state = 'rotated', updated_at = ... WHERE provider=$1 AND name=$2` then a follow-up `SELECT` (SQLite has no `RETURNING` on `UPDATE` — see `packages/core/src/db/workflows.ts:530-613` for the UPDATE-then-SELECT pattern to mirror). Per "Known Contract Gaps" below, this is a **pure version-counter bump** — do not add secret-material storage/generation.
  - [ ] Add `disableBinding()` — `UPDATE ... SET state = 'disabled' WHERE provider=$1 AND name=$2`; must **not** delete the row (preserves audit history — Workflow Commander v1 has no remove operation).
  - [ ] Add `rotate`/`disable` subcommands to the CLI, matching `examples/providers/archon/commands/binding-rotate-success.json` and `binding-disable-success.json`.
  - [ ] Tests: rotate increments version and returns `previousVersion`/`activeVersion`; rotate/disable on a missing binding fails closed (`BINDING_NOT_FOUND`); disable is idempotent-safe (disabling an already-disabled binding does not error ambiguously — decide and document the exact behavior in Dev Agent Record).
  - [ ] Run `bun run validate` (full monorepo check, no partial mode) before moving to Task 4.

- [ ] **Task 4 — Status diagnostics and contract validation (AC: 3, 5)**
  - [ ] Extend `status` to detect and report all contract-defined states: `missing` (no row for `provider`+`name`), `active`/`valid`, `disabled`, `rotated`, `conflicting` (supplied `--project-ref` resolves to a different codebase than the one stored on the binding — report via `{ path: "/repositoryPath", code: "path-mismatch" }` matching `status-conflicting.json`). See "The 'stale' State" below for why `stale` needs no active detection logic in this story.
  - [ ] Add malformed-input handling: missing `--provider`/`--name` on any subcommand returns a `MALFORMED_REQUEST` envelope with `fieldErrors: [{path: "/provider", code: "required"}, ...]`, matching `examples/providers/archon/commands/error-malformed-request.json`.
  - [ ] Add a CLI envelope conformance test that loads every fixture under `examples/providers/archon/commands/binding-*.json` and `error-malformed-request.json` and asserts your envelope-builder's TypeScript output structurally matches each one (field-by-field, excluding the inherently dynamic `correlationId`/`issuedAt`). This is the ONLY fixture family this story's application code must conform to — see "Contract Fixture Test Strategy" and the note below on `bindings/*.json` scope.
  - [ ] Run `python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py` (should already pass — this task doesn't modify the contract package; it's included here as a regression check, not a new obligation) and `bun run validate` for the full story before marking done.

> **Scope note on `examples/providers/archon/bindings/*.json`**: do NOT write a second Zod schema or any application code to validate against this fixture family. It models a deeply nested request/result/status/error envelope (`shape`, `operation`, `bindingRef{provider,name,bindingId,projectRef}`, top-level `projectRef{id,repositoryPath,defaultBranch}`, request-only fields like `desiredState`/`capabilities` that map to no CLI flag) that has no consumer in this story's scope — there is no HTTP surface and no other Archon code path that produces or reads `workflow-provider-binding.v1` payloads in v1. These fixtures stay validated by the already-passing, contract-package-local `validate_contracts.py` (a static Python check, unaffected by anything this story changes) — that is sufficient; inventing a matching Zod schema here would be speculative scope with no current caller (YAGNI).

## Dev Notes

### Scope Boundary (read first)

This story is **binding lifecycle only**: `binding.create`, `binding.update`, `binding.status`, `binding.rotate`, `binding.disable`. It explicitly excludes (owned by later stories, do not implement here):
- `workflow.start/status/approve/reject/resume/retry/cancel` CLI commands and the generic shared command-envelope **helper/builder** (Story 3.3a/3.3b/3.3c/3.3d).
- Workflow event production, the event outbox, signing, or delivery status (Story 3.5, 3.7).
- Any Hermes-owned behavior: Project Binding, BMAD mount, materialization, Project Work Items, Phase Tasks, HILT Gates, reconciliation, diagnostics, user interaction.
- Any Archon Web UI, workflow builder screens, or new in-product UI — this story is CLI-only. **No HTTP route.** [Source: prd.md#Functional Requirements Owned By Archon, FR-8 Consequences: "Archon does not expose a state-changing HTTP control path for Workflow Commander v1."]

It is fine — expected, even — for the CLI JSON output shape to overlap with what Story 3.3a will later formalize as a shared envelope builder. Implement the envelope construction locally in `provider-binding.ts` for now (a small local helper is fine per KISS/YAGNI); 3.3a may refactor it into a shared module later, but that refactor is out of scope here.

### Contract Package (source of truth — read before writing any JSON shape)

Local contract package: `_bmad-output/planning-artifacts/contracts/workflow-commander/`. Validate with:
```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```
This already passes (confirmed at story-creation time: 7 schemas, 17 command examples, 13 binding examples all validated). **Do not add, remove, or hand-edit files in `contracts/workflow-commander/`** — this story's job is to make Archon's runtime code produce output that conforms to what's already there, not to change the contract. If you find you need a field the contract doesn't have, STOP and flag it — per AD-9, do not invent it.

Two **distinct** schemas are in play, both relevant to this story — do not conflate them:

| | `schemas/workflow-command-envelope.schema.json` | `schemas/workflow-provider-binding.schema.json` |
|---|---|---|
| `schemaVersion` const | `workflow-command-envelope.v1` | `workflow-provider-binding.v1` |
| Represents | The actual **CLI `--json` stdout** for every `archon provider-binding <verb>` invocation | The binding **domain/lifecycle payload shape** (request/result/status/error) |
| Top-level `additionalProperties` | `false` | `false` (nested `request`/`result`/`status`/`error.details` use `machineObject`, which is `additionalProperties: true`) |
| Fixtures | `examples/providers/archon/commands/binding-*.json` | `examples/providers/archon/bindings/*.json` |
| Error `category` enum | 7 values: `configuration, external_delay, implementation_defect, provider_contract, security_rejection, timeout, unexpected_state` | 4 values only: `configuration, provider_contract, security_rejection, unexpected_state` (no `timeout`/`external_delay`/`implementation_defect`) |

**Required output**: the CLI's stdout for `--json` must conform to `workflow-command-envelope.schema.json` (that's what "Provider CLI Syntax Baseline" in epics.md/architecture.md describes, and what a controller actually parses) — validated against the `commands/binding-*.json` fixtures (Task 4). The `workflow-provider-binding.schema.json` family and its `bindings/*.json` fixtures are **out of scope for application code** in this story — see the scope note under Task 4 for why, and do not write a second schema to satisfy them.

### Contract Fixture Test Strategy — field-name gotcha

The two fixture families use **different field names for the same concept** even though the JSON schema itself is permissive (`machineObject` allows any extra properties, so neither family's schema enforces the other's shape). Concretely, for the "create" operation:

- `examples/providers/archon/commands/binding-create-success.json` → `result: { operation, state, created, bindingVersion }`
- `examples/providers/archon/bindings/create-success.json` → `result: { created, activeVersion, controllerIdentity }`

`bindingVersion` vs `activeVersion` are **not** the same key. When writing tests that assert structural equality against a specific fixture file, match that file's exact field names — do not assume the two families are interchangeable or that one implementation can satisfy both verbatim with the same result object.

Also do not conflate two different `projectRef` shapes that both appear in this contract package: the command envelope's `bindingRef.projectRef` is a **plain string** (e.g. `"project:workflow-engine"`), required on every live CLI output this story produces; the binding-schema family's top-level `projectRef` is a **structured object** (`{id, repositoryPath, defaultBranch}`), which only appears in the out-of-scope `bindings/*.json` family (see the scope note in Task 4). Your CLI envelope-builder only ever needs to produce the string form.

### Known Contract Gaps (documented scope decisions — do not "fix" these by inventing schema fields)

1. **AC4 mentions "actor when available"** but neither schema defines an `actor` field, and both are `additionalProperties: false` at the top level. **Do not add a top-level `actor` key** — it will fail `validate_contracts.py`-style structural validation. If actor/identity context is genuinely needed, it may go inside `result`/`error.details` (which permit `additionalProperties: true`), but there is no current fixture requiring it. Recommended: omit entirely for this story; note this gap in the Dev Agent Record's Completion Notes so a reviewer can decide whether to raise it against the contract package.
2. **The `stale` state** (AC3, and epics.md's Integration Validation line) has **no detection trigger defined anywhere in the contract or PRD** — no version-comparison protocol, no explicit "expected version" input on `binding.status`. `status-stale.json`'s `observedVersion`/`expectedVersion` fields are inside the permissive `machineObject`, not schema-mandated. Reconciliation is explicitly Hermes-owned (architecture.md AD-6, PRD "Scope Not Owned By Archon"). **Do not build a staleness-detection subsystem** — that would be speculative scope per this project's YAGNI rule. Instead: (a) make the `state` type/enum able to represent `'stale'` so the code path exists and the fixture continues to validate structurally, (b) do not wire any real CLI path to auto-produce it in v1, (c) note this explicitly in Completion Notes as a documented gap, not a silent omission.
3. **`rotate` is a pure version-counter bump, not a secret-rotation operation.** Confirmed by cross-referencing `workflow-event-envelope.schema.json`: `profileRoute.secretRef` is a namespaced pointer string (e.g. `"secret:hermes/workflow-engine-primary/webhook"`), never raw secret material, and the contract validator (`validate_contracts.py`) actively forbids raw secrets/signing material appearing in any schema or example. Nothing in `workflow-provider-binding.schema.json` or the delivery-status schema requires binding-lifecycle code to mint or store cryptographic secrets — that's Story 3.5's concern if/when it needs one. Do not add a nullable "secret" column speculatively (AD-9 + YAGNI).
4. **`--route <event-route>` has no fixed JSON field name** in either fixture family's `request`/`result` objects (both example families omit an explicit route/eventRoute key in their sample payloads, even though epics.md/architecture.md's CLI syntax table requires the flag). Since `machineObject` permits arbitrary additional properties, persist it under a consistent field — recommend `eventRoute` in JSON output and an `event_route` DB column — and pass it through create/update. This doesn't violate any schema.

### Project-Ref Resolution (design decision — not contract-mandated verbatim, documented so it's easy to correct in review)

`--project-ref <project-ref>` should resolve to a `remote_agent_codebases` row. Recommended: treat the flag's value as the codebase `id` (matches `projectRef.id` in the schema; `repositoryPath`/`defaultBranch` in the response are then derived from that row's `default_cwd`/`default_branch` — see `packages/core/src/schemas/codebase.ts`). `create`/`update` require the flag and fail closed (`MALFORMED_REQUEST`) if it doesn't resolve to an existing codebase — **do not auto-register**, unlike `workflow run`'s `registerRepository()` fallback (`packages/cli/src/commands/workflow.ts:632-639`) — provider-binding is a stricter, controller-facing surface. `status`'s `--project-ref` is optional per the CLI syntax table; when supplied, compare it against the binding's stored codebase reference and report `conflicting` (with `{path: "/repositoryPath", code: "path-mismatch"}`) on mismatch, matching `status-conflicting.json`.

### DB Design Proposal

New table `remote_agent_workflow_provider_bindings` (design choice — adjust if code review surfaces a better fit, but keep `UNIQUE(provider, name)` and the no-delete/no-upsert invariants):

```
id            UUID/TEXT PK
provider      TEXT NOT NULL          -- controller-declared, e.g. 'archon'
name          TEXT NOT NULL          -- binding name, e.g. 'workflow-engine-primary'
codebase_id   UUID/TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE
event_route   TEXT NOT NULL          -- from --route; opaque to this story
state         TEXT NOT NULL DEFAULT 'active'   -- 'active' | 'disabled' | 'rotated' (persisted states only)
binding_version INTEGER NOT NULL DEFAULT 1
created_at / updated_at
UNIQUE (provider, name)
```

Notes:
- `missing`, `conflicting`, `malformed`, `stale` are **response-only** derived states, never persisted directly on the row (see "Known Contract Gaps" #2 for `stale`).
- `bindingId` (the external `"wpb_archon_workflow_engine_primary"`-style string seen in fixtures) can be derived deterministically from `provider`/`name` at read time rather than stored — avoid a redundant column per YAGNI, but this is a judgment call, not a hard requirement.
- Mirror `remote_agent_isolation_environments`' pattern for a lifecycle-`status`-style column: plain `TEXT` with valid values documented in a comment, not a DB-level enum. [Source: `migrations/000_combined.sql:174-217`, `packages/core/src/db/adapters/sqlite.ts:486-506`]
- `codebase_env_vars`' upsert pattern (`packages/core/src/db/env-vars.ts:26-40`) is the closest existing analog for the `dialect.generateUuid()` / `dialect.now()` helpers, but note `create` must NOT use `ON CONFLICT DO UPDATE` (that's the upsert this story explicitly forbids) — use `ON CONFLICT DO NOTHING` + `rowCount` check instead.
- Error `category` for "create called on an existing binding": use `unexpected_state` with a code like `BINDING_ALREADY_EXISTS` (the `code` field is a free string, not enum-constrained — only `category` is closed) and `details: { currentState: 'active', expectedStates: ['missing'], mutationApplied: false }`, modeled on `examples/providers/archon/commands/error-unexpected-state.json`'s shape (that fixture happens to model `workflow.approve`, but the shape generalizes).
- Failure envelopes should include an `execution` object with `stdoutRedacted: true, stderrRedacted: true` (matches every error fixture); success fixtures omit `execution` entirely — don't add it to success responses.

### Architecture & Conventions to Follow

- **Row schema**: `packages/core/src/schemas/workflow-provider-binding.ts` — camelCase *schema variable name* (e.g. `workflowProviderBindingSchema`), but **snake_case row fields** matching the DB columns 1:1 (e.g. `codebase_id`, `event_route`, `binding_version`), `z.infer<typeof ...>` for the derived type, `z` imported from `@hono/zod-openapi`, re-exported from `packages/core/src/schemas/index.ts` (pattern: `packages/core/src/schemas/env-var.ts`, full 18-line file — copy its shape exactly, including the snake_case fields).
- **DB access module**: `packages/core/src/db/provider-bindings.ts` per architecture's Source Tree Seed [Source: architecture.md#Source Tree Seed]. Use `pool`/`getDialect()` from `./connection` like `packages/core/src/db/env-vars.ts`.
- **SQLite has no `RETURNING` on UPDATE/DELETE** — enforced at `packages/core/src/db/adapters/sqlite.ts:76-85` (throws if you try). For rotate/update, do the UPDATE (checking `rowCount`), then a separate `SELECT`, mirroring `packages/core/src/db/workflows.ts:530-613`'s compare-and-swap-then-select pattern.
- **CLI command file**: `packages/cli/src/commands/provider-binding.ts` per architecture's Source Tree Seed. Register the `provider-binding` case in `packages/cli/src/cli.ts`'s command switch, next to `case 'workflow':` (starts at `cli.ts:455`) and `case 'isolation':`. Since `provider-binding` will not be in the `noGitCommands` array (`cli.ts:340-353`), the CLI already resolves `cwd` → git repo root into `effectiveCwd` before your handler runs — you don't need to re-implement that.
- **New CLI flags**: add `provider`, `name`, `'project-ref'`, `route`, `'correlation-id'` to the `parseArgs` `options` map (`cli.ts:274-303`) — `strict: false` still requires explicit declaration for correct `string` typing (see how `branch`, `from`, `'conversation-id'` etc. are declared). None of these flag names currently exist (verified via grep) — no collision.
- **`correlationId` generation**: no existing convention in the codebase (`grep -rn "correlationId" packages/` was empty at story-creation time — this is a genuinely new concept for Archon). Accept an optional `--correlation-id` (mirrors `--conversation-id`'s pattern), default to `crypto.randomUUID()` when omitted. Every operation, including `status`, must include a `correlationId` in its output (it's in both schemas' top-level `required` list unconditionally).
- **JSON error-shape precedent**: only one existing shared helper exists anywhere in the CLI, `printJsonWriteError` in `packages/cli/src/commands/workflow.ts:1421-1425`, and it's local/unexported with a different (simpler) shape than what this story needs. There is nothing reusable to import — write a small local envelope-builder function inside `provider-binding.ts` (do not try to force-fit `printJsonWriteError`).
- **Timestamps**: `issuedAt`/`observedAt`/`requestedAt` are `format: date-time` — use `new Date().toISOString()`.
- **`--json` logging discipline**: when `--json` is passed, stdout must be *exactly* the JSON payload — no Pino log lines. The existing CLI already does this globally (`setLogLevel('silent')` when `jsonFlag`, `cli.ts:363-370`) — you get this for free by wiring through the existing `jsonFlag`, just don't `console.log`/`console.error` anything extra in `--json` mode.

### Testing Requirements

- Follow `packages/core/package.json`'s per-package test-isolation split (CLAUDE.md: "20 batches" for `@archon/core`) — add your new test file(s) to a script line that doesn't conflict with existing `mock.module()` usage. Mirror `packages/core/src/db/user-provider-key-store.test.ts` (mocked `pool.query` + `mockPostgresDialect` from `packages/core/src/test/mocks/database.ts`) as the primary DB-layer test pattern — assert on SQL string shape and bound params via `expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(...), [...])`, not a real DB connection.
- Add adapter-level coverage in `packages/core/src/db/adapters/sqlite.test.ts` / `postgres.test.ts` only if the new `CREATE TABLE`/unique index needs direct verification beyond the mocked-query tests.
- CLI-level tests should assert `--json` stdout against the checked-in fixtures structurally (ignoring timestamp/correlationId values, which are inherently dynamic) — do not hand-roll expected JSON from scratch; load the actual fixture files from `_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-*.json` and diff against them field-by-field (excluding `correlationId`/`issuedAt`/`observedAt`).
- **Do not run root `bun test`** — use `bun run test` or a single-file invocation per CLAUDE.md.
- Run `bun run validate` before marking the story done — it chains `check:bundled`, `check:bundled-schema` (will fail if you edited `migrations/000_combined.sql` without regenerating), type-check, lint (`--max-warnings 0`), format check, and the full test suite.

### Project Structure Notes

- New files land exactly where architecture.md's Source Tree Seed specifies: `packages/cli/src/commands/provider-binding.ts` and `packages/core/src/db/provider-bindings.ts`. [Source: architecture.md#Source Tree Seed] No conflicts detected — neither file exists yet.
- No new HTTP route, no `packages/server` changes, no web UI changes — this is CLI + core DB only. If you find yourself reaching for `packages/server/src/routes/`, stop — that's out of scope (PRD explicitly forbids a state-changing HTTP path for v1).
- This is the **first** story in Epic 3 for this local Archon slice — there is no previous-story file to inherit patterns from (`_bmad-output/implementation-artifacts/` contains no other epic-3 story files at story-creation time), and no prior git history touches `provider-binding`/`workflow-provider-binding` anywhere in this repo.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: Implement Archon Workflow Provider Binding Lifecycle] — requirements, task gates, acceptance criteria (reproduced above verbatim).
- [Source: _bmad-output/planning-artifacts/architecture.md#Archon Ownership Rules, #Architecture Decisions Relevant To Archon (AD-2, AD-3, AD-6, AD-7, AD-8, AD-9, AD-11), #Provider Command Syntax Baseline, #Source Tree Seed]
- [Source: _bmad-output/planning-artifacts/prd.md#FR-7: Register Generic Workflow Provider Bindings, #Scope Not Owned By Archon]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/README.md#Command Envelope Rules, #Workflow Provider Binding Rules]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-provider-binding.schema.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/binding-*.json, error-*.json]
- [Source: _bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/bindings/*.json]
- [Source: migrations/000_combined.sql:1-4 (idempotent combined schema), :174-217 (isolation_environments lifecycle-table pattern)]
- [Source: packages/core/src/db/adapters/sqlite.ts:76-85 (no RETURNING on UPDATE/DELETE), :356-579 (createSchema)]
- [Source: packages/core/src/db/adapters/types.ts:16-51 (IDatabase), :77-100+ (SqlDialect)]
- [Source: packages/core/src/db/workflows.ts:530-613 (UPDATE-then-SELECT CAS pattern)]
- [Source: packages/core/src/db/env-vars.ts (full file — upsert/db-module pattern)]
- [Source: packages/core/src/schemas/env-var.ts (full file — Zod row schema pattern)]
- [Source: packages/core/src/db/user-provider-key-store.test.ts (mocked-query test pattern)]
- [Source: packages/cli/src/cli.ts:274-303 (parseArgs options), :337-410 (noGitCommands / effectiveCwd resolution), :455-528 (workflow command switch/dispatch pattern to mirror)]
- [Source: packages/cli/src/commands/workflow.ts:1258-1321 (workflowGetCommand --json success/failure pattern), :1421-1425 (printJsonWriteError, the only existing shared JSON-error helper), :599, :632-639 (cwd→codebase resolution incl. auto-register, which provider-binding should NOT do)]
- [Source: packages/core/src/db/codebases.ts:105-129 (findCodebaseByDefaultCwd / findCodebaseByPathPrefix)]
- [Source: packages/core/src/schemas/codebase.ts (Codebase row shape — id/default_cwd/default_branch map to projectRef.id/repositoryPath/defaultBranch)]
- [Source: package.json:20-21,37 (generate:bundled-schema, check:bundled-schema, validate script)]
- [Source: CLAUDE.md#Zod Schema Conventions, #Engineering Principles (YAGNI, Fail Fast), #Testing]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
