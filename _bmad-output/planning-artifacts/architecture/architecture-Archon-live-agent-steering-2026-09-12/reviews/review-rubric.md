# Rubric-Walker Review — Live Agent Steering spine

**Verdict: PASS WITH CONCERNS.** The spine is coherent, brownfield-faithful, and covers all six capabilities; every recently-fixed point (interrupted-vs-natural drain, 30-min explicit fail, per-turn signal) holds identically across all four files, and the cited `dag-executor.ts` anchors verify. No critical findings. But two HIGH concerns must close before this is buildable without divergence: (H1) claude soft-inject is presented as v1-ready while the SPEC flags its enabling seam as an unverified spike; and (H2) `/workflow cancel` is silently dead during idle-await — the mechanism all four files claim keeps it alive fires only from a running stream, which idle-await does not have.

Scope of this lens: judged AD-1..AD-11 against the good-spine checklist. Read-only. Named-tech currency is flagged, not verified (web-verify owns it).

---

## Verified-consistent (independent checks that held)

These are stated so the concerns below are read against a spine that is mostly sound, not as a hit-list.

- **Check (a) — interrupted end never auto-fires; natural end auto-drains.** Consistent across all four: spine AD-4 / AD-11, `engine-integration.md §2`, `control-states.md` ("drains only on Send now, never automatically"), SPEC constraint. No contradiction.
- **Check (b) — 30-min fresh timer + explicit fail, not the existing idle-timeout (which completes).** Consistent across spine AD-4, `engine-integration.md §2`, SPEC "Settled" open question. Verified against source: `:3118` is the "completed via idle timeout" branch and `:3123` carries the `!nodeIdleTimedOut` guard exactly as described — reusing that path would ship partial output, and the spine forbids it correctly.
- **Check (c) — per-turn signal, never the one-shot node-level `nodeAbortController`; `:3123` stays Cancel-only.** Consistent across spine AD-2, `engine-integration.md §2`, SPEC constraint, `control-states.md`. Verified against source: `:2209` is `new AbortController()`, `:2221` wires `abortSignal: nodeAbortController.signal`, `:3031` guards the re-ask loop on `!nodeAbortController.signal.aborted`, `:3123` fails on that signal. The `AbortSignal.any([node, perTurn])` construction is coherent with keeping the node-level path byte-for-byte unchanged.
- **Item 5 (brownfield).** All spot-checked anchors (`:2209`, `:2221`, `:2290`, `:3118`, `:3123`, `:3031`) are accurate; steering code is greenfield (no `operatorInterrupt`/registry exists yet). The spine ratifies rather than contradicts the codebase.
- **Item 6 (capability coverage).** All of CAP-1..CAP-6 map to at least one AD. None orphaned.
- **Item 7 (inherited invariants).** HITL/AD-1,2,6 are correctly listed as NOT inherited; AD-6 explicitly refuses `resumeInteractions` ("that carriage is the Ask path's `tool_use_id`, which an operator message lacks"), so the 30-min idle-await bound does not contradict HITL/AD-2's "wait indefinitely" — they govern different lifecycles. No inherited invariant is weakened.

---

## HIGH

**H1 — AD-3 / Stack / Deferred: claude soft-inject (CAP-5) is presented as v1-ready, but the SPEC flags its enabling seam as an UNVERIFIED spike.**
The spine's Stack table ("claude … already has streaming-input … need no upgrade"), the Deferred table ("Per-provider soft-inject beyond claude + omp" — implying claude+omp soft-inject is _in_ scope), and CAP-5's "claude streaming input today" all read as settled. But `SPEC.md` open questions say the load-bearing seam — whether claude's `AsyncIterable` streaming input composes with the resume protocol for soft-inject — is "Unverified — a spike, not an assumption" (exercised only on a string prompt at 0.3.209), and `provider-steering-matrix.md` repeats that caveat in prose while its table row still says "yes" with no asterisk. A builder reading the spine builds claude soft-inject as a done thing.
_Fix:_ AD-3/Stack must carry the spike-gate explicitly (claude soft-inject ships only after the AsyncIterable+resume spike passes; interrupt-then-continue floor ships regardless), matching SPEC. Flagged for the web-verify/spike lens to resolve the SDK-composition fact.

