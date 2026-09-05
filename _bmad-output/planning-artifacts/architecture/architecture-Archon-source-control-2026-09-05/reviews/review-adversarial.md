---
type: adversarial-review
spine: ARCHITECTURE-SPINE.md
scope: Archon Source Control — legacy UI (CAP-1–7 v1)
method: Two independent units each obeying every AD to the letter, then compared for build-time or runtime incompatibility
verdict: NEEDS FIXES — 5 incompatible pairs found; each requires a new or tightened AD
date: 2026-09-05
---

# Adversarial Review — Archon Source Control Architecture Spine

## Verdict

**NEEDS FIXES.** Five incompatible pairs were constructed, each unit fully AD-compliant in isolation. The conflicts arise from underspecified field semantics (pairs 1–2), a scoping gap in a safety gate (pair 3), a missing DB column (pair 4), and a forked error-response contract (pair 5). None require restructuring the spine; each requires a tightened or new AD clause.

---

## Pair 1 — `ref` is undefined for `scope: "now"`

**AD obeyed:** AD-4 (both units implement the canonical hunk shape exactly).

**Unit A — server/changes-route team**
Implements the diff endpoint. For a live-worktree diff (`scope: "now"`) there is no commit OID, so the team emits `ref: null` — nothing in AD-4 forbids this. For commit-scoped diffs they emit the full SHA.

**Unit B — web/source-control team**
Builds the `@tanstack/react-query` fetcher. They key every query by `[runId, path, scope, ref]` so stable diffs are not re-fetched when the component remounts. When `scope === "now"` arrives with `ref: null`, the cache key becomes `[runId, path, "now", null]`. Two simultaneous live-diff pane opens for different files both resolve to distinct keys — harmless. But when a user reloads after a new commit lands, the new live diff arrives with `ref: null` again, and react-query serves the stale cached entry because the key is unchanged. The viewer silently shows a stale diff with no indication it is stale.

**The hole:** AD-4 defines `ref` for `scope: "commit"` only by implication. `scope: "now"` has no specified `ref` value — null, absent, or a stable sentinel ("live") are all equally AD-compliant and produce incompatible cache behaviour depending on which the server team chooses.

**AD to add/tighten:** Extend AD-4 to state: "`ref` MUST be the string `"live"` (never null or absent) when `scope: "now"`. Cache keys that include `ref` will then change only when the scope changes, not never."

---

## Pair 2 — `cursor` type is unspecified, consumed as an integer by the web

**AD obeyed:** AD-3 (both units implement byte/line ranges and cursor-based pagination), AD-4 (hunk shape correct), AD-5 (virtualized list via `@tanstack/react-virtual`).

**Unit A — server/git-route team**
Implements `cursor` in the hunk response as an opaque base64-encoded JSON blob — `btoa(JSON.stringify({ byteOffset: 14820 }))` — following the general Archon convention for opaque pagination cursors. This is AD-4 compliant: AD-4 names the field but does not specify its type.

