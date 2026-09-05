---
type: architecture-spine-rubric-review
target: architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md
reviewer: rubric-walker
date: 2026-09-05
verdict: pass-with-fixes
stale: true
note: Late duplicate of the Finalize rubric walker. Judged a pre-finalize spine against the older epics-source-control stories. Archived so it does not replace the applied gate record in review-rubric.md.
sources-consulted:
  - ARCHITECTURE-SPINE.md
  - .memlog.md
  - epics-source-control/epics.md (FR/NFR/story ACs)
---

# Rubric Review — Architecture Spine: Archon Source Control (legacy UI)

## Verdict: **PASS-WITH-FIXES**

The spine is structurally sound and covers the core read-path decisions well. All nine ADs carry Binds / Prevents / Rule; the security containment (AD-1), package placement (AD-2), and serialization split (AD-3) are the strongest sections. Two capability areas are silent — binary file handling and the commit lane graph — and one Deferred item is load-bearing for a must-pass story AC. These are fixable without restructuring the spine.

---

## Findings

### FINDING-1 — Binary file strategy is a silent dimension (CRITICAL)

**Checklist violated:** "Every dimension the altitude owns is decided, deferred, or an open question — silent dimensions are findings."

Epic 1 / Story 1.4 (FR5) carries specific, testable ACs:

- Text first-paints ~256 KB / ~2,000 lines then Load-more
- Files > ~1 MB stream with Cancel control
- Files > ~50 MB → download-only
- Binary detected by NUL byte in first 8 KB
- Image renders inline; other binary offers download or hex peek (~4 KB)

No AD or Deferred entry addresses any of these. AD-3 says "raw route … with byte/line ranges" and AD-5 says "react-virtual." That is transport only — the binary detection strategy, the streaming thresholds, and the image/hex/download rendering tiers are unspecified. Implementers building Story 1.4 will make these choices independently, producing divergence in the user experience and the server API contract (what does `contentType` field carry? how does `truncated` interact with binary?).

**Required fix:** Add an AD (or explicit Deferred) that decides: (a) binary detection mechanism (NUL-byte in first N bytes, executed on the server via the raw route), (b) the content-type categories the server must emit so the client can branch rendering, and (c) whether thresholds are build-time constants or config. The thresholds themselves can be left to the implementing story ("build-time tunable") but the mechanism must be pinned.

---

### FINDING-2 — Commit lane graph renderer is an open spike masquerading as a decided capability (HIGH)

**Checklist violated:** "Fixes the real divergence points for the level below and misses none."

Epic 2 / Story 2.1 explicitly locks the **branch/merge lane graph** as a non-negotiable deliverable: "A plain list is not an acceptable fallback (the graph is locked)." It mandates a spike to choose between reusing `@xyflow/react` (already in the workspace) vs a bespoke SVG, and to solve lane assignment through merges and windowed continuity.

The spine's Stack table does not list `@xyflow/react`. The Deferred section has "Large-diff spike" but nothing about the lane graph spike. AD-9 says only "Fourth tab on /legacy/workflows/runs/:id" — it says nothing about the graph renderer. If the spine doesn't declare this an open question or a pre-build spike, a developer could start Story 2.1 without the spike outcome and pick any renderer.

**Required fix:** Add to Deferred (or an open question in the spine): "Commit lane graph renderer: spike required before Story 2.1 — choose `@xyflow/react` reuse vs bespoke SVG; must solve multi-parent lane assignment and windowed-row continuity. Outcome: renderer decision + `parents[]` shape in `log` response." Until the spike fires, `@xyflow/react` should appear in the Stack table as "(candidate — spike pending)" or be formally decided.

---

### FINDING-3 — Child/subrun isolation FK is Deferred but Story 1.1 AC is pass/fail (HIGH)

**Checklist violated:** "Nothing under Deferred could let two units diverge."

The spine Deferred table: "Child/subrun `isolation_env` when FK missing — D5: define + test at build, not an extra AD."

