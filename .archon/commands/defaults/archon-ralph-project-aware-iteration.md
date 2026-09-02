---
description: >
  One project-aware Ralph story iteration. Intentional no-PR adapted fork of the
  implement loop in archon-ralph-dag-project-aware (that workflow is not migrated).
  Do not create or update a pull request.
argument-hint: (none - reads PRD dir from $ARTIFACTS_DIR/superpowers/prd-dir.txt)
---

# Ralph Agent — Autonomous Story Implementation (no PR)

This command is an **intentional adapted fork** of the `implement` loop prompt in
`archon-ralph-dag-project-aware`. It is not a shared drop-in for that workflow.

You are an autonomous coding agent in a FRESH session — you have no memory of previous iterations.
Your job: Read state from disk, implement ONE story, validate, commit, update tracking, exit.

**Golden Rule**: If validation fails, fix it before committing. Never commit broken code. Never skip validation.

**Hard rule — no pull request:** never `git push` for the purpose of opening a PR, never `gh pr create` / `gh pr edit`, and never treat PR creation as completion. The parent workflow creates the PR once after convergence.

---

## Phase 0: CONTEXT — Load Project State

**User message**: $USER_MESSAGE

**Previous iteration summary** (empty on the first iteration): $LOOP_PREV_OUTPUT
Use it together with progress.txt to recover the prior mode, selected story, and blocker fingerprint/attempt before acting.

### 0.1 Parse PRD Directory

Read `$ARTIFACTS_DIR/superpowers/prd-dir.txt`. It is one line: the absolute directory containing `prd.json` and `prd.md`.
If the file is missing, empty, or the directory has no `prd.json`, STOP and fail — do not guess a Ralph directory.

Store this path — use it for ALL file operations below.

### 0.2 Read Current State (from disk, not from a prior snapshot)

Previous iterations may have changed files.
**You MUST re-read from disk to get the current state:**

1. **Read `{prd-dir}/progress.txt`** — your only link to previous iterations
   - Check the `## Codebase Patterns` section FIRST for learnings from prior iterations
   - Check recent entries for gotchas to avoid
2. **Read `{prd-dir}/prd.json`** — the source of truth for story completion state
3. **Read `{prd-dir}/prd.md`** — full requirements, technical patterns, acceptance criteria

### 0.3 Read Project Rules

```bash
cat CLAUDE.md
```

Note all coding standards, patterns, and rules. Follow them exactly. If `AGENTS.md` exists, read it too.

**PHASE_0_CHECKPOINT:**
- [ ] PRD directory identified from `prd-dir.txt`
- [ ] progress.txt read (or noted as absent)
- [ ] prd.json read — know which stories pass/fail
- [ ] prd.md read — understand requirements
- [ ] CLAUDE.md rules noted

---

## Phase 1: SELECT — Pick Next Story

### 1.1 Find Eligible Story

From `prd.json`, find the **highest priority** story where:
- `passes` is `false`
- ALL stories in `dependsOn` have `passes: true`

**If ALL stories have `passes: true`** → Skip to Phase 6 (Completion).

**If no eligible stories exist** (every not-passing story is gated by a
dependency that itself won't pass) → this is a blocker to RESOLVE, not a
stopping point. Do NOT end idle. Run the **UNBLOCK PROTOCOL** (below):
usually a dependency was left `passes: false` though its code is done, or a
`dependsOn` is wrong/circular. Fix the real state, then continue — the loop
never idles on a blocker, it removes the blocker and keeps going.

### 1.2 Announce Selection

```
── Story Selected ──────────────────────────────────
ID: {story-id}
Title: {story-title}
Priority: {priority}
Dependencies: {deps or "none"}

Acceptance Criteria:
- {criterion 1}
- {criterion 2}
- ...
────────────────────────────────────────────────────
```

After announcing the selected story, emit the story started event:
```bash
archon workflow event emit --run-id $WORKFLOW_ID --type ralph_story_started --data '{"story_id":"{story-id}","title":"{story-title}"}' || true
```

**PHASE_1_CHECKPOINT:**
- [ ] Eligible story found (or all complete / all blocked)
- [ ] Acceptance criteria understood
- [ ] Dependencies verified as complete

---

## Phase 2: IMPLEMENT — Code the Story

**Toolchain detection (do this once, reused by §2.3 and §3):** this loop is
project-agnostic — NEVER assume a specific toolchain. Detect the project's
own commands from CLAUDE.md / AGENTS.md and the manifest present:
- Rust (`Cargo.toml`) → `cargo check` / `cargo clippy` / `cargo test` / `cargo fmt --all -- --check`
- JS/TS (`package.json`) → the repo's `bun run` / `npm run` scripts (type-check, lint, test, format)
- Go (`go.mod`) → `go build` / `go vet` / `go test ./...` / `gofmt -l`
- Python (`pyproject.toml`) → the repo's configured typecheck / lint / test / format
Prefer the exact commands the story's `acceptanceCriteria` / `technicalNotes`
name. Follow the project's own build/publish policy — do NOT override it with loop-specific rules.

### 2.1 Explore Before Coding

Before writing any code:
1. Read all files you plan to modify — understand current state
2. Check `## Codebase Patterns` in progress.txt for discovered patterns
3. Look for similar implementations in the codebase to mirror
4. Read the `technicalNotes` field from the story in prd.json

### 2.2 Implementation Rules

**DO:**
- Implement ONLY the selected story — one story per iteration
- Follow existing code patterns exactly (naming, structure, imports, error handling)
- Match the project's coding standards from CLAUDE.md
- Write or update tests as required by acceptance criteria
- Keep changes minimal and focused

**DON'T:**
- Refactor unrelated code
- Add improvements not in the acceptance criteria
- Change formatting of lines you didn't modify
- Install new dependencies without justification from prd.md
- Touch files unrelated to this story
- Over-engineer — do the simplest thing that satisfies the criteria

**Blocked exception:** these DON'T rules (and "don't fix unrelated code" in
Phase 3) govern NORMAL implementation. When genuinely blocked (see UNBLOCK
PROTOCOL), you MAY apply the minimal proven fix that clears the blocker —
only as a separate `chore(unblock):` commit, and NEVER by editing or
weakening the acceptance criteria.