**Unit B — web/source-control team**
Reads AD-5: "large diffs via `@tanstack/react-virtual` plus AD-4 `cursor`." They interpret `cursor` as a numeric line offset (consistent with AD-3's "byte/line ranges" language for the raw file route) so they can call `virtualizer.scrollToIndex(cursor)` after appending the new hunk page. They cast `Number(cursor)`. Server emits a base64 string; `Number("eyJieXR...")` → `NaN`. The next-page fetch never fires; the virtual list freezes at page 1 with no error.

**The hole:** AD-4 names `cursor` but specifies neither its type nor whether the web must treat it as opaque. AD-3's "byte/line ranges" language is about the raw file route, not the hunk cursor, but the web team conflates them.

**AD to add/tighten:** Extend AD-4: "`cursor` is an opaque string (never a number or structured object) that the web sends verbatim as `?cursor=<value>` on the next page request. The web MUST NOT parse, cast, or use it as a scroll offset. Virtualized scroll position is derived from the accumulated hunk line counts, not from `cursor`."

---

## Pair 3 — AD-6 container gate is applied inconsistently across routes

**AD obeyed:** AD-6 (both units apply the container check before git I/O), AD-7 (live git is SoT).

**Unit A — server/changes-route team**
Implements `GET /api/workflows/runs/:runId/git/changes`. Follows AD-6 to the letter: walks `run.conversation_id → conversation.isolation_env_id → isolationEnvironments.getById.provider === 'container'`. If true, returns CAP-6 immediately — no git call.

**Unit B — server/history-route team**
Implements `GET /api/workflows/runs/:runId/git/log` (History tab). They reason: "git log reads committed history — it works even after a worktree is deleted. AD-6 says the gate prevents inferring container from `codebases.kind` or a filesystem heuristic; that's about live-file reads. Commit history is immutable; skipping the gate is safe and more capable." They skip the isolation check and call `git -C working_path log` directly. This is still AD-6 compliant in the letter: AD-6 says "all git routes" but the only enforcement text is "before git I/O," and they argue git-log isn't a "live checkout read."

**The incompatibility:** A run on a container environment returns CAP-6 on the Changes tab (correct) but returns real git log data on the History tab (incorrectly — CAP-6 should apply uniformly per AD-6's stated `scope: all git routes`). The web's empty-state component renders "Changes not available for container runs" beside a fully populated History list. The user sees contradictory information; more critically, `git -C working_path log` on a container run will fail with a non-zero exit (the path is a container volume mount, not a worktree) and surface as an unclassified error, not as CAP-6.

**AD to add/tighten:** Tighten AD-6: "The container check (`isolation_env.provider === 'container'`) is mandatory on every git route — changes, log, diff, and file — without exception. No route may call any `@archon/git` helper before this check passes. 'Committed history is immutable' is not an exemption."

---

## Pair 4 — `run.working_path` does not exist in the documented schema

**AD obeyed:** AD-1 (both units resolve working_path from the run row and realpath it), AD-2 (git call goes through `@archon/git` helpers).

**Unit A — server/changes-route team**
Implements AD-1 faithfully: loads `run.working_path` from the DB, calls `realpath`, rejects if missing. They add a `working_path` column to `workflow_runs` in `migrations/000_combined.sql` and write it at worktree-create time. Additive-only, correct per AGENTS.md schema rules.

**Unit B — isolation/worktree team**
Works independently on the worktree lifecycle (existing code). AGENTS.md documents `output_root` on `workflow_runs` as "the resolved `~/.archon/workspaces/<project>/` this run's artifacts, logs, and state live under, written ONCE at run start." The worktree _checkout path_ lives in `isolation_environments.metadata` JSON (the container backend stores `{containerId, volume, …}` there; the worktree backend stores `{branchName, …}`). The isolation team never writes a `working_path` column — they write `output_root` and populate `isolation_environments.metadata`. Unit A's new column is null for every existing and new run until someone wires the write path.

**The incompatibility:** Unit A reads `run.working_path` → always NULL → realpath fails → every git route returns 404/500 for all runs. The feature ships broken end-to-end while every AD is technically obeyed: AD-1 says "server loads `run.working_path`" without specifying which column or join supplies it.

**AD to add/tighten:** Tighten AD-1: "The checkout path is resolved as follows: load the run's active `isolation_environment` row via `run.conversation_id → conversation.isolation_env_id`; for `provider === 'worktree'`, the path is `isolationEnvironments.metadata.worktreePath` (or the equivalent field). No new `working_path` column is added; the path is never denormalised onto the run row. Callers: realpath the result and reject if missing or non-git."

---

## Pair 5 — CAP-6 response envelope forks across routes (200 vs 404)

**AD obeyed:** AD-3 (all JSON routes use `registerOpenApiRoute`; the raw file route uses `app.get`), AD-6 (container check fires before git).

**Unit A — server/changes-route team**
Returns a CAP-6 empty state as `HTTP 200` with `{ files: [], emptyReason: "container" }`. This satisfies AD-3 (a typed OpenAPI JSON response) and the consistency conventions ("200 + typed empty payload"). A `200` keeps the OpenAPI schema simple — one response code, one shape.

**Unit B — server/diff-route team**
Returns CAP-6 as `HTTP 404` with `{ code: "CAP_6", message: "Source control not available for container runs" }`. This satisfies the consistency conventions' parenthetical "or 404 with that code" option. They argue that from the web's perspective a diff for a container run simply does not exist, so 404 is semantically correct.

**The incompatibility:** The web's unified `useGitRoute` hook detects CAP-6 by checking `response.status === 200 && data.emptyReason === "container"`. The Changes tab triggers this branch and renders the container empty-state component. The diff route 404 is not matched — it falls into the generic error handler and renders an "Unexpected error — Reload" toast. The user sees the correct CAP-6 copy on the Changes list and an error toast when they click any file (which internally fetches the diff route). The experience is incoherent even though both routes are individually correct. Additionally, `registerOpenApiRoute` requires a declared response schema; the diff team declares a `404` response object, but the changes team declares only `200` — the generated OpenAPI spec has different response shapes for the same semantic, confusing downstream API consumers.

**AD to add/tighten:** Add a joint clause to AD-3 and AD-6: "CAP-6 MUST be returned as `HTTP 200` with a typed JSON envelope `{ emptyReason: 'container' | 'no_checkout' }` on every git route (changes, log, diff, file). The `404` parenthetical in the consistency conventions is removed. Every `registerOpenApiRoute` call includes a `200` response schema that unions the real payload with `{ emptyReason }` so the web can discriminate with a single check."

---

## Summary

| #   | Incompatible Pair                                                                                                 | Governs     | New/Tightened AD                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| 1   | Server emits `ref: null` for live scope; web uses `ref` as react-query cache key → stale diffs                    | AD-4        | Specify `ref: "live"` sentinel for `scope: "now"`                                              |
| 2   | Server emits opaque base64 `cursor`; web casts to integer for virtual scroll → `NaN`, pagination frozen           | AD-4        | Declare `cursor` opaque string; web derives scroll from hunk line counts                       |
| 3   | Changes route applies AD-6 container gate; log route skips it ("history is immutable") → contradictory tab states | AD-6        | Gate is mandatory on every git route; no exemptions                                            |
| 4   | Server reads `run.working_path` column; isolation layer never writes it → all git routes return null path errors  | AD-1        | Name the exact resolution path (`isolation_environments.metadata.worktreePath`); no new column |
| 5   | Changes route returns `200 + emptyReason`; diff route returns `404 + code` → web catches only one branch          | AD-3 + AD-6 | Mandate `200 + { emptyReason }` envelope for CAP-6 on every git route; remove the `404` option |
