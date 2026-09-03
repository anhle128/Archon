# Phase 4 — OMP Advisor Cost Capture

## Context (spike findings, verified in oh-my-pi source at v18.0.4)

- Advisors run in the `--mode json` Archon uses: instantiated in `AgentSession` core gated only on the `advisor.enabled` setting, driven from `onPrimaryTurnEnd` (oh-my-pi `packages/coding-agent/src/session/agent-session.ts:1536-1537, 1249`). A user with advisors enabled spends advisor money inside Archon workflow nodes today, invisibly.
- Advisor LLM usage is NOT on the main JSON stream — advisors emit only notices and `retry_fallback_applied`/`retry_fallback_succeeded` (no usage payloads) (`session-advisors.ts:946-963, 1323`).
- Advisor cost lives in per-advisor transcript JSONL beside the main session file; oh-my-pi itself reads it back that way (`advisor/transcript-recorder.ts:50-88` — scans sibling advisor transcripts, sums `message.usage.cost.total`).

## Chosen path (default): post-run transcript read

After an OMP node's process exits, the provider locates the session's advisor transcripts and folds their usage into `usageBreakdown` as `kind: 'advisor'` entries.

## Requirements

- Resolve the transcript directory from the `session` event id the parser already captures (`packages/providers/src/community/omp/event-parser.ts:156-162`). Verify the on-disk layout against the omp version actually installed (binary is user-global, plan-doc baseline OMP 17.2.9): main session JSONL path + sibling advisor transcript naming, matching `loadAdvisorTranscriptCosts` expectations. Do not guess paths — read them from omp source for the pinned baseline and fail soft.
- Parse advisor transcripts: per advisor file, sum assistant `usage` (input/output/cacheRead/cacheWrite/cost.total) and read the advisor's model + provider for the breakdown key; entry gets `kind: 'advisor'`.
- Failure posture: transcript missing/unreadable/format-drift → WARN log (`omp.advisor_transcript_unreadable`) and omit entries — never fail the node, never write zeros. Absence stays absence.
- `--no-session` runs (`persistSession === false`, `provider.ts:142`): advisor transcripts may not exist — confirm behavior; if omp writes no transcripts, advisor cost is uncapturable there; document in the provider docblock.
- Version drift guard: treat this as an omp-format coupling point; keep all layout knowledge in one function with a docblock naming the omp source file it mirrors.

## Alternative (optional, parallel): upstream feature request

File an issue/PR on can1357/oh-my-pi proposing advisor + fallback usage in a stream event (e.g. extend `agent_end` with per-model usage summary). If accepted, the transcript reader becomes the fallback for older omp versions. Not a blocker for this phase.

## Files

- `packages/providers/src/community/omp/` — new `advisor-usage.ts` (kebab-case) + wiring in `provider.ts` after process exit, tests with fixture transcript files
- No engine changes (phase 2 already merges provider-supplied entries)

## Validation

- Fixture-driven unit tests: advisor transcripts present → entries with `kind: 'advisor'`; absent → no entries, WARN logged; malformed line → that entry only skipped (mirror oh-my-pi's own tolerance).
- Manual: enable an advisor in local omp settings, run a small workflow node, confirm advisor model appears in node breakdown.

## Risk / rollback

Isolated to the omp provider; coupling to omp's session file layout is the accepted trade-off (user-approved after spike). Rollback = remove the reader; phases 1-3 unaffected.
