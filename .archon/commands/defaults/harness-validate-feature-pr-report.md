---
description: Synthesize harness-service feature-PR review + HTTP/SSE/TUI smoke into a verdict and gh pr comment; no develop/base comparison
argument-hint: (none - reads from artifacts)
---

# Feature PR Validation Report

Synthesize code review and live smoke on **this checkout only**. Do not require a bug on develop/base. Do not write a main-vs-feature table.

**Classifier:**

- `http_sse`: $classify-testability.output.http_sse
- `tui`: $classify-testability.output.tui

If either interpolated field is empty, `classify-testability` did not emit
structured output (schema rejection, skipped node, or failed node). Treat that
as **CLASSIFY_FAILED**: do not APPROVE; verdict **NEEDS_DISCUSSION** and say
the classifier output was missing. Do not invent `http_sse`/`tui`/`http_requests`.

---

## Phase 1: Gather artifacts

```bash
ls -la "$ARTIFACTS_DIR/"
cat "$ARTIFACTS_DIR/code-review.md"
cat "$ARTIFACTS_DIR/runtime-http.md" 2>/dev/null || echo "HTTP RUNTIME NOT AVAILABLE"
cat "$ARTIFACTS_DIR/http-plan-results.md" 2>/dev/null || true
cat "$ARTIFACTS_DIR/runtime-tui.md" 2>/dev/null || echo "TUI RUNTIME NOT AVAILABLE (expected when tui==no)"
cat "$ARTIFACTS_DIR/.http-status" 2>/dev/null || true
cat "$ARTIFACTS_DIR/sqlite-migrations.txt" 2>/dev/null || true
cat "$ARTIFACTS_DIR/sync-manifest-check.md" 2>/dev/null || echo "SYNC_MANIFEST_NA"
```

Missing `runtime-http.md` means `http_sse == no` or the node was skipped. When `http_sse == yes`, APPROVE requires `.http-status` / `runtime-http.md` to contain **both** `HTTP_SSE_EXERCISED` and `HTTP_PLAN_EXERCISED`. `HTTP_PLAN_EXERCISED` means every feature case matched `expect_status` (or `expect_statuses`) **and** a body `invariant`, including at least one live 2xx. Any 2xx–5xx that does not match the declared status, or a 4xx/5xx without a body invariant, is `HTTP_PLAN_FAILED` — reaching an error handler is not proof. Baseline without the plan token **cannot APPROVE**. Missing `runtime-tui.md` means `tui == no`. Do not invent runtime results.

```bash
PR_NUMBER=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-number")
PR_REPO=$(tr -d '\n' < "$ARTIFACTS_DIR/.pr-repo")
gh pr view "$PR_NUMBER" --repo "$PR_REPO" --json title,body,url,headRefName,baseRefName,additions,deletions,changedFiles
```

---

## Phase 2: Cross-reference claims

For each claim in the PR title/body (treated as **feature requirements**, not as a bug to reproduce on base):

| Claim | Code map (YES/PARTIAL/NO) | HTTP/SSE | TUI |
|-------|---------------------------|----------|-----|
| {claim} | from code-review.md | exercised / skipped / failed / n/a | exercised / skipped / failed / n/a |

HTTP/SSE column is `n/a` when `http_sse == no`. TUI column is `n/a` when `tui == no`.
HTTP/SSE `exercised` means that claim's row in the Feature requests table is `pass` with matching status + body invariant. A 400/503 that was not declared, or a declared error without a body invariant, is `failed`, not exercised.

`resolve-paths` aborted the run if SHA mismatched, so all evidence here is from the PR head.

---

## Phase 3: Verdict

**APPROVE requires all of:**

