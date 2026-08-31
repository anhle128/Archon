---
stepsCompleted:
  [
    'step-01-document-discovery',
    'step-02-prd-analysis',
    'step-03-epic-coverage-validation',
    'step-04-ux-alignment',
    'step-05-epic-quality-review',
    'step-06-final-assessment',
  ]
inputDocuments:
  - prd.md
  - architecture.md
  - addendum.md
  - ../../epics-source-control/epics.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-31
**Project:** Archon — Source Control Tab (feature)

## Step 1 — Document Discovery

**Scope:** the Source Control feature's handoff at `archon/_bmad-output/planning-artifacts/prds/prd-source-control/` (epics file: `epics-source-control/epics.md`).

**Documents found (this feature):**

- **PRD** — `prd.md` (whole, `status: final`).
- **Architecture** — `architecture.md` (whole, `status: decided`) + `addendum.md` (technical depth).
- **Epics & Stories** — `epics.md` (whole; 3 epics, 8 stories; `stepsCompleted` through step-04).
- **UX** — no standalone UX document. UI is clearly implied (a browser tab with panes and a diff viewer); per IR this is recorded as a **warning** (see Step 4). Severity is reduced because UX is specified inline in the PRD (UJ-1, §4) and architecture (viewer rules, tab-layout diagram), but the warning stands.

**Supporting (not assessed as specs):** `reconcile-source-control.md`, `review-source-control.md`, `.memlog.md`.

**Not duplicates — different feature (out of scope):** the flat `planning_artifacts/` holds `prd.md` / `architecture.md` / `epics.md` for the **Hermes Agent Workflow Commander** feature. These are a _different scope_, deliberately kept separate from this feature's subfolder; they are NOT duplicate versions of this feature's docs and must not be merged or resolved against it.

**Issues:** no duplicate versions of the Source Control docs, and no missing PRD / Architecture / Epics spec. **One warning:** no standalone UX contract although UI is implied — inline UX reduces severity; detailed in Step 4.

## Step 2 — PRD Analysis

### Functional Requirements (9)

- **FR1 — Source Control tab (two regions).** On the workflow-run screen, a fourth tab (beside Graph/Logs/Chat) presents, for the current run, its uncommitted Changes above its commit history, in VS Code's Source Control shape. Consequence: opening a run with an available checkout populates both regions without leaving the screen; a run with no available checkout shows the empty state (FR8).
- **FR2 — Manual reload.** The operator refreshes on demand; the tab never auto-refreshes or polls. Consequence: a Reload control re-fetches the current region/file; no background polling; if server content diverged since load, a "changed — Reload" affordance is offered rather than mutating the open view.
- **FR3 — Changed-file listing (M/A/D).** For the selected scope (uncommitted Now, and per selected commit), the operator sees which files changed, each labelled M, A, or D. Consequence: every listed entry is a real changed path shown as exactly one of M/A/D; other git statuses project (rename→D+A, copy→A, type-change→M, unmerged→M).
- **FR4 — Status-keyed diff viewer.** Clicking any file opens one shared viewer keyed by status: M two-pane diff (red=before, green=after); A/D single-pane content. Consequence: M shows before/after hunks, A the full new content, D the removed content; direction Now=HEAD→worktree, commit=parent→commit; M is diff-only in v1 (no standalone snapshot mode).
- **FR5 — Every file opens (large + binary).** Any changed file opens regardless of size or type, without blocking. Consequence: a multi-MB text file streams (Load-more) rather than being refused; a binary is not dumped as text (image renders inline; other binaries offer download or hex peek); nothing is blocked.
- **FR6 — Inspect any commit.** The operator selects any commit in history and sees its M/A/D files and their contents/diffs — the run's own branch history, including commits not present on the base branch. Consequence: a run-branch commit not yet merged into `dev` still shows its files and diffs.
- **FR7 — Server-resolved, run-confined, read-only access.** The server resolves the checkout from runId (working_path + codebase_id), realpaths it, rejects `..`; the UI never supplies the checkout root or an absolute/filesystem path (only a server-returned repo-relative path the server validates); strictly read-only. Consequence: no request reads outside the run's realpathed checkout, and no write/commit code path exists.
- **FR8 — Empty state for no readable checkout.** When the run has no readable git checkout (null working_path, directory absent at read time, not a git checkout, or a container-backend run), the tab shows an explicit empty state. Consequence: such runs render the empty state and never surface an error/crash; presence is decided by directory existence at read time, not run status.
- **FR9 — Durable run-end snapshot (fast-follow, not MVP).** A run's history and diffs stay available after its checkout is cleaned up, from a server-written run-end snapshot under output_root (live checkout primary, snapshot fallback). Consequence: after the checkout is reaped, Source Control history and diffs for that run still load from the snapshot.

