---
type: rubric-review
spine: ARCHITECTURE-SPINE.md
scope: Archon Source Control — legacy UI (CAP-1–7 v1; CAP-8 seam)
method: Good-spine checklist against ARCHITECTURE-SPINE.md; adversarial, version, reconcile gate files read as supporting evidence; `working_path` column verified in migrations/000_combined.sql and sqlite.ts
verdict: pass-with-fixes
date: 2026-09-05
note: Canonical Finalize gate record. Applied into the spine before status:final. A later duplicate walker (639a0650) overwrote this file; that copy is archived as review-rubric-delayed-walker.md.
---

# Rubric Review — Archon Source Control Architecture Spine

## Verdict

**PASS-WITH-FIXES.** The spine is strong. All five adversarial incompatible pairs were resolved (pairs 1/2/3/5 tightened, pair 4 correctly rejected), all major reconcile items landed (CTA split, stale banner, region empties, a11y floor, viewer-rules thresholds), and every AD carries Binds / Prevents / Rule with no TBD placeholders. Three fixable gaps remain before the spine can serve as an unambiguous build substrate: one entirely silent operational dimension (auth), one NULL-path divergence point that is misclassified as Deferred, and a Voice & Tone constraint that is delegated rather than bound.

---

## Checklist Walkthrough

### ✅ Divergence points for the level below — all covered

Adversarial pairs 1–3 and 5 are fully absorbed: AD-4 now specifies `ref: "live"` sentinel and `cursor` as opaque-string-only; AD-6 mandates the container gate on every route without exemption; Consistency Conventions pin `HTTP 200 + { emptyReason }` uniformly. Pair 4 correctly rejected — `workflow_runs.working_path` verified present in `migrations/000_combined.sql` (`working_path TEXT NOT NULL` in CREATE TABLE, additive `working_path TEXT` in ALTER TABLE) and in `sqlite.ts` (`ADD COLUMN working_path TEXT`). The column is brownfield; AD-1's "do not add a column" directive is accurate.

### ✅ Every AD's Rule is enforceable and prevents its stated divergence

AD-1 through AD-9 all carry Binds, Prevents, and Rule. The rules are specific enough to prevent the stated divergence in each case:

- AD-1: names `ls-tree -z + cat-file blob` as the commit-scoped read; names `realpath` containment; lists exact reject conditions (NUL, absolute, encoded `..`); names success cases (colon, leading-dash, glob). Enforceable.
- AD-4: `ref: "live"` for `scope: "now"` and `cursor` opaque-string semantics close the two adversarial cache/pagination divergences. Enforceable.
- AD-6: gate on every git route, no exemption, HTTP 200 + emptyReason union, CTA split, region empties distinguished from CAP-6. Enforceable.
- AD-8: fail-open, idempotent, no new table, temp+rename, v1 no-op. Enforceable.
- AD-9: fourth tab, manual Reload, stale-content banner wording ("Changed on disk — Reload"), never-mutate-under-reader, read-only chrome. Enforceable.

### ⚠️ Finding 1 — NULL `isolation_env_id` path misclassified as Deferred [HIGH]

**Checklist rule:** Nothing under Deferred could let two units diverge. If it could, it belongs in an AD, not Deferred.

AD-6's container gate walks `run.conversation_id → conversation.isolation_env_id → isolationEnvironments.getById.provider === 'container'`. `isolation_env_id` is nullable TEXT (confirmed in migrations). The Deferred entry reads: "Child/subrun `isolation_env` when FK missing — D5: define + test at build, not an extra AD."

This is a runtime NULL path in the gate logic on every git route, not a feature gap. Two AD-compliant implementers will diverge on it:

- **Unit A (changes route):** walks the chain; `isolation_env_id` is NULL → `getById(null)` returns undefined → no `provider` field → container check fails → falls through to host availability check → git call proceeds. Folder-project runs or runs with no isolation row silently attempt git.
- **Unit B (log route):** walks the chain; `isolation_env_id` is NULL → treats "cannot determine" as "no checkout" → returns `emptyReason: "no_checkout"` → shows a Reload CTA that cannot resolve.

