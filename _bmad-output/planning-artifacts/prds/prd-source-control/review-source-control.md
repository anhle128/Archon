# PRD Quality Review — Archon Source Control Tab

**Gate verdict: PASS (green-light to build) with minor fixes — no critical findings; two off-by-one FR cross-references should be corrected before story creation, and a few mechanical roundtrip gaps cleaned up.**

## Overall verdict

This is a strong, decision-ready PRD for an internal single-operator tool: a sharp thesis ("the absence of a local repo is the reason the feature exists"), FRs that each carry testable consequences, honest non-goals, and real counter-metrics. The HOW-in-addendum split is mostly clean and the M/A/D / container-exclusion / FR-9-fast-follow invariants are consistent throughout. What's at risk is purely downstream hygiene: two wrong FR cross-references (both off-by-one) and an incomplete Assumptions Index roundtrip that a story-generation agent could trip over.

---

## 1. Decision-readiness — strong

Trade-offs are stated as decisions, not smoothed to neutral: secret redaction is deferred **with a recorded residual risk and a named revisit trigger** (§Constraints, §8.4); container backend is excluded **with the stale-host-path reason** (§5, addendum); "no feature flag" is an explicit low-risk bet (§Rollout). `[NOTE FOR PM]` callouts sit at real tensions (FR-9 snapshot trigger/format; deferred niceties shaping v1 design), not safe checkpoints. Open Questions in §8 are genuinely open (checkout existence never `stat`'d; snapshot format undecided).

_No findings._

## 2. Substance over theater — strong

Vision is product-specific and non-swappable ("did this run change the files I think it did?"). JTBD are concrete and each maps to an FR. NFRs carry product-specific thresholds (256 KB / ~2,000-line first paint, >1 MB stream, >50 MB download-only, NUL-in-first-8 KB binary heuristic, ~4 KB hex peek — addendum) rather than "must be scalable/reliable" boilerplate. One light UJ with a named protagonist (Kevin) — correct restraint for a single-operator tool, not persona theater.

_No findings._

## 3. Strategic coherence — strong

Clear thesis (run-scoped remote git inspector, deliberately not an IDE/file browser); features (FR-1…FR-8) all serve it; SM-1 validates the thesis (inspect-what-changed without SSH/clone) rather than measuring raw activity; counter-metrics (SM-C1 responsiveness, SM-C2 secret exposure) are named. MVP scope kind (problem-solving) matches the scope logic.

_No findings._

## 4. Done-ness clarity — strong

Every FR has an explicit **Consequences (testable)** block with verifiable conditions ("exactly one of M/A/D", "no background polling occurs", "renders the Empty state, not an error/crash", "presence decided by directory existence at read time, not by run status"). Vague adjectives are largely absent; where "immediate feedback"/"graceful" appear they are pinned to concrete mechanics or addendum thresholds.

### Findings

- **low** SM-1 measurement instrument (§7) — "adoption (tab used on real runs)" and "task completion" name no observable signal or data source for an internal tool. Acknowledged as no-numeric-target, but the _how-observed_ is absent. _Fix:_ name the instrument (e.g., "tab-open events per run in existing telemetry" or "confirmed via operator interview at N runs"), even without a numeric threshold.

## 5. Scope honesty — strong

Non-Goals (§5) do real work — each omission is one a reader could otherwise silently assume (IDE, write path, auto-refresh, full Explorer tree, M-snapshot mode, event-derived change list, container runs, secret redaction). Deferred items are de-scoped explicitly (§6.2), not silently. Open-items density is appropriate to the stakes: 4 Open Questions + a bounded Assumptions Index on a green-light internal-tool PRD is healthy, not a blocker.

### Findings

- **medium** Assumptions Index roundtrip incomplete (§9) — two inline `[ASSUMPTION]` tags are not indexed: §Cross-Cutting-NFRs Observability (line 252, structured-log style + never-log-contents) and §Rollout (line 270, "ship directly, add flag only if…"). _Fix:_ add both to §9 (or drop the inline tag if they are settled decisions).

## 6. Downstream usability — adequate

Glossary is present and every domain noun (Source Control tab, Run checkout, Changes region, Commit history, Viewer, Empty state, Durable snapshot, M/A/D) is defined and used consistently in meaning. FR/SM IDs are contiguous and unique (FR-1…FR-9, SM-1/SM-C1/SM-C2). Sections read standalone. This is chain-top (feeds architecture → epics → implementation), so cross-reference accuracy is load-bearing — and that is exactly where the two defects below bite.

### Findings

- **high** Off-by-one FR cross-reference in FR-1 consequences (§4.1, line 75) — "shows the **Empty state (FR-7)**, not an error." The Empty-state FR is **FR-8**; FR-7 is read-only access. A story agent following the pointer lands on the wrong requirement. _Fix:_ change to "Empty state (FR-8)".
- **high** Off-by-one FR cross-reference in Glossary (§3, line 58) — "Durable snapshot — … (fast-follow; **see FR-8**)." The Durable-snapshot FR is **FR-9**, not FR-8. _Fix:_ change to "see FR-9". (Note both errors are off-by-one and point at each other's neighbor — a single renumbering slip; verify no third instance.)

## 7. Shape fit — strong

Correctly shaped as a capability spec for an internal, single-operator, brownfield feature: one light UJ (appropriate, not UJ theater), operational rather than user-funnel success metrics, and accurate existing-code references throughout the addendum (WorkflowExecution.tsx, workflow-run.ts, cleanup-service.ts, artifact route pattern, `@archon/git` `hasUncommittedChanges`). Brownfield existing-vs-new boundary is explicit (new read-only git API "none exists today", modeled on the artifact route). Not over- or under-formalized.

_No findings._

---

## Mechanical notes

- **Glossary case drift (low):** "Run checkout" (defined term, §3 line 51) vs lowercase "run checkout" in FR consequences (e.g., line 97 "the run checkout's uncommitted changes"). Cosmetic; normalize for a clean source-extract.
- **Index-entry roundtrip (low):** several §9 entries marked _(confirmed)_ (§4.5 access model; §2.2/§4.7/§6.2 container; §6.2 secrets; doc language) have no matching inline `[ASSUMPTION]` tag in the body — they read as confirmed decisions rather than assumptions. Acceptable, but the index conflates "confirmed decisions" with "inferred assumptions"; consider splitting or relabeling so the inline↔index roundtrip is exact.
- **ID continuity:** FR-1…FR-9 and SM IDs contiguous/unique; the only cross-ref failures are the two off-by-one pointers above.
- **Consistency (verified clean):** M/A/D projection identical in PRD (§4.2 line 99) and addendum; FR-9 fast-follow tagged consistently (§4.7 title, FR-9 `[fast-follow]`, §6.2, §8.2); container backend excluded consistently (§2.2, §5, §6.2, addendum) — no stray M/A-only or in-scope-container leakage.
- **HOW-leak into PRD body (medium, borderline):** §0 promises technical depth lives in the addendum, yet the FR-7 feature-NFR (line 157) and Cross-Cutting NFRs (lines 249, 251) name `execFileAsync` / `@archon/git` / `registerOpenApiRoute` / `@archon/web` type boundary directly in the PRD. Defensible as security guardrails, but strictly these are HOW and duplicate the addendum. _Fix:_ state the capability/guardrail in the PRD ("server-controlled git args, no shell-string; read-only") and leave the package/function names to the addendum.
