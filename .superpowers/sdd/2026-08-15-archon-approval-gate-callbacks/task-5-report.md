# Task 5 Report

## Summary

Approval callback payloads now include the gate type, node ID, message, triggering user prompt, and review URL before envelope validation.
Standard gates build review links from `ARCHON_PUBLIC_URL`.
Plannotator gates keep the live review URL from the gate event.

## Red Evidence

`cd packages/core && bun test src/workflows/store-adapter.test.ts src/events/workflow-event-envelope.test.ts` failed before implementation.
The standard approval callback lacked `payload.approval.userPrompt` and `payload.approval.reviewUrl`.
The Plannotator approval callback lacked `payload.approval.userPrompt`.
The envelope schema accepted an approval payload that missed `userPrompt` or `reviewUrl`.

## Green Evidence

`cd packages/core && bun test src/workflows/store-adapter.test.ts` passed with 26 tests.
`cd packages/core && bun test src/events/workflow-event-envelope.test.ts` passed with 9 tests.
`cd packages/core && bun run type-check` passed.
`cd packages/workflows && bun run type-check` passed.
`cd packages/cli && bun run type-check` passed.
`bun x eslint packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/src/events/workflow-event-envelope.ts packages/core/src/events/workflow-event-envelope.test.ts --max-warnings 0 --no-warn-ignored` passed.
`bun x prettier --check packages/core/src/workflows/store-adapter.ts packages/core/src/workflows/store-adapter.test.ts packages/core/src/events/workflow-event-envelope.ts packages/core/src/events/workflow-event-envelope.test.ts .env.example packages/docs-web/src/content/docs/reference/configuration.md` passed.
`git diff --check` passed.

## Self-Review

The change is limited to the Task 5 files.
The store adapter uses the schema-derived `WorkflowRun` type and `Pick<WorkflowRun, 'id' | 'codebase_id' | 'user_message'>` for enrichment.
The approval payload schema preserves `.passthrough()`.
The URL guard allows only HTTP and HTTPS.
The callback enrichment remains best-effort because errors stay inside the existing outbox enqueue catch path.
No generated files or changelog files were changed.

## Commit

Commit message: `feat(core): enrich approval callback payloads`.

## Concerns

`ARCHON_PUBLIC_URL` is required only when a non-Plannotator approval callback reaches an allowed binding.
If it is unset or invalid, Archon logs the callback enqueue error and does not fail the workflow gate.

## Fix Round 1

### Summary

Added regression coverage for `ARCHON_PUBLIC_URL` values that include an existing path, query, and hash.
The callback URL now has the expected console path, encoded codebase and run IDs, and no old query or hash.
Added best-effort negative coverage for unset `ARCHON_PUBLIC_URL`, invalid `ARCHON_PUBLIC_URL`, and missing `codebase_id`.
The missing `codebase_id` case exposed a bug where approval callbacks wrote a not-routable outbox row before enrichment could fail.
The fix adds an approval-only guard before the legacy missing-codebase outbox path.

### Red Evidence

`cd packages/core && bun test src/workflows/store-adapter.test.ts` failed before the production fix.
The failing case was `createWorkflowEvent keeps internal approval event when codebase_id is missing`.
The test expected no external callback enqueue, but the old path wrote one not-routable outbox row.

### Green Evidence

`cd packages/core && bun test src/workflows/store-adapter.test.ts` passed with 30 tests.
`cd packages/core && bun test src/events/workflow-event-envelope.test.ts` passed with 9 tests.
`cd packages/core && bun run type-check` passed.

### Self-Review

The production change is limited to approval callbacks.
Non-approval missing-codebase events keep the existing not-routable outbox behavior.
`WorkflowRun.user_message` is a required `z.string()` in `packages/workflows/src/schemas/workflow-run.ts`.
An empty string is schema-valid there, but the existing approval envelope schema rejects it as an empty `userPrompt`, so no new production constraint was added.

### Commit

Fix commit hash: `d558cc667c64bed220ac8b44bed181940022eaa0`.