Total FRs: 9 (FR9 is fast-follow).

### Non-Functional Requirements (6)

- **NFR1 — Performance.** Fetch-on-click with explicit loading feedback; must not regress the run screen (counter-metric SM-C1); large content streams; reads are on-demand only (manual Reload, no polling).
- **NFR2 — Security.** Resolve the checkout root server-side from runId (never client-supplied; the client passes only a validated server-returned repo-relative path); realpath-contain live reads under working_path (reject symlink escapes); read commit content via `git --literal-pathspecs ls-tree` + `git cat-file blob` on a validated commit OID (no `<oid>:<path>` revision syntax; colon / leading-`-` / glob-metachar filenames still open); reject NUL / absolute / encoded traversal; invoke via `execFileAsync` / `@archon/git`, argv-safe (no shell string); strictly read-only.
- **NFR3 — Reliability.** A vanished or missing checkout degrades to the empty state (never a crash); existence decided at read time, not by run status; a CAP-8 snapshot-write failure must not mark the run failed (log + metric).
- **NFR4 — Compatibility.** Honor Archon package boundaries — `registerOpenApiRoute` (with the raw `app.get` exception for the wildcard content route); `@archon/web` consumes OpenAPI-generated types only; no SDK leakage across package boundaries.
- **NFR5 — Observability.** Server-side reads emit named structured logs (`{domain}.{action}_{state}`) and never log file contents, disallowed paths, or secrets.
- **NFR6 — Privacy / secrets (residual risk).** v1 ships without redaction/denylist; the viewer can surface `.env`/keys; accepted because access is read-only and limited to trusted internal users who can already view the run; recorded for revisit.

Total NFRs: 6.

### Additional Requirements

Read-only hard guarantee; ship without a feature flag (low-risk); on-demand reads + manual Reload cap server load; depends on existing `GET /api/workflows/runs/{runId}` (working_path/codebase_id) and the artifact-route pattern.

### PRD Completeness Assessment

PRD is `status: final`, 9 FR + 6 NFR, every FR with testable consequences, non-goals explicit, success metrics + counter-metrics present, 6 assumptions indexed, 4 open questions tracked as non-blocking (existence check, CAP-8 format, thresholds, secret-revisit). Complete and clear for coverage validation.

## Step 3 — Epic Coverage Validation

### Coverage Matrix

| FR  | PRD requirement                | Epic coverage                                                          | Status    |
| --- | ------------------------------ | ---------------------------------------------------------------------- | --------- |
| FR1 | Tab + two regions              | Epic 1 / Story 1.1 (tab+Changes) + Epic 2 / Story 2.1 (history region) | ✓ Covered |
| FR2 | Manual reload                  | Epic 1 / Story 1.1                                                     | ✓ Covered |
| FR3 | List M/A/D                     | Epic 1 / Story 1.1 (Now) + Epic 2 / Story 2.2 (per-commit)             | ✓ Covered |
| FR4 | Status-keyed viewer            | Epic 1 / Stories 1.2, 1.3 (+ Epic 2 / 2.2 reuse)                       | ✓ Covered |
| FR5 | Every file opens               | Epic 1 / Story 1.4                                                     | ✓ Covered |
| FR6 | Inspect any commit             | Epic 2 / Stories 2.1, 2.2                                              | ✓ Covered |
| FR7 | Server-resolved read-only      | Epic 1 / Story 1.1 (+ containment in 1.2/1.3)                          | ✓ Covered |
| FR8 | Empty state                    | Epic 1 / Story 1.1 + Epic 2 / Story 2.1                                | ✓ Covered |
| FR9 | Durable snapshot (fast-follow) | Epic 4 / Stories 4.1, 4.2                                              | ✓ Covered |

### Missing Requirements

None. No PRD FR is uncovered; no epic story references an FR absent from the PRD.

### Coverage Statistics

- Total PRD FRs: 9
- FRs covered in epics: 9
- Coverage: 100%
- NFR1–NFR6 are cross-cutting and appear as story-level `**Requirements:**` NFR references (primarily Epic 1).

## Step 4 — UX Alignment

### UX Document Status

Not found as a standalone document. UX is specified **inline** in the PRD (UJ-1 + §4 features) and architecture (viewer rules, tab-layout diagram): two-region VS-Code-style layout, status-keyed M/A/D viewer, red/green diff, single-pane A/D, empty state, manual Reload.

### Alignment Issues

None. UX ↔ PRD: the inline UX matches the FRs (FR1 two-region, FR4 viewer, FR8 empty state). UX ↔ Architecture: supported by `react-diff-view` + `react-resizable-panels` + `@tanstack/react-virtual` + `highlight.js`; performance handled via hunk pagination; empty/error states specified. No UI element lacks architectural support.

