# Story Contract

## Contents

- Authority reconciliation
- Risk profile
- Blast-radius discovery
- Normative ledger
- Proof targets
- Readiness rules

## Authority reconciliation

Record every relevant authority with an exact path and section. Label each claim `ADOPT`, `PRESERVE`, `SUPERSEDE`, `DEFER`, or `CONFLICT`.

An optional approved technical-decision artifact outranks other story-level interpretations. When no artifact exists, do not fabricate one; record only decisions that follow unambiguously from existing authority. Escalate material ambiguity.

Current code proves what exists. It does not override an approved product or architecture requirement. Historical stories and review notes are non-normative unless a current authority adopts them.

## Risk profile

Classify every dimension as `applicable` or `not-applicable` with a concrete reason:

| Dimension | Applicable when | Required module |
| --- | --- | --- |
| `stateful` | Durable state, lifecycle, database writes, transitions, retry, cancellation, cleanup | Stateful and Persistence Contract |
| `async-process` | Background work, queues, subprocesses, workers, callbacks, eventual outcomes | Async and Process Contract |
| `cli-api` | CLI grammar, HTTP/API ingress, schemas, status/exit codes, stdout/stderr | CLI and API Contract |
| `cross-package` | More than one package/process or generated/public consumer artifacts | Cross-Package and Generated Contract |
| `compatibility` | Existing callers, stored data, public behavior, migration, legacy aliases | Compatibility Contract |
| `security` | Authentication, authorization, secrets, trust boundaries, user-controlled input | Security Contract |

Do not infer low risk merely because the requested diff looks small. Assess behavior and ownership boundaries.

## Blast-radius discovery

Trace from entry to observable outcome before selecting files:

1. Parse/ingress and validation.
2. Business operation or policy owner.
3. Persistence, transaction, compare-and-swap, or external side effect.
4. Async/process handoff and later owner.
5. First-party and public consumers.
6. Shared legacy callers and behavior that must remain unchanged.
7. Schemas, OpenAPI declarations, fixtures, generated artifacts, and regeneration commands.
8. Unit, integration, subprocess, contract, and end-to-end proof at the owning boundary.

Classify every discovered surface:

- `CHANGE`: implementation must modify it.
- `PRESERVE`: implementation must prove its existing behavior remains intact.
- `GENERATE`: modify its source and regenerate it; never patch it independently.
- `DEFER`: exclude it with an owner, rationale, residual risk, and follow-up trigger.

An unclassified relevant surface is a readiness failure.

## Normative ledger

The Decision and Invariant Ledger is the only implementation authority inside the story. One row must contain:

- Stable `TD-*` or `INV-*` identifier.
- Exact source authority.
- All acceptance-criterion IDs closed by the row.
- Required behavior, including prohibited behavior where material.
- Owning module, process, or persistence boundary.
- All task, surface, and proof IDs that close the invariant.
- `IMPLEMENT`, `PRESERVE`, or `DEFER` disposition.

Tasks, surface contracts, risk modules, and proof plans are derived views. When they disagree with the ledger, validation fails; do not add a second superseding plan elsewhere in the story.

## Proof targets

Name the required observable rather than only a test level:

- `return-value`: synchronous in-process result.
- `protocol-envelope`: exact external payload, status/exit code, stdout/stderr contract.
- `durable-state`: committed persistence state or atomic transition.
- `dispatch-ack`: accepted handoff only; never use it as proof of worker activity.
- `worker-claim`: exact worker/process acquired exact identity once.
- `terminal-outcome`: later completion/failure/cancellation result.
- `consumer-contract`: first-party or public consumer can use the produced contract.
- `no-side-effect`: prohibited mutation, call, process, event, output, or secret is absent.

Every proof row must specify the owning boundary, command/test, positive assertion, and negative or boundary assertion. Add concurrency, interruption, partial failure, malformed input, cleanup, migration, or regression cases when the risk profile makes them material.

## Readiness rules

A story is ready only when:

- Every AC maps to at least one ledger row, task, and proof.
- Every ledger row maps to existing task, surface, and proof IDs.
- Every optional `TD-*` decision is covered exactly as approved.
- Every relevant surface is classified.
- Every applicable risk module is complete.
- Every deferral has an owner, reason, residual risk, and trigger.
- No placeholder, unresolved conflict, silent scope expansion, or proxy proof remains.
- Focused proof commands identify concrete assertions; a broad suite may be additional evidence but cannot be the only proof.
