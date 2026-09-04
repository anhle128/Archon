# Architecture — workflow ENV overlay

## Problem & goals

Operators need to run the same Archon workflow with different per-node `provider` / `model` / `effort` / `thinking` / `prompt` / `bash` without duplicating YAML.
They also need to see effective provider, model, and thinking at Start so they can tell whether an ENV applied.
The lens: one definition, many named ENVs, Start picks an ENV or none, historical runs stay frozen, Start UI and run detail agree with what the node will actually run.

## Approaches considered

1. **Allowlisted JSON patch (chosen).**
   Apply returns a **patched clone** of the DAG, then existing model resolution runs on the clone.
   Never mutate a cached discovered definition.

2. **Dotenv / dotted-key blob.**
   Weak types, bad multiline `prompt`.

3. **Resolver-only + `$INPUTS` for bodies.**
   Cannot replace a whole `prompt`/`bash`.

We recommend 1.
Field list and PATCH-replace stay as in the spec.
Hard-fail on unknown node ids is superseded here.

## Recommended approach

Two-phase freeze on the existing dispatch path:

**HTTP Start:** load ENV by id, require `workflow_name` match, freeze `{ envId, envName, patches }` onto dispatch context.
Missing ENV or name mismatch → HTTP 400.
No YAML load on the run POST.
No folder on the request.

**Orchestrator, before isolation:** clone the loaded DAG, apply frozen patches to the clone (project YAML still shadows bundled by name).
Skip keys whose node id is absent (warn, do not fail).
Wrong field or wrong node type on a node that exists still fails.
Re-run `validateDagStructure` after apply.
Fail before worktree via existing SSE / dispatch errors, not HTTP 400.
No second DB read.
Execution uses that clone; do not rediscover-and-mutate the cache.

**Snapshot (when the run row is created, after isolation, before first `sendQuery`):**
filtered applied `patches`, optional `skippedNodeIds`, and `resolved` per node: `{ provider, model, effort, thinking }`.
`resolved` is **start-time audit only**.
Execution never reads `resolved` for `sendQuery`; it uses the patched clone plus the live profile.
Resume/retry re-applies the filtered patches, recomputes `resolved`, and updates the table.
UI labels the table as resolved at this start/resume, not as a frozen execution contract.

**Start preview:** GET using conversation project cwd + optional `envId`.
Same clone → apply → shared metadata helper.
DraftRunCard shows the table when an ENV is selected.
Run detail reads `metadata.envOverlay.resolved` as audit, not `node_started`.

`resolveNodeModel` today does not return `thinking`.
Thinking follows node → workflow → preset via `applyPresetOptions`.
Extract one pure `resolveNodeExecutionMetadata` used by preview, snapshot, and the executor/`node_started` path so thinking cannot drift.

Pure apply/validate/metadata in `@archon/workflows`.
ENV rows in `@archon/core`.

## Key decisions

- **Stack & libraries** — skipped.
  Existing Bun + TypeScript + SQLite/PostgreSQL + OpenAPI Hono + React console.

- **Data model** — `WorkflowEnv` keyed by `(workflow_name, name)` on the install.
  Run snapshot is applied patches + `resolved` metadata, not a live FK and not the raw ENV document.
  `created_by_user_id` is provenance, not ACL.

- **Boundaries & contracts** — v1 Web, run POST, and preview GET.
  HTTP 400 on Start only for ENV identity (id + workflow name).
  Preview GET 400 if the conversation has no project.
  Child `workflow:` runs do not inherit the overlay.
  Do not log `prompt`/`bash` bodies.

- **Other** — PATCH replaces the whole ENV `patches` object.
  Top-level expanded DAG only.
  Missing node ids skipped; type errors on existing nodes fail.
  Apply returns a patched clone.
  Existing workflow-name shadowing is reused.
  Start visibility is preview GET plus snapshot-at-run-row (Q4-C).
  `resolved` is audit-only (Q5-A); unpatched `model: large` keeps meaning current large tier.

## Missing pieces

ENV table and store.
Pure apply helper (clone).
`resolveNodeExecutionMetadata` shared by preview, snapshot, and node start.
Frozen candidate on dispatch context.
Pre-isolation clone + validate.
Preview GET.
Filtered snapshot including `resolved`.
Console picker, Manage, Start preview table, run-detail table.

## Verification

Apply ENV A on a cached bundled definition, then run the same definition with no ENV and assert original nodes are unchanged.
Preview table for an ENV matches `metadata.envOverlay.resolved` on the resulting run, including thinking.

## Spikes & experiments

None for overlay apply/isolation (seams already observed).
Optional small spike only if `applyPresetOptions` thinking precedence is unclear when extracting the shared helper — timebox by reading `dag-executor.ts` applyPresetOptions vs `resolveNodeModel`, then lock the helper contract.

## Open questions

None for v1.
CLI `--env`, pricing comparison, and legacy dashboard mobile stay separate intents.
