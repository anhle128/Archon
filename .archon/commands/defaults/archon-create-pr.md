---
description: Create a PR from current branch with implementation context
argument-hint: (none - uses $BASE_BRANCH from config or repo)
---

# Create Pull Request

**Base branch**: $BASE_BRANCH
**PR target remote**: $PR_REMOTE

> Always use `$BASE_BRANCH` for `--base`. Do not infer or override the PR base from `$ARGUMENTS`.
> Always resolve the PR target repository from `$PR_REMOTE` and pass `--repo "$PR_REPO"` to every `gh pr` and `gh issue` command.

---

## Pre-flight: Resolve related issue and existing PRs

GitHub closes a linked issue when a pull request that contains a closing keyword (`Closes #N`, `Fixes #N`, or `Resolves #N`) as live text — not inside a comment, code fence, or HTML comment — is merged into the repository default branch. Find that issue and put `Closes #N` in this PR body even when `$BASE_BRANCH` is not the default branch.

```bash
BRANCH=$(git branch --show-current)
PR_REPO=$(gh repo view "$(git remote get-url "$PR_REMOTE")" --json nameWithOwner -q .nameWithOwner)
ORIGIN_REPO=$(gh repo view "$(git remote get-url origin)" --json nameWithOwner -q .nameWithOwner)
ORIGIN_OWNER=${ORIGIN_REPO%%/*}
if [ "$ORIGIN_REPO" = "$PR_REPO" ]; then
  PR_HEAD="$BRANCH"
else
  PR_HEAD="${ORIGIN_OWNER}:$BRANCH"
fi
```

### Resolve ISSUE_NUM

Try sources in this order. Stop at the first number that `gh issue view` confirms on `$PR_REPO`:

1. `$ARGUMENTS` — `#123`, `issue 123`, `owner/repo#123`, or a GitHub issue URL
2. Branch name — `issue-123`, `fix/issue-123`, `feat/123-slug`, `#123`. Do not take an arbitrary digit run (Node versions, years)
3. Commits on this branch — `Closes #N` / `Fixes #N` / `Resolves #N` in `git log origin/$BASE_BRANCH..HEAD`
4. Workflow artifacts under `$ARTIFACTS_DIR` — the same closing-keyword or issue-URL forms
5. Open-issue search on `$PR_REPO` — query from the intended PR title, first commit subject, and implementation summary. Use a match only when one open issue is clearly the same work

```bash
# Explicit issue tokens on the branch (issue-123 / #123 / type/123-slug)
ISSUE_NUM=$(printf '%s' "$BRANCH" | grep -oE 'issue[-/][0-9]+|#[0-9]+' | grep -oE '[0-9]+' | tail -1)
if [ -z "$ISSUE_NUM" ]; then
  ISSUE_NUM=$(printf '%s' "$BRANCH" | grep -oE '^(fix|feat|feature|bug|bugfix|hotfix|chore)/[0-9]+' | grep -oE '[0-9]+')
fi

if [ -n "$ISSUE_NUM" ]; then
  gh issue view "$ISSUE_NUM" --repo "$PR_REPO" --json number,title,state,url
fi
```

If those sources are empty, search:

```bash
gh issue list --repo "$PR_REPO" --state open --limit 20 --json number,title,url
```

**Completion:** `ISSUE_NUM` is a confirmed issue number, or you searched and recorded that none exists. Do not invent a number.

### Existing PR for this issue

If `ISSUE_NUM` is set, search for open PRs that already reference it:

```bash
gh pr list \
  --repo "$PR_REPO" \
  --search "Fixes #${ISSUE_NUM} OR Closes #${ISSUE_NUM} OR Resolves #${ISSUE_NUM}" \
  --state open \
  --json number,url,headRefName,body
```

**If a matching PR is returned:** do not create another PR. Confirm its body contains a closing keyword for `#${ISSUE_NUM}`. If the keyword is missing, write the existing body plus `Closes #${ISSUE_NUM}` on its own line to `$ARTIFACTS_DIR/pr-body.md` and run:

```bash
gh pr edit "$PR_NUMBER" --repo "$PR_REPO" --body-file "$ARTIFACTS_DIR/pr-body.md"
```

Then write `.pr-number` / `.pr-url` and stop:

```
Existing PR found for issue #${ISSUE_NUM}: [url]
Linked with Closes #${ISSUE_NUM}. Skipping PR creation.
```

**If no matching PR** (or no issue): continue to Phase 1.

---

## Phase 1: Gather Context

### 1.1 Check Git State

```bash
git branch --show-current
git status --short
git log origin/$BASE_BRANCH..HEAD --oneline
```

### 1.2 Check for Implementation Report

Look for the most recent implementation report:

```bash
ls -t $ARTIFACTS_DIR/../reports/*-report.md 2>/dev/null | head -1
```

If found, read it to extract:
- Summary of what was implemented
- Files changed
- Validation results
- Any deviations from plan

### 1.3 Get Commit Summary

```bash
git log origin/$BASE_BRANCH..HEAD --pretty=format:"- %s"
```

---

## Phase 2: Prepare Branch

### 2.1 Ensure All Changes Committed

If uncommitted changes exist:

```bash
git status --porcelain
```

**If dirty**:

1. Stage **only** the source files that are part of this change - never `git add -A`, `git add .`, or `git add -u`. List them by name:
   ```bash
   git add path/to/file1 path/to/file2 ...
   git status --porcelain  # verify nothing else is staged
   ```
