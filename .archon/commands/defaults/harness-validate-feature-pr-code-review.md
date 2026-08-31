---
description: Review a harness-service feature PR on the current checkout only — map claimed behavior to the diff, no develop/base comparison
argument-hint: (none - reads from artifacts)
---

# Code Review: Feature Checkout (Claimed Behavior)

Analyze the PR checkout as a **feature** (new or changed behavior), not as a bugfix that must be proven against develop/base.

**Output artifact**: `$ARTIFACTS_DIR/code-review.md`

**Forbidden**: do not check out develop/base, do not read `.canonical-repo` or `.pr-base` for a before/after comparison, do not write a "bug on main" section, do not use dual-branch comparison success tokens.

---

## Phase 1: Load Context

### 1.1 PR identity

```bash
PR_NUMBER=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-number")
PR_REPO=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-repo")
gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json title,body,headRefName,baseRefName,labels,files,additions,deletions,changedFiles,url
gh pr diff "$PR_NUMBER" --repo "$PR_REPO"
```

Treat title, body, and `Fixes #N` / `Closes #N` as **feature requirements**, not as a bug to reproduce on base.

### 1.2 Checkout paths

```bash
cat "$ARTIFACTS_DIR/.worktree-path"
cat "$ARTIFACTS_DIR/.feature-branch"
cat "$ARTIFACTS_DIR/.pr-head"
cat "$ARTIFACTS_DIR/.pr-head-sha"
cat "$ARTIFACTS_DIR/.local-head-sha"
```

`resolve-paths` already aborted the run if local HEAD != PR head SHA. No mismatch handling needed here.

Working directory is the feature checkout. Read changed files **in full** from `pwd`, not from snippets in the diff.

---

## Phase 2: Map Claims

For each claim in the PR title/body/linked issues:

| Claim | Implemented? | Evidence (file:symbol) |
|-------|----------------|------------------------|
| {claim} | YES / PARTIAL / NO | `{path}` `{symbol}` |

`YES` = the checkout contains the claimed behavior.
`PARTIAL` = some of the claim is present, gaps remain.
`NO` = the claim is not implemented.

Then review:

- **Correctness**: does the code actually do what the claim says?
- **Completeness**: missing routes, SSE frames, SQLite migrations, TUI paths?
- **Side effects**: HTTP contract (`deny_unknown_fields`), token handling, schema history tables
- **Safety**: never log `GIGO_RUNNER_LISTENER_TOKEN`; no copy of host `~/.gigo/chat.db`
- **AGENTS.md / CLAUDE.md**: focused-test policy — flag any added `cargo test --workspace` as default local loop
- **Env**: if the diff adds/renames `GIGO_*` keys, check `brain/EnvMapping.md`

Do not score the PR on whether a bug existed on develop.

---

## Phase 3: Write `$ARTIFACTS_DIR/code-review.md`

```markdown
# Feature PR Code Review: PR #{number}

**PR Title**: {title}
**Feature Branch**: {branch}
**Files Changed**: {count}
**Lines**: +{additions} -{deletions}

## Claim Map

| Claim | Implemented? | Evidence |
|-------|----------------|----------|
| {claim} | YES / PARTIAL / NO | {file:symbol} |

## Quality

| Criterion | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Correctness | {n} | {does claimed behavior exist?} |
| Completeness | {n} | {edge cases / contracts} |
| Simplicity | {n} | {minimal changes?} |
| Safety | {n} | {token, sqlite, env} |
| Patterns | {n} | {matches this repo?} |

**Overall Score**: {average}/5

## File-by-File Analysis

#### `{file}`
**Change Summary**: {what changed}
**Assessment**: good / needs-work / concern

## Issues Found

#### Issue 1: {title}
**Severity**: CRITICAL / HIGH / MEDIUM / LOW
**File**: `{file}:{line}`
**Description**: {what's wrong}
**Suggested Fix**: {how}

## AGENTS.md / CLAUDE.md

| Rule | Status | Notes |
|------|--------|-------|
| Focused tests (no workspace default) | PASS/FAIL | {details} |
| Env keys vs EnvMapping.md | PASS/N/A/FAIL | {details} |

## Verdict

**APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION**

{2-3 sentences on whether claimed feature is present on this checkout.}
```

---

## Success Criteria

- **DIFF_ANALYZED**: Full PR diff reviewed
- **FILES_READ**: Changed files read in full from the checkout
- **CLAIMS_MAPPED**: Each PR claim → YES / PARTIAL / NO
- **AGENTS_MD_CHECKED**: Focused-test policy (and env mapping if applicable)
- **ARTIFACT_WRITTEN**: `$ARTIFACTS_DIR/code-review.md` created
