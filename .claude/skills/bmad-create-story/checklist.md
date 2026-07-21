# Story Readiness Review

Use this checklist for semantic validation after the deterministic checker. Review from canonical sources and current code, not from the story's completion claims.

## Authority

- Does every material claim cite a current authority?
- When optional technical decisions exist, are story identity, PASS status, zero unresolved decisions, and every `TD-*` mapping correct?
- Are current code, previous stories, git history, and old review notes treated as evidence rather than silent authority?
- Are all conflicts resolved by an identified authority? Otherwise return `BLOCKED`.

## Acceptance and invariant closure

- Does each AC describe an externally or internally observable outcome?
- Does each AC map to ledger rows, tasks, surfaces, and proofs?
- Does every invariant state required and prohibited behavior, owner, and disposition?
- Are tasks complete vertical behavior slices rather than isolated file edits?
- Do derived sections agree with the normative ledger?

## Blast radius and ownership

- Trace ingress → operation → persistence/side effect → async owner → consumers → generated/public artifacts → proof.
- Include shared legacy callers and behavior that must remain unchanged.
- Classify every relevant surface as CHANGE, PRESERVE, GENERATE, or DEFER.
- Reject scope expansion or ownership changes without authority.
- For generated artifacts, require source-first change and the canonical regeneration command.

## Risk modules

- Verify every risk classification against code and behavior.
- Stateful: states, valid transitions, atomicity/CAS, races, interruption, cleanup, and recovery.
- Async/process: parent acknowledgement, exact identity, dispatch, claim, execution, later observation, timeout, and cancellation ownership.
- CLI/API: full grammar, malformed input, validation order, envelope/schema, status or exit code, stdout/stderr, and redaction.
- Cross-package: producer/consumer contracts, schemas, versioning, generated artifacts, and first-party consumer proof.
- Compatibility: legacy callers, stored data, migration/rollback, preserved behavior, and regression proof.
- Security: trust boundary, authorization, secret handling, error detail, and fail-closed behavior.

## Proof integrity

- Does each proof observe the required owner and lifecycle point?
- Reject proxy proofs: spawn is not worker claim; a log file is not outcome; parent acknowledgement is not durable mutation; schema existence is not consumer compatibility.
- Require positive plus negative or boundary assertions for every invariant.
- Add concurrency, interruption, partial failure, malformed input, no-side-effect, or regression proof when material.
- Ensure each focused test is hermetic and can run independently.
- Treat a broad suite only as additional regression evidence.

## Finding discipline

- Fingerprint findings as `<invariant-id>:<failure-class>:<surface-id>`.
- Consolidate multiple examples of one missing invariant into one root-cause finding.
- Classify exactly one disposition: repairable from authority, or blocked by a missing decision/scope/owner.
- Return PASS only with zero findings and full deterministic coverage.