| Criteria | Required for APPROVE |
|----------|---------------------|
| Claimed behavior implemented in code | Yes |
| If `http_sse == yes`: isolated `chat.db` migrated AND `/health`+`/ready` AND session/stream baseline **AND** typed `http_requests` whose live status matches `expect_status`/`expect_statuses` and `invariant` (at least one 2xx). `HTTP_PLAN_FAILED` or missing plan token **cannot APPROVE** | Yes, both tokens in one runtime-http artifact |
| If `tui == yes`: tui-test passed baseline AND the feature-specific assertions `runtime-tui` derived from the PR/checkout in that same node (NOT-COVERED empty). `TUI_FAILED` or `TUI_TOOLING_FAILED` means the required TUI evidence is missing — verdict cannot be APPROVE | Yes, mandatory |
| No CRITICAL/HIGH correctness issues | Yes |
| AGENTS.md focused-test policy not violated | Yes |
| If the PR changed an `upstream-sync/commits/*.json`: `sync-manifest-check.md` first line is NOT `SYNC_MANIFEST_INCONSISTENT` (deterministic bookkeeping gate). `SYNC_MANIFEST_INCONSISTENT` **cannot APPROVE**; `SYNC_MANIFEST_CONSISTENT`/`SYNC_MANIFEST_NA` do not block | Yes, mandatory |

**Forbidden as APPROVE requirements:** “Bug confirmed on develop/base”, “Fix addresses root cause”, any main-vs-feature table.

If `http_sse == yes` but HTTP status is `MIGRATE_OR_STORE_FAILED` or `MIGRATIONS_INCOMPLETE`: **REQUEST_CHANGES** (ready without migrations is not proof). If HTTP status is `HARNESS_ENV_FAILED` (harness environment, e.g. socket path length — not a PR defect): **NEEDS_DISCUSSION**, never APPROVE.

If both classifier flags are `no` and review has no CRITICAL/HIGH and claims are YES: **APPROVE** (review-only).

Otherwise — including `http_sse == yes` without both `HTTP_SSE_EXERCISED` and `HTTP_PLAN_EXERCISED` in `.http-status`, `tui == yes` with `TUI_FAILED` or `TUI_TOOLING_FAILED`, and `sync-manifest-check.md` whose first line is `SYNC_MANIFEST_INCONSISTENT`: **REQUEST_CHANGES** or **NEEDS_DISCUSSION**. Never APPROVE. When the token is `SYNC_MANIFEST_INCONSISTENT` the verdict is **REQUEST_CHANGES** and the report Notes MUST quote the offending numbers from `sync-manifest-check.md`.

---

## Phase 4: Write `$ARTIFACTS_DIR/validation-report.md`

```markdown
# Harness Feature PR Validation Report

**PR**: #{number} — {title}
**URL**: {url}
**Verdict**: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION

## Claim coverage

| Claim | Code | HTTP/SSE | TUI |
|-------|------|----------|-----|
| {claim} | YES/PARTIAL/NO | ... | ... |

## Code review

- Overall score: {n}/5
- CRITICAL/HIGH: {list or none}
- AGENTS.md focused tests: PASS/FAIL

## Runtime

- HTTP/SSE (one bash lifetime): {status or skipped}
- SQLite migrations: {MAX versions or n/a}
- TUI: {status or skipped}

## Notes

{migrate failure, tooling, skipped surfaces}

## Verdict rationale

{2-4 sentences: claimed feature present and exercised on this checkout, or why not.}
```

---

## Phase 5: Always comment on the PR

Always `gh pr comment`, even for review-only or REQUEST_CHANGES.

Header **exactly**: `## Harness Feature PR Validation Report`

Footer **exactly**: `_Validated by harness-validate-feature-pr workflow_`

```bash
gh pr comment "$PR_NUMBER" --repo "$PR_REPO" --body-file "$ARTIFACTS_DIR/validation-report.md"
```

If the body file lacks the header/footer, prepend/append them before posting. Do not mention dual-branch bugfix success tokens or a main-vs-feature review split.

---

## Success Criteria

- **VERDICT_WRITTEN**: `$ARTIFACTS_DIR/validation-report.md`
- **PR_COMMENTED**: `gh pr comment` succeeded
- Verdict uses only feature-checkout evidence