Neither unit violated an AD. The outcome differs by route, and the web sees contradictory empty-state variants for the same run.

**Required fix:** Extend AD-6's Rule: "If `conversation.isolation_env_id` is NULL (no isolation environment, folder project, or subrun without isolation), treat as host-availability-only: skip the container check and proceed to the directory-exists AND is-a-git-checkout test. Do NOT treat a missing FK as `no_checkout`."

---

### ⚠️ Finding 2 — Auth/authorization is a completely silent dimension [HIGH]

**Checklist rule:** Every dimension the altitude owns is decided, deferred, or an open question — silent dimensions are findings (especially auth).

The spine has nine ADs, a Consistency Conventions table, a Deferred table, and the Stack. None of them name an auth pattern for the git routes. The existing Archon API has a rich system: global API gate (optional per `ARCHON_WEB_AUTH_REQUIRED`), `resolveWebUserId` (optional identity), `requireWebUser` (strict 401), and the trusted proxy header. Routes serving file content — including file diffs and raw blobs from potentially sensitive codebases — carry materially different exposure than run metadata.

Two implementers will independently choose:

- Unit A: `resolveWebUserId` (mirrors the run-metadata routes), consistent with Archon's "visibility stays open today" default.
- Unit B: `requireWebUser` (treats file content as sensitive), following the credential/pref route precedent.

These produce different auth behavior on solo installs (global gate off) and different OpenAPI response declarations (no 401 vs. declared 401).

**Required fix (minimum):** Add a Deferred row stating the chosen pattern: "Auth: git routes follow the same pattern as run-detail routes (`resolveWebUserId` — optional identity, no route-level 401). Route-level run-ownership enforcement is not in v1." If stricter policy is intended, it needs an AD. Silence is not an option when building a raw content route.

---

### ⚠️ Finding 3 — Voice & Tone bound only by delegation, not by an enforceable rule [MEDIUM]

**Checklist rule:** Every AD's Rule must actually prevent its stated divergence.

AD-9 states: "Microcopy is owned by EXPERIENCE.md Voice and Tone (terse, non-alarming); do not invent alarm copy." This delegates the constraint to an external document rather than encoding an enforceable rule. The reconcile-inputs review identified this as the highest-risk silent loss: "Without it, implementers default to error chrome / alarm copy for CAP-6 and fetch failures, contradicting the primary flow climax ('the quiet nod')."

The specific anti-patterns the reconcile review flagged are not listed in the spine:

| Case            | Prohibited copy                    | Correct copy                |
| --------------- | ---------------------------------- | --------------------------- |
| Container empty | "Error: working tree not found ⚠️" | one-sentence absence reason |
| Fetch failure   | error toast with stack trace       | API error envelope + Reload |
| No changes      | empty-state with warning icon      | "No uncommitted changes"    |

A delegation to EXPERIENCE.md is better than nothing, but EXPERIENCE.md is a UX artifact, not a build substrate. Story-developers often don't read UX docs unless the spine binds them.

**Required fix (minimum):** Extend AD-9's Rule with three concrete prohibitions: (1) CAP-6 empty states MUST explain the absence in one plain sentence — no error chrome, no warning icon. (2) API failure on a live checkout surfaces the Reload affordance — never a modal or toast stack. (3) The alarm copy don'ts from EXPERIENCE.md's Do/Don't table are the binding floor. Alternatively, extract the reconcile-recommended AD-10 (Operator-facing quiet rules).

---

### ✅ Named tech is verified-current

The versions review (review-versions.md) confirmed every Stack table row against actual `package.json` files and a live npm fetch for `react-diff-view@3.3.3` (published 2026-03-30, confirmed). The spine correctly notes `react >=16.14` peer dep. No invented versions. The lodash runtime dep is flagged in the versions review's Finding 3 and is already cross-referenced in AD-5 ("Runtime dep `lodash@^4.17` — count in the large-diff spike").

### ✅ Ratifies brownfield — adversarial pair 4 correctly rejected