**H2 — AD-4: `/workflow cancel` is silently dead during idle-await; the mechanism all four files invoke cannot fire there.**
AD-4 (and `engine-integration.md §2`, and the SPEC "Settled" note) all say idle-await "watches the node-level `nodeAbortController` signal — a `/workflow cancel` still ends the node from idle, racing the 30-minute timer." But per the spine's own text the ONLY two things that `.abort()` that controller are the idle-timeout callback (`:2298`, stream-wrapper) and the cancel-poll (`:2304-2334`). Verified against source: the cancel-poll sits **inside** the streaming `for await` body and is chunk-driven (it runs on `tickNow` from arriving chunks). Idle-await has no stream — the spine itself calls the poll "dormant" there — so nothing ever calls `.abort()`, and a `Promise.race` on `nodeAbortController.signal` waits on a signal no code raises. `/workflow cancel` writes `status=cancelled` to the DB, but during idle-await nothing reads it. Cancel is dead from idle-await until the 30-minute timer independently fires. A builder wires the signal race, tests the 30-min fail, and ships this; the hole surfaces only when a user cancels an interrupted node in production. This also exposes the Deferred row "Cancel node — Already exists, untouched": steering introduces a state the existing Cancel mechanism does not reach, so Cancel is **not** untouched — it needs new plumbing for idle-await (item-3 exposure, item-8 failure-mode gap). Note this is the failure mode a cross-file consistency pass cannot catch: all four files agree, and all four are incomplete.
_Fix:_ AD-4 must give idle-await its own timer-driven run-status poll (time-driven, not chunk-driven) that aborts on a terminal DB status, OR route `/workflow cancel`/`abandon` through the registry to abort the handle directly; and correct the Deferred "Cancel untouched" row.

---

## MEDIUM

**M1 — AD-2: the interrupt-vs-natural-end race is closed at the signal level but not at the `operatorInterrupt` flag level.**
AD-2 says a late interrupt is "a no-op, spent — the loop already left turn N." But the discriminator is the _flag_, set at the interrupt call site, not derived from the signal. If the handler sets `operatorInterrupt = true` just as the stream closes naturally, the post-stream branch sees the flag set and wrongly enters idle-await on a turn that actually completed. Two builders will resolve this differently.
_Fix:_ AD-2 must state the flag-honoring condition — honor `operatorInterrupt` only when the per-turn signal actually aborted the stream (flag AND aborted), else take the natural-completion path — so a set-but-unspent flag cannot mis-route a completed turn.

**M2 — AD-5 / AD-11: the registry-teardown seam is under-anchored, and the "sent → orphaned → 409" signal back to the browser is unspecified.**
AD-11's teardown-409 guarantee depends on a precise ordering (final natural-end check → window → teardown drains queue → 409), and AD-5 says the entry is "torn down when it ends" — but unlike the surgically-anchored abort seam, no code seam/owner is named for teardown. Two builders could place teardown before vs after the final check and silently break the "never discarded" guarantee. Separately, when a message acked `sent` is later 409'd at teardown, the transport that tells the browser to re-render it as a read-only draft is not described.
_Fix:_ Anchor the teardown seam (the per-node executor `finally`) and state it must run after the final natural-end check; name the signal (node-finished refetch) that flips an orphaned `sent` message back to a draft.

**M3 — Provider matrix omp traps (RPC-vs-ACP, `steeringMode`) are not lifted into an AD or Consistency Convention.**
`provider-steering-matrix.md` flags two omp traps that directly threaten in-scope behavior: ACP mode _implicitly cancels_ the running turn (looks like steer, behaves like Cancel — "the single most likely wrong turn in the whole feature"), and `steeringMode` defaults to `one-at-a-time`, which breaks CAP-3's ordered multi-message flush. These live only in a companion's prose; nothing in the invariant contract pins them, so CAP-3's ordering promise on omp is unguarded.
_Fix:_ Add a Consistency-Conventions row (or fold into AD-3) requiring omp RPC mode + explicit steering-mode sequencing, so the ordering invariant is contract, not lore.