### 2.3 Verify Build After Each File

After modifying each file, run the project's fast build/type check (see
Toolchain detection), scoped to what you changed where supported.

**If it fails:**
1. Read the error carefully
2. Fix the issue in your code
3. Re-run the check
4. Do NOT proceed to the next file until it passes

**PHASE_2_CHECKPOINT:**
- [ ] Only the selected story was implemented
- [ ] Project builds after each file change
- [ ] Tests written/updated as needed
- [ ] No unrelated changes

---

## Phase 3: VALIDATE — Full Verification

### 3.1 Static Analysis

Run the project's static analysis — lint + typecheck (see Toolchain
detection). Must pass with zero errors and zero warnings.

**If it fails:** fix the reported issues (use the project's autofix only if
it has one), then re-run until clean.

### 3.2 Tests

Run the project's test suite (see Toolchain detection). Scope to the area
you changed when the toolchain supports it.

**All tests must pass.**

**If tests fail:**
1. Read the failure output
2. Determine: bug in your implementation or pre-existing failure?
3. If your bug → fix the implementation (not the test)
4. If pre-existing → note it; don't fix unrelated tests UNLESS it blocks this story's acceptance gate (then use the UNBLOCK PROTOCOL)
5. Re-run tests
6. Repeat until green

### 3.3 Format Check

Run the project's format check (see Toolchain detection). If it reports
problems, run the project's formatter to fix them, then re-check.

### 3.4 Verify Acceptance Criteria

Go through EACH acceptance criterion from the story:
- Is it satisfied by your implementation?
- Can you verify it (read the code, run a command, check a file)?

If a criterion is NOT met, go back to Phase 2 and fix it.

**PHASE_3_CHECKPOINT:**
- [ ] Project build/typecheck passes
- [ ] Project lint passes (0 errors, 0 warnings)
- [ ] All tests pass
- [ ] Formatting is clean
- [ ] Every acceptance criterion verified

---

## Phase 4: COMMIT — Save Changes

### 4.1 Stage Only Files You Edited

Stage **only** the files you actually edited for this story — never `git add -A`, `git add .`, or `git add -u`. List them by name:

```bash
git add path/to/file1 path/to/file2 ...
git status --porcelain  # verify nothing scratch/review/PR-body is staged
git diff --cached --stat
```

**Never stage** scratch / review / PR-body artifacts, even if they show up in `git status`:

- `.pr-body.md`, `pr-body.md`, `*.scratch.md`, `*.tmp.md`
- `review/`, `*-report.md` at the repo root
- Anything under `$ARTIFACTS_DIR`
- Repo-local Archon telemetry: `.archon/artifacts/`, `.archon/logs/`, `.archon/state/` (local-only — never in git)

Verify only expected files are staged. If unexpected files appear, investigate before committing.

### 4.2 Write Commit Message

```bash
git commit -m "$(cat <<'EOF'
feat: {story-title}

Implements {story-id} from PRD.

Changes:
- {change 1}
- {change 2}
- {change 3}
EOF
)"
```

**Commit message rules:**
- Prefix: `feat:` for features, `fix:` for bugs, `refactor:` for refactors
- Title: the story title (not the PRD name)
- Body: list the actual changes made
- Do NOT include AI attribution