2. **Never stage** scratch / review / PR-body artifacts, even if they show up in `git status`:
   - `.pr-body.md`, `pr-body.md`, `*.scratch.md`, `*.tmp.md`
   - `review/`, `*-report.md` at the repo root
   - Anything under `$ARTIFACTS_DIR`
   - Repo-local Archon telemetry: `.archon/artifacts/`, `.archon/logs/`, `.archon/state/` (local-only — never in git)
3. Commit: `git commit -m "Final changes before PR"`

### 2.2 Push Branch

```bash
git push -u origin HEAD
```

---

## Phase 3: Create PR

### 3.1 Check for PR Template

Look for the project's PR template at `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or `docs/PULL_REQUEST_TEMPLATE.md`. Read whichever one exists.

**If template found**: Use it as the structure, fill in **every section** with details from the implementation report and commits. Don't skip sections or leave placeholders. When `ISSUE_NUM` is set, fill the template's issue-link row (`- Closes #123`). Delete unused link rows (`Related`, `Depends on`, `Supersedes`) rather than leaving `Closes #` with no number.

**If no template**, use this format:

```markdown
## Summary

[Brief description from implementation report or commits]

## Changes

[List from implementation report "Files Changed" section, or from commits]
- file1.ts - description
- file2.ts - description

## Validation

[From implementation report "Validation Results" section]
- [x] Type check passes
- [x] Lint passes
- [x] Tests pass
- [x] Build succeeds

## Testing Notes

[Any manual testing done or integration test results]

---

Closes #${ISSUE_NUM}
```

### 3.2 Determine PR Title

**Title**: Concise, imperative mood
- From implementation report summary, OR
- From commit messages

### 3.3 Link the issue in the PR body

When `ISSUE_NUM` is set, the PR body MUST contain a GitHub closing keyword (`Closes #${ISSUE_NUM}`).

- Prefer `Closes #${ISSUE_NUM}`
- Put it on its own line in the template Links section when that section exists
- Otherwise put `Closes #${ISSUE_NUM}` on its own line in the body
- Omit the line only when no related issue exists. Never write a bare `Closes #`

Always use `--body-file` so the closing keyword is not dropped.

### 3.4 Create the PR

```bash
# Write body to file to avoid shell escaping
cat > $ARTIFACTS_DIR/pr-body.md <<'EOF'
[body from above, including Closes #${ISSUE_NUM} when set]
EOF

gh pr create \
  --repo "$PR_REPO" \
  --title "[title]" \
  --body-file $ARTIFACTS_DIR/pr-body.md \
  --base "$BASE_BRANCH" \
  --head "$PR_HEAD"
```

After creating the PR, capture its identifiers for downstream steps. Only write artifacts if PR creation succeeded - never persist stale data from a pre-existing PR:

```bash
# After creating the PR, capture and persist the PR number for downstream steps
# IMPORTANT: Only write artifacts after confirmed successful PR creation
PR_NUMBER=$(gh pr list --repo "$PR_REPO" --head "$PR_HEAD" --state open --json number -q '.[0].number')
if [ -n "$PR_NUMBER" ]; then
  PR_URL=$(gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json url -q '.url')
  echo "$PR_NUMBER" > "$ARTIFACTS_DIR/.pr-number"
  echo "$PR_URL" > "$ARTIFACTS_DIR/.pr-url"
  if [ -n "$ISSUE_NUM" ]; then
    PR_BODY=$(gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json body -q .body)
    if ! printf '%s' "$PR_BODY" | grep -qiE '(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#?'"$ISSUE_NUM"; then
      echo "Closes #${ISSUE_NUM}" >> "$ARTIFACTS_DIR/pr-body.md"
      gh pr edit "$PR_NUMBER" --repo "$PR_REPO" --body-file "$ARTIFACTS_DIR/pr-body.md"
    fi
  fi
else
  echo "WARNING: Could not confirm PR creation; skipping .pr-number/.pr-url artifacts"
fi
```

**Completion:** `gh pr view` shows the live body containing `Closes #${ISSUE_NUM}` (or Fixes/Resolves) when an issue was resolved.

---

## Phase 4: Output

Report the result:

```markdown
## PR Created

**URL**: [PR URL]
**Branch**: [branch-name] → [base-branch]
**Title**: [PR title]
**Issue**: Closes #[ISSUE_NUM] — [issue url]   (or: none found after search)

### Summary
[Brief summary of what the PR contains]

### Next Steps
1. Request review if needed
2. Address any CI failures
3. Merge when approved. GitHub closes the issue when a PR with `Closes #N` merges into the repository default branch.
```

---

## Error Handling

### No Commits to Push

```
No commits between origin/$BASE_BRANCH and HEAD.
Nothing to create a PR for.
```

### Branch Already Has PR

```bash
PR_NUMBER=$(gh pr list --repo "$PR_REPO" --head "$PR_HEAD" --state open --json number -q '.[0].number')
gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json number,url,body
```

Reuse the existing PR. If `ISSUE_NUM` is set and the body has no closing keyword, patch it with `gh pr edit --repo "$PR_REPO" --body-file` as in Pre-flight.

### Push Fails

1. Check if branch exists remotely: `git ls-remote --heads origin [branch]`
2. If conflicts: `git pull --rebase origin $BASE_BRANCH` then retry push
3. If permission issues: Check GitHub access
