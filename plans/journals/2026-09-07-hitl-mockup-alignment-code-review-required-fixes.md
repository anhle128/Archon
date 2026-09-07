---
title: HITL mockup-alignment code-review required fixes
date: 2026-09-07
summary: 'Landed the blocked P1/P2 review fixes so both run views consume server execution history, gates can send annotations, and bun run validate is green.'
---

# HITL mockup-alignment code-review required fixes

## What happened

Code review `plans/reports/code-review-260907-2018-workflow-run-hitl-mockup-alignment.md` blocked plan `260907-1454-workflow-run-hitl-mockup-alignment`. Production Legacy/Console run views ignored `nodeExecutions`, lifecycle terminals omitted occurrence scope, Ask resume reused every same-epoch answer, Send annotations was dead API, receipts vanished after claim/session rotation, and `format:check` failed validate.

## Decision

Fix at the contract seams rather than UI fallbacks: carry one minted scope through start/terminal events, project nested loop iterations as a stack per occurrence, select Ask answers by latest epoch occurrence plus those tool IDs, persist receipt transitions in `reviewFeedbackReceipts`, and keep a single Legacy pane tree that stacks via `useStackedViewport`.

## Outcome

`bun run validate` exits 0. Follow-up [Review](c9b61547-16b9-4e31-bfc7-c19b5db3acce) scored 9/10 with 0 critical. Ask resume now recovers occurrence + expected tool IDs at the executor call site.

## Next steps

Commit when asked. Remaining coverage gaps from the original review: E2E for two occurrences of one node, Send annotations E2E, and viewport overflow assertions.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