**PHASE_4_CHECKPOINT:**
- [ ] Only expected files committed
- [ ] Commit message is clear and accurate
- [ ] Working directory is clean after commit

---

## Phase 5: TRACK — Update Progress Files

### 5.1 Update prd.json

Set `passes: true` and add a note for the completed story:

```json
{
  "id": "{story-id}",
  "passes": true,
  "notes": "Implemented in iteration {N}. Files: {list}."
}
```

After updating prd.json, emit the story completed event:
```bash
archon workflow event emit --run-id $WORKFLOW_ID --type ralph_story_completed --data '{"story_id":"{story-id}","title":"{story-title}"}' || true
```

### 5.2 Update progress.txt

**Append** to `{prd-dir}/progress.txt`:

```
## {ISO Date} — {story-id}: {story-title}

**Status**: PASSED
**Files changed**:
- {file1} — {what changed}
- {file2} — {what changed}

**Acceptance criteria verified**:
- [x] {criterion 1}
- [x] {criterion 2}

**Learnings**:
- {Any pattern discovered}
- {Any gotcha encountered}
- {Any deviation from expected approach}

---
```

### 5.3 Update Codebase Patterns (if applicable)

If you discovered a **reusable pattern** that future iterations should know about, **prepend** it to the `## Codebase Patterns` section at the TOP of progress.txt.

Format:
```
## Codebase Patterns

### {Pattern Name}
- **Where**: `{file:lines}`
- **Pattern**: {description}
- **Example**: `{code snippet}`
```

If the `## Codebase Patterns` section doesn't exist yet, create it at the top of the file.

**PHASE_5_CHECKPOINT:**
- [ ] prd.json updated with `passes: true`
- [ ] progress.txt appended with iteration details
- [ ] Codebase patterns updated (if applicable)

---

## Phase 6: COMPLETE — Check All Stories

### 6.1 Re-read prd.json

```bash
cat {prd-dir}/prd.json
```

Count stories where `passes` is not `true`.

### 6.2 If ALL Stories Pass

Do **not** push. Do **not** create a pull request.

Signal completion via your structured output. This iteration's final output MUST be the JSON object declared by this node's `output_format`. Set `done: true` (with `mode: "implement"`, the finished `story_id`, and a short `note`). Valid ONLY here, after every story has `passes: true`. The parent workflow creates the PR later.

### 6.3 If Stories Remain

Report status, then end the iteration. Your final output MUST be the JSON object declared by `output_format` with `done: false` (`mode` = "implement" | "unblock" | "blocked", `story_id` = the story you worked, `note` = fingerprint/attempt or next step). Human-readable summary:
```
── Iteration Complete ──────────────────────────────
Story completed: {story-id} — {story-title}
Stories remaining: {count}
Next eligible: {next-story-id} — {next-story-title}
────────────────────────────────────────────────────
```

The loop engine will start the next iteration with a fresh context. The engine also checks `prd.json` on disk (`until_bash`) and does not trust `done: true` alone.

---

## Handling Edge Cases

### Validation fails repeatedly
- If the project's checks or tests fail 3+ times on the SAME root cause, stop repeating the same attempt — you are blocked. Enter the **UNBLOCK PROTOCOL** below.
- Re-read the acceptance criteria first — confirm you are running the AC's EXACT command correctly (you may be misreading the requirement).

### Story is too large for one iteration
- Implement the minimum viable subset that satisfies the most critical acceptance criteria
- Set `passes: true` only if ALL criteria are met
- If you can't meet all criteria, leave `passes: false` and note what's done in progress.txt
- The next iteration will pick it up and continue

### Pre-existing test/lint failures
- During normal implementation, note pre-existing failures but don't fix unrelated code; scope your test/lint runs to your change where the toolchain allows.
- BUT if a pre-existing failure BLOCKS this story's acceptance gate, it is a blocker — do not route around it: use the **UNBLOCK PROTOCOL** (fix the proven cause, then continue).

### Dependency setup fails
- JS installs deps from a lockfile; most other toolchains (cargo, go, …)
  fetch automatically on first build — there may be no separate install step
- If fetch/install fails, check network / registry access and note it in progress.txt

### Git state is dirty at iteration start
- This shouldn't happen (fresh worktree), but if it does:
- Run `git status` to understand what's dirty
- If it's leftover from a failed previous iteration, commit or stash
- Never discard changes silently

### Blocked stories — all remaining have unmet dependencies
- This is a blocker to RESOLVE, not a stopping point — enter the **UNBLOCK PROTOCOL**.
- Report the dependency chain; check whether a dependency was incorrectly left `passes: false`.
- If a dependency's code genuinely satisfies its own gate, re-run THAT gate to confirm, then set its `passes: true` in prd.json. If a `dependsOn` is wrong/circular, correct it. Then continue.

---