Story 1.1 (Epic 1's first AC) has a specific, testable acceptance criterion:

> "Given a child/subrun that persists the same `conversationDbId` as its `conversation_id` … When the container gate runs, Then a child sharing a container-backed conversation returns the Empty state … the D5 FK gate applies identically to child and top-level."

This is not a "define at build" decision — it is a must-pass AC for the first deliverable story. If the FK is missing (the conversation row has no `isolation_env_id`), AD-6's rule ("conversation.isolation_env_id → isolationEnvironments.getById.provider === 'container'") is ambiguous: does a NULL `isolation_env_id` skip the container gate (proceed to git) or treat as non-container (proceed to git)? Two implementers reading AD-6 literally could diverge, and the null-FK path is exactly what child/subruns exercise.

**Required fix:** Extend AD-6's Rule with a one-sentence tie-breaker: "A NULL `isolation_env_id` is treated as non-container (proceed to the host existence check, not the Empty state)." This resolves the ambiguity without an extra AD and makes the AC testable.

---

### FINDING-4 — Accessibility (NFR7) WCAG requirements are absent from any AD (MEDIUM)

**Checklist violated:** "Fixes the real divergence points for the level below and misses none."

Story 1.2 AC: "+/- gutter markers … ≥ 4.5:1 contrast … color is never the only signal." Story 2.1 AC: "lane dots/lines meet ≥ 3:1 non-text contrast … no information conveyed by lane color alone." NFR7 is the only NFR that generates testable, lockable AC lines in two separate stories.

The spine's Consistency Conventions table says "M/A/D letter-carried" — that covers badge accessibility but not the diff pane's `+`/`-` gutter markers or the lane graph's color-independence requirement. `react-diff-view@3.3.3`'s built-in gutter rendering may or may not emit `+`/`-` markers by default; an implementer who doesn't know this is a locked requirement might suppress them for aesthetics.

**Required fix:** Add one line to AD-5 (Viewer stack) Rule: "The diff pane MUST render `+`/`-` gutter markers on insert/delete lines (WCAG 1.4.1 — color is not the only signal); react-diff-view's `Decoration` or `Change` components satisfy this when configured with gutter content. Lane graph lanes must convey status by shape or label, not color alone." This makes the requirement enforceable at PR review.

---

### FINDING-5 — AD-3 Rule contains an `[ASSUMPTION]` placeholder (LOW)

**Checklist violated:** "No TBD/placeholders; ADs have Binds/Prevents/Rule."

AD-3 Rule ends: "`[ASSUMPTION]` path seed: `/api/workflows/runs/:runId/git/{changes,log,diff}` and `/api/workflows/runs/:runId/git/file/*`." An AD Rule with an inline `[ASSUMPTION]` tag is not fully adopted — it exposes an unfixed wire format. The paths are acknowledged as seeds that "OpenAPI schemas own," but if two developers implement the JSON routes and the raw file route independently from the spine, they could pick different prefixes.

**Required fix:** Either (a) ratify the path prefix as the Rule (`/api/workflows/runs/:runId/git/…` is decided; exact sub-paths are fine to finalize in the OpenAPI schema definition task), or (b) move the path question to an open question and remove it from the AD Rule. The `[ASSUMPTION]` marker inside the Rule body is the violation — the decision itself is reasonable.

---

## Checklist Evaluation Summary

| Checklist Item                                                    | Status       | Finding                                                                                                      |
| ----------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| Fixes all real divergence points for epics/stories                | **PARTIAL**  | F-1 (binary), F-2 (lane graph), F-4 (a11y)                                                                   |
| Every AD's Rule is enforceable and prevents its stated divergence | **PARTIAL**  | F-3 (AD-6 NULL FK ambiguous), F-5 (AD-3 placeholder)                                                         |
| Nothing under Deferred could let two units diverge                | **FAIL**     | F-3 (child/subrun case is a must-pass Story 1.1 AC)                                                          |
| Named tech is verified-current                                    | **MARGINAL** | `react-diff-view@3.3.3` verified 2026-03-30 (6 months ago); re-verify before implementation                  |
| Ratifies rather than contradicts brownfield                       | **PASS**     | `execFileAsync`, `registerOpenApiRoute`, `api.generated.d.ts`, no new tables, package boundaries all honored |
| Covers spec's capabilities                                        | **PARTIAL**  | F-1 (binary/FR5), F-2 (lane graph/FR1+FR6)                                                                   |
| Every dimension decided, deferred, or open question               | **PARTIAL**  | F-1 (binary handling silent), F-2 (lane graph silent)                                                        |
| No TBD/placeholders in ADs                                        | **PARTIAL**  | F-5 (AD-3 `[ASSUMPTION]` in Rule)                                                                            |

---

## What Is Strong

- **AD-1 (pin and contain)** is the most precisely written AD in the spine: it names every attack vector, explicitly allows colon/leading-dash/glob filenames, mandates `--literal-pathspecs`, and prohibits `oid:path` revision syntax. Directly testable.
- **AD-2, AD-7** are clean, short, and unambiguous — they are unlikely to be misread.
- **AD-6 (container gate)** is the right architectural decision and the FK-resolution chain is explicit; only the NULL-path ambiguity needs patching (F-3).
- **AD-8 (CAP-8 seam)** is correctly scoped: seam only, fail-open, idempotent — aligns perfectly with NFR3.
- **Deferred table** is honest about what it carries and why. The large-diff spike and secret-redaction risk note are appropriately parked.
- **Stack table** version annotations are specific (exact version for the one new dep), and the "installed" vs "new" distinction is explicit.

---

## Minimum Required Before First Implementation Story

| #   | Fix                                                                                                    | AD affected |
| --- | ------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | Extend AD-6 Rule with NULL-FK tie-breaker                                                              | AD-6        |
| 2   | Add binary handling to Deferred (mechanism decided, thresholds build-time tunable) or a thin AD        | —           |
| 3   | Add lane-graph spike to Deferred as a pre-Story-2.1 blocker; add `@xyflow/react` to Stack as candidate | — / Stack   |
| 4   | Add `+`/`-` gutter marker + lane color-independence to AD-5 Rule                                       | AD-5        |
| 5   | Remove `[ASSUMPTION]` from AD-3 Rule body; ratify prefix or move to open question                      | AD-3        |