**M4 — AD-11: multi-operator arbitration on the one shared registry queue is under-decided (cross-user is covered by inheritance; same-starter multi-tab is not).**
The registry is keyed `(runId, nodeId)` with ONE live handle and ONE inbound queue; `control-states.md`/CAP-1 make only the _draft_ queue per-tab, so once sent, senders converge on the single shared queue. Cross-_user_ steering is in fact refused — AD-11 binds Send/Interrupt under HITL/AD-7, whose inherited rule is "only `workflow_runs.user_id` may mutate" — but AD-11 conveys that only by pointer, and it is worth confirming starter-only is the intended policy (a teammate watching the node cannot redirect it). The genuinely undecided residual is **same-starter multi-tab** interleaving: two tabs of the starter both send/interrupt the same node, and no AD states the ordering (server arrival, presumably) or whether tab B's `Send now` flushes tab A's queued items. AGENTS.md makes multi-user first-class, so this deserves an explicit line rather than emergent behavior.
_Fix:_ AD-11 should (i) state the starter-only mutation policy explicitly and confirm teammates cannot steer, and (ii) fix same-starter interleaving — shared queue ordered by arrival, `Send now` flushes the whole shared queue regardless of authoring tab.

---

## LOW

**L1 — AD-6 / AD-10: CAP-4's cross-spec sequencing is correct but a build-order hazard.**
AD-6 writes the `origin='operator'` row; HITL/AD-3 (inherited) + Track A/AD-1 mean the live transcript reads that table immediately, so if the executor's write lands before `spec-readable-agent-transcript`'s reader recognizes `origin='operator'`, the row renders as agent text — the exact bug AD-10 names. Well-flagged as a sequencing rule, but a builder could implement AD-6 first.
_Fix:_ Restate AD-10's "reader lands first" as an explicit build-order gate on AD-6 (do not write operator rows to a live run until the Track A reader ships).

**L2 — AD-2/AD-4: `operatorInterrupt` reset across turns is implied, not stated.**
For a natural turn-N+1 end to auto-drain, the flag must be cleared before N+1 runs. Implied by "each new turn gets a fresh per-turn signal" but never said.
_Fix:_ One line in AD-4: the flag is per-turn and cleared when turn N+1 starts.

**L3 — AD-8 / CAP-6: only the `sent` half of CAP-6 ships in v1.**
`delivered` is fully deferred (unreachable at pin 0.3.209). Consistent with CAP-6's intent ("claim only what it knows"), so not a coverage gap — but the capability's differentiator is inert in v1. Observation for owner sign-off, not a defect.

---

## Checklist scorecard

| #   | Checklist item                                       | Result                                                                                |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Fixes real divergence points, misses none            | PARTIAL — H2, M1, M2, M3, M4 are missed/under-fixed points                            |
| 2   | Every Rule enforceable, Binds/Prevents/Rule coherent | PARTIAL — H2 (idle-await Cancel) is unenforceable as written; M1 is a soft spot       |
| 3   | Nothing under Deferred lets two units diverge        | PARTIAL — H2 shows "Cancel node — untouched" is not inert                             |
| 4   | Named tech verified-current                          | DEFERRED to web-verify; H1 is the one internal tension to resolve there               |
| 5   | Ratifies brownfield                                  | PASS — anchors verified                                                               |
| 6   | Covers CAP-1..CAP-6                                  | PASS                                                                                  |
| 7   | No new AD weakens an inherited invariant             | PASS                                                                                  |
| 8   | Every owned dimension decided/deferred/open          | PARTIAL — H2 (idle-await Cancel failure mode) + M4 (same-starter multi-tab) undecided |