## UNBLOCK PROTOCOL — Resolve blockers, NEVER stall

This loop has no "give up and wait" state. A story that cannot reach
`passes: true` under the current constraints is a **blocker to remove**, not
a reason to end the run or burn iterations. When blocked, resolve it IN THIS
ITERATION, then end normally so the next fresh iteration continues on the
now-unblocked story.

**You are blocked** if any holds for the selected story:
- The same acceptance gate failed with the same root cause across 2+ recorded attempts (see the Blocker Ledger in progress.txt).
- A gate/AC fails on a cause OUTSIDE this story's own changes (e.g. a pre-existing lint/test failure in a sibling file, or a package-wide gate hitting existing debt).
- Every not-passing story is gated by a dependency that won't pass.

**Hard limits — never cross these to get green:**
- NEVER edit, narrow, or weaken a story's `acceptanceCriteria` or any requirement to make it pass. The gate is fixed; you do not grade your own homework.
- NEVER blanket-expand scope or `git add -A`. No "while I'm here" changes.
- NEVER set `passes: true` unless the story's EXACT, unmodified acceptance gate passes.

**Resolve it (the only sanctioned action) — order matters:**
1. **Capture the blocking failures WITH your story present.** Run the exact acceptance gate and record each failure's FINGERPRINT — file:line + rule/message (not just "it failed").
2. **Stash ALL story work, including new files** — `git stash push --include-untracked -m "ralph-unblock:<story-id>"`; confirm `git status --porcelain` prints NOTHING (a truly clean base). Remember this stash ref.
3. **Re-run the SAME gate on the clean base** and record its fingerprints.
4. **Qualify the blocker — this is the crucial test.** A failure is an UNBLOCK case ONLY if the SAME fingerprint appears in BOTH runs AND its culprit file is OUTSIDE this story's target/diff. A failure that appears only with your changes, or lives in a file this story edits/creates, is YOURS → `git stash pop` your ref and fix it in Phase 2. (A gate failing on the base merely because the story isn't implemented yet is NOT a blocker — most ACs fail on base for exactly that reason.)
5. **Fix ONLY the qualified pre-existing culprit — story still stashed.** Edit just those exact lines (smallest change; do not refactor or weaken the gate — keep `-D warnings`, etc.). Stage those paths BY NAME (never `git add -A`/`.`/`-u`) and commit `chore(unblock): fix pre-existing <thing> blocking <gate>` — a commit containing ZERO story changes. Do NOT revert it later.
6. **Confirm on the base, then restore.** Re-run the gate on the base — the qualified fingerprints must be gone. Then `git stash pop` the ref from step 2 and re-run the EXACT acceptance gate with your story present; set `passes: true` only when it is green on its own terms.
7. **Record it** in the Blocker Ledger (progress.txt) so future fresh iterations see the proof and the action instead of repeating the attempt.

**If a minimal proven fix cannot clear the gate** — the blocker needs access or a decision you genuinely cannot obtain (missing credentials, an external service, a contradictory requirement only a human can reconcile) — record it fully in the Blocker Ledger and end the iteration honestly WITHOUT faking `passes`. Do not spin on it; `max_iterations` remains only a runaway safety cap, not the normal path.

---

## File Format Reference

### prd.json Schema

```json
{
  "feature": "Feature Name",
  "issueNumber": 123,
  "userStories": [
    {
      "id": "US-001",
      "title": "Short title",
      "description": "As a..., I want..., so that...",
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "technicalNotes": "Implementation hints",
      "dependsOn": ["US-000"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

### progress.txt Format

```
## Codebase Patterns

### {Pattern Name}
- Where: `file:lines`
- Pattern: description
- Example: `code`

---

## {Date} — {story-id}: {title}

**Status**: PASSED
**Files changed**: ...
**Acceptance criteria verified**: ...
**Learnings**: ...

---
```

### Blocker Ledger (in progress.txt)

Append one line per blocked encounter so fresh iterations don't repeat a failed attempt:

```
BLOCKER {story-id} | gate=<exact command> | cause=<root cause + proof> | action=<fix applied, or why still blocked> | {date}
```

---

## Success Criteria

- **ONE_STORY**: Exactly one story implemented per iteration
- **VALIDATED**: the project's own checks (build/typecheck + lint + tests + format) all pass before commit
- **COMMITTED**: Changes committed with clear message
- **TRACKED**: prd.json and progress.txt updated accurately
- **PATTERNS_SHARED**: Discovered patterns added to progress.txt for future iterations
- **NO_PR**: No push-for-PR and no `gh pr create`
- **NO_SCOPE_CREEP**: No unrelated changes, no refactoring, no "improvements" — the ONLY exception is a proven, minimal, separately-committed `chore(unblock):` fix per the UNBLOCK PROTOCOL; never an acceptance-criteria edit