### Warnings

- **UI implied but no standalone UX contract** (DESIGN/EXPERIENCE) — recorded as a warning per IR. Severity reduced: UX is fully inline and consistent with existing Archon web tokens; visual polish (exact spacing/tokens) is left to implementation using the existing design system. Not a readiness blocker.

## Step 5 — Epic Quality Review

### 🔴 Critical Violations

None. All three epics are user-value (inspect uncommitted changes / browse history / durable history), not technical milestones. No forward dependency; no epic requires a later one.

### 🟠 Major Issues

**Cross-document conflict (normative, identifier contract) — resolved by a wording fix.** Classification: normative and, as originally worded, mutually exclusive. FR7 originally asserted the client sends no path at all, which contradicted D2's wildcard content route and NFR2's `<path>` argument — the client must indicate _which_ file to open. Reconciliation (one implementation satisfies both): the client sends a **server-returned repo-relative path** (an identifier chosen from the changes/commit list the server produced); the **checkout root stays server-derived from `runId`** and the path is validated server-side (realpath-contained / `ls-tree`), never trusted as a filesystem location. Action taken: FR7 §4.5 + NFR2 Security (`prd.md`), Access/auth CAP-5 (`architecture.md`), path-pinning + mermaid (`addendum.md`), and FR7 + NFR2 (`epics.md`) all reworded to the single contract — checkout root server-derived, client passes only a validated server-returned repo-relative path (never the checkout root or an absolute/filesystem path). The D6 mechanism already assumed this.

No database-creation violation — the feature creates no tables (reads live git + existing rows).

### 🟡 Minor Concerns

- Story 1.1 covers several FRs (FR1 partial, FR2, FR3 Now, FR7, FR8). Acceptable: it is the **list-only Now slice** (no viewer — that is 1.2/1.3), the thin vertical foundation proving the read path + security. Watch sizing at dev time; split if it exceeds one session.
- UX warning carried from Step 4 (no standalone UX contract; UX inline).

### Best-practices checklist (all three epics)

- [x] User value · [x] independent (E1 alone; E2 on E1; E3 on E1+E2) · [x] sized single-session · [x] no forward deps · [x] no upfront DB · [x] Given/When/Then ACs with edge+error · [x] FR traceability (per-story `**Requirements:**`).

### Brownfield indicators

Integration points explicit: `GET /api/workflows/runs/{runId}`, the artifact-route pattern, the `conversation → isolation_env` FK. No starter template; new `@archon/git` helpers + server routes + web tab are additive.

## Summary and Recommendations

### Overall Readiness Status

**READY** — implementation may begin.

### Issues found and disposition

- **1 normative cross-document conflict (identifier contract)** — FR7 originally worded the client as sending no path at all, contradicting D2's wildcard content route and NFR2's `<path>` argument. **RESOLVED in place**: FR7 §4.5 + NFR2 Security (`prd.md`), Access/auth CAP-5 (`architecture.md`), path-pinning + mermaid (`addendum.md`), and FR7 + NFR2 (`epics.md`) reworded to one contract — _server-derived checkout root from `runId` + a server-returned repo-relative path, realpath-validated server-side; the client never supplies the checkout root or an absolute/filesystem path_.
- **1 UX warning** — no standalone UX contract; UX is inline in PRD/architecture. Accepted, not a blocker.
- **1 minor sizing watch** — Story 1.1 bundles the list-only Now slice (no viewer). Accept; split at dev time only if it exceeds one session.
- **4 PRD open questions** — host worktree existence check, CAP-8 snapshot trigger/format, large/binary thresholds, secret-redaction revisit. Non-blocking; each has a v1 default and is tracked for build/fast-follow.

### Coverage

9/9 FR covered by epics (100%); NFR1–NFR6 cross-cutting, mapped to story-level `**Requirements:**` (primarily Epic 1).

### Recommended Next Steps

1. Proceed to implementation via `bmad-sprint-planning` → `bmad-create-story` → `bmad-dev-story`, run **inside the Archon subproject** per the cross-project handoff contract.
2. Treat the 4 open questions as build-time decisions; keep the CAP-8 durable snapshot a **fast-follow** (not v1).
3. Make the named security tests the CAP-5/D6 acceptance gate: symlink escape, encoded traversal, invalid/unreachable OID (refused) and colon / leading-dash / glob-metachar filenames (open successfully).

### Final Note

This assessment reviewed 4 artifacts (PRD, architecture, addendum, epics). It found **1 normative conflict (resolved in place)** plus 1 warning, 1 minor sizing watch, and 4 tracked open questions — none blocking. **Status: READY.**

---

_Assessor: bmad-check-implementation-readiness · Date: 2026-08-31_