`workflow_runs.working_path` exists as nullable TEXT: present in both `migrations/000_combined.sql` (CREATE TABLE `working_path TEXT NOT NULL`; additive ALTER `working_path TEXT`) and `packages/core/src/db/adapters/sqlite.ts` (`ADD COLUMN working_path TEXT`). AD-1's "do not add a column, do not re-derive from `isolation_environments.metadata`" is correct. The adversarial pair 4's proposed fix (read from `isolation_environments.metadata.worktreePath`) would have introduced a new resolution path contradicting an established brownfield pin.

### ✅ CAP-1 through CAP-8 coverage

All eight capabilities are decided or deferred with a named mechanism:

| CAP                         | Status    | AD/note          |
| --------------------------- | --------- | ---------------- |
| CAP-1 Tab + Changes/History | v1        | AD-9             |
| CAP-2 M/A/D lists           | v1        | AD-2, AD-3       |
| CAP-3 Shared viewer         | v1        | AD-4, AD-5       |
| CAP-4 History               | v1        | AD-2, AD-7       |
| CAP-5 Read-only + confine   | v1        | AD-1, AD-9       |
| CAP-6 Empty states          | v1        | AD-6             |
| CAP-7 Large/binary          | v1        | AD-3, AD-4, AD-5 |
| CAP-8 Durable snapshot      | seam only | AD-8 Deferred    |

No capability is unaddressed.

### ✅ No TBD / placeholders; all ADs carry Binds / Prevents / Rule

Verified. All nine ADs have Binds, Prevents, and Rule. The `[ASSUMPTION]` tags in AD-3 and the Structural Seed name seeds, not invariants — they would not cause two units to diverge incompatibly since OpenAPI schema names the final paths, not the seed string.

### ✅ Parent spine — no Inherited Invariants section expected; correctly absent

Feature-altitude spine. No parent invariants section expected per checklist.

### ✅ Deferred items evaluated for divergence risk

| Deferred item                           | Risk                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| CAP-8 snapshot manifest + run-end write | Low — seam is AD-8; no write in v1; divergence impossible                                |
| Container overlay / docker-exec reads   | Low — CAP-6 is the response; both units return the same envelope                         |
| HITL reuse                              | Low — AD-5 forbids welding; reuse is composable                                          |
| Event-path provenance overlay           | Low — AD-7 prevents events-as-SoT                                                        |
| Secret redaction                        | Low — both units simply omit; they converge on "no redaction" not on divergent redaction |
| Large-diff spike                        | Low — experiment, not a code contract                                                    |
| **Child/subrun NULL isolation_env_id**  | **HIGH — diverges at runtime (see Finding 1)**                                           |

---

## Findings Summary

| #   | Finding                                                                                                | Severity | Checklist rule violated                                       |
| --- | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------- |
| 1   | NULL `isolation_env_id` is a runtime divergence in AD-6's gate; misclassified as Deferred              | HIGH     | "Nothing under Deferred could let two units diverge"          |
| 2   | Auth/authorization dimension is completely silent across all nine ADs, Conventions, and Deferred       | HIGH     | "Silent dimensions (especially auth) are findings"            |
| 3   | Voice & Tone is a delegation pointer, not an enforceable rule; reconcile-recommended AD-10 not created | MEDIUM   | "Every AD's Rule must actually prevent its stated divergence" |

No additional findings. Versions pass. Brownfield ratified. CAP coverage complete. All adversarial and reconcile outputs absorbed.

---

## Recommended Fixes (non-normative — spine authors decide)

**Fix 1 (AD-6 extension, 2 sentences):** Add to AD-6 Rule: "If `conversation.isolation_env_id` is NULL, skip the container check and proceed directly to host availability (directory exists AND is a git checkout). A missing FK is not a CAP-6 condition."

**Fix 2 (Deferred row, 1 line):** Add: "Auth: git routes follow the existing run-detail pattern (`resolveWebUserId` — optional identity; the global API gate is the floor). Route-level run-ownership enforcement is not in v1."

**Fix 3 (AD-9 Rule extension OR new AD-10, 3 bullet points):** Add explicit prohibitions for alarm copy, modal/toast on fetch failures, and warning chrome on absence states — or extract a thin AD-10 (Operator-facing quiet rules) binding the three items the reconcile review flagged as the highest implementation risk.
