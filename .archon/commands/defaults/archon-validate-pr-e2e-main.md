---
description: Start Archon from main branch, use chrome-devtools-axi to reproduce the bug via E2E testing
argument-hint: (none - reads from artifacts)
---

# E2E Testing: Main Branch (Reproduce Bug)

Start Archon from the **main branch** code and use browser automation to reproduce the bug or gap described in the PR. Take screenshots as evidence.

**CRITICAL**: You MUST use `npx -y chrome-devtools-axi` for ALL browser interactions. Load the `chrome-devtools-axi` skill for the full command reference. Do not use `agent-browser`.

**CRITICAL**: You MUST clean up ALL spawned processes before finishing. Record PIDs and kill them in Phase 4.

**CRITICAL — SESSION ISOLATION**: This workflow runs in parallel with other validate-pr instances.
AXI has no `--session` flag. You MUST set `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID` on EVERY AXI command so this run gets its own bridge, port, and Chrome.
Example: `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID npx -y chrome-devtools-axi open "http://..."`
The session ID is written to `$ARTIFACTS_DIR/.browser-session` for cleanup.
Do **not** export `CHROME_DEVTOOLS_AXI_PORT` (it collapses every session onto one port).

**ABSOLUTELY FORBIDDEN — NEVER DO ANY OF THESE**:
- `taskkill //F //IM chrome.exe` or ANY variant that kills chrome by image name — this kills the USER's browser
- `taskkill //F //IM node.exe` or `taskkill //F //IM bun.exe` — this kills Claude Code, the Archon server, and all other workflows
- `pkill chrome`, `pkill node`, `pkill bun`, or any broad process-name kill
- `npx -y chrome-devtools-axi stop` without `CHROME_DEVTOOLS_AXI_SESSION=$WORKFLOW_ID` — that stops the default session, not yours, and can disturb another run using the default
- Any "kill everything" or "kill all" escalation pattern — if AXI isn't working, SKIP E2E testing and note it in your report
- If AXI fails to connect after 2 attempts, STOP trying and write your findings based on code review only

---

## Phase 1: Load Context

### 1.1 Read Artifacts

```bash
PR_NUMBER=$(cat $ARTIFACTS_DIR/.pr-number | tr -d '\n')
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')
FRONTEND_PORT=$(cat $ARTIFACTS_DIR/.frontend-port | tr -d '\n')
CANONICAL_REPO=$(cat $ARTIFACTS_DIR/.canonical-repo | tr -d '\n')
echo "PR: #$PR_NUMBER"
echo "Backend port: $BACKEND_PORT"
echo "Frontend port: $FRONTEND_PORT"
echo "Main repo: $CANONICAL_REPO"
```

### 1.2 Read PR and Test Plan

```bash
PR_NUMBER=$(cat $ARTIFACTS_DIR/.pr-number | tr -d '\n')
gh pr view "$PR_NUMBER" --json title,body
```

```bash
# Read the main branch code review for context on what to test
cat $ARTIFACTS_DIR/code-review-main.md 2>/dev/null || echo "No main branch review available yet"
```

### 1.3 Testability Classification

The testability classifier determined:
- **Decision**: $classify-testability.output.testable
- **Reasoning**: $classify-testability.output.reasoning
- **Test Plan**: $classify-testability.output.test_plan

Use the test plan above combined with the PR description and code review to build your execution plan:
- What user journeys reproduce the bug?
- What should the broken behavior look like?
- What screenshots would prove the bug exists?

---

## Phase 2: Start Archon on Main Branch

### 2.1 Create Isolated Main Branch Worktree

**IMPORTANT**: Use a dedicated worktree instead of mutating the canonical repo. This is safe
for concurrent validation runs — each gets its own isolated checkout.

```bash
CANONICAL_REPO=$(cat $ARTIFACTS_DIR/.canonical-repo | tr -d '\n')
PR_BASE=$(cat $ARTIFACTS_DIR/.pr-base | tr -d '\n')
PR_NUMBER=$(cat $ARTIFACTS_DIR/.pr-number | tr -d '\n')

# Create an isolated worktree for main branch E2E testing
MAIN_E2E_PATH="$ARTIFACTS_DIR/main-checkout"
git -C "$CANONICAL_REPO" fetch origin "$PR_BASE" --quiet
git -C "$CANONICAL_REPO" worktree add "$MAIN_E2E_PATH" "origin/$PR_BASE" --detach --quiet
echo "$MAIN_E2E_PATH" > "$ARTIFACTS_DIR/.e2e-main-worktree"
echo "Main E2E worktree at: $MAIN_E2E_PATH"
echo "Base branch: $PR_BASE @ $(git -C "$MAIN_E2E_PATH" log --oneline -1)"
```

### 2.2 Install Dependencies

```bash
MAIN_E2E_PATH=$(cat $ARTIFACTS_DIR/.e2e-main-worktree | tr -d '\n')
cd "$MAIN_E2E_PATH" && bun install --frozen-lockfile 2>/dev/null || bun install
```

### 2.3 Start Backend on Custom Port

**IMPORTANT**: Record the PID so we can kill it later. Server output is logged for debugging.

```bash
MAIN_E2E_PATH=$(cat $ARTIFACTS_DIR/.e2e-main-worktree | tr -d '\n')
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')

cd "$MAIN_E2E_PATH" && PORT=$BACKEND_PORT bun run --filter @archon/server dev > "$ARTIFACTS_DIR/.e2e-main-backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$ARTIFACTS_DIR/.e2e-main-backend-pid"
echo "Backend started with PID: $BACKEND_PID"

# Poll until healthy (max 60s)
MAX_WAIT=60
WAITED=0
until curl -sf "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Backend did not become healthy within ${MAX_WAIT}s"
    echo "Last log lines:"
    tail -20 "$ARTIFACTS_DIR/.e2e-main-backend.log" 2>/dev/null || true
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "Backend healthy after ${WAITED}s"
curl -s "http://localhost:$BACKEND_PORT/api/health" | head -c 200
echo ""
```

### 2.4 Start Frontend on Custom Port

```bash
MAIN_E2E_PATH=$(cat $ARTIFACTS_DIR/.e2e-main-worktree | tr -d '\n')
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')
FRONTEND_PORT=$(cat $ARTIFACTS_DIR/.frontend-port | tr -d '\n')

cd "$MAIN_E2E_PATH/packages/web" && PORT=$BACKEND_PORT npx vite --port $FRONTEND_PORT --host > "$ARTIFACTS_DIR/.e2e-main-frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$ARTIFACTS_DIR/.e2e-main-frontend-pid"
echo "Frontend started with PID: $FRONTEND_PID"

# Poll until serving (max 60s)
MAX_WAIT=60
WAITED=0
until curl -sf "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Frontend did not become ready within ${MAX_WAIT}s"
    echo "Last log lines:"
    tail -20 "$ARTIFACTS_DIR/.e2e-main-frontend.log" 2>/dev/null || true
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "Frontend ready after ${WAITED}s"
curl -s "http://localhost:$FRONTEND_PORT" | head -c 100
echo ""
```

### 2.5 Seed Test Data (if needed)

```bash
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')

# Check if codebases exist
CODEBASE_COUNT=$(curl -s "http://localhost:$BACKEND_PORT/api/codebases" | grep -c '"id"' || echo 0)

if [ "$CODEBASE_COUNT" -eq 0 ]; then
  MAIN_E2E_PATH=$(cat $ARTIFACTS_DIR/.e2e-main-worktree | tr -d '\n')
  curl -s -X POST "http://localhost:$BACKEND_PORT/api/codebases" \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"$MAIN_E2E_PATH\"}"
fi
```

---

## Phase 3: Browser Testing (Reproduce Bug)

### 3.1 Load the chrome-devtools-axi Skill

**YOU MUST LOAD THE CHROME-DEVTOOLS-AXI SKILL NOW.** Use `/chrome-devtools-axi` or invoke the skill. This gives you the full command reference for browser automation.

### 3.2 Core Browser Workflow

Follow this pattern for every interaction:

```bash
# 0. Isolate this run's bridge/Chrome and store the session id for cleanup
export CHROME_DEVTOOLS_AXI_SESSION="$WORKFLOW_ID"
echo "$WORKFLOW_ID" > "$ARTIFACTS_DIR/.browser-session"
axi() { npx -y chrome-devtools-axi "$@"; }

# 1. Open the Archon UI (open already returns a snapshot)
FRONTEND_PORT=$(cat $ARTIFACTS_DIR/.frontend-port | tr -d '\n')
axi open "http://localhost:$FRONTEND_PORT"

# 2. Wait for the app to load (AXI has no --load networkidle)
axi wait 2000

# 3. Refresh interactive refs (pass @g1:1 style refs exactly as printed)
axi snapshot

# 4. Take a screenshot of initial state, then Read the file
axi screenshot "$ARTIFACTS_DIR/e2e-main-01-initial.png"

# 5. Interact using refs from the latest snapshot
# axi click @g1:1
# axi fill @g1:2 "text"

# 6. Re-snapshot after DOM changes (or on STALE_REF)
# axi snapshot

# 7. Take screenshots at every significant point
# axi screenshot "$ARTIFACTS_DIR/e2e-main-02-{step}.png"
```

### 3.3 Execute Test Plan

Follow the test plan derived from the PR description and code review. For EACH test case:

1. **Set up the preconditions** — navigate to the right page, create conversations/workflows as needed
2. **Execute the reproduction steps** — exactly as described in the issue/PR
3. **Capture evidence** — screenshot BEFORE the action, DURING, and AFTER
4. **Verify the broken behavior** — confirm what you see matches the reported bug
5. **Read each screenshot** — use the Read tool to visually inspect screenshots
6. **Document what you see** — note exact error messages, visual glitches, missing elements

### 3.4 API Cross-Verification

For bugs involving data integrity or SSE, cross-reference the UI with direct API calls:

```bash
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')

# Check conversations
curl -s "http://localhost:$BACKEND_PORT/api/conversations" | head -c 500

# Check specific conversation messages
# curl -s "http://localhost:$BACKEND_PORT/api/conversations/{id}/messages"

# Check workflow runs
# curl -s "http://localhost:$BACKEND_PORT/api/workflows/runs"
```

---

## Phase 4: Cleanup and Report

**CRITICAL: You MUST complete cleanup before writing findings. Orphaned processes will accumulate and crash the system.**

### 4.1 Close Browser

```bash
# ALWAYS set CHROME_DEVTOOLS_AXI_SESSION so you only stop YOUR bridge/Chrome
CHROME_DEVTOOLS_AXI_SESSION="$WORKFLOW_ID" npx -y chrome-devtools-axi stop 2>/dev/null || true
```

### 4.2 Stop Main Branch Archon (Cross-Platform)

Kill processes by PID (recorded in Phase 2) AND by port (fallback). This works on both Windows and Unix.

```bash
BACKEND_PORT=$(cat $ARTIFACTS_DIR/.backend-port | tr -d '\n')
FRONTEND_PORT=$(cat $ARTIFACTS_DIR/.frontend-port | tr -d '\n')

# Kill by recorded PID (primary method)
for pidfile in "$ARTIFACTS_DIR/.e2e-main-backend-pid" "$ARTIFACTS_DIR/.e2e-main-frontend-pid"; do
  if [ -f "$pidfile" ]; then
    PID=$(cat "$pidfile" | tr -d '\n')
    echo "Killing PID $PID from $pidfile"
    # Try Unix kill first, then Windows taskkill
    kill "$PID" 2>/dev/null || taskkill //F //T //PID "$PID" 2>/dev/null || true
  fi
done

# Fallback: kill by port (handles child processes the PID kill might miss)
# Unix: fuser/lsof, Windows: netstat + taskkill
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
  echo "Cleaning up port $PORT..."
  # Try fuser (Linux)
  fuser -k "$PORT/tcp" 2>/dev/null || true
  # Try lsof (macOS/Linux)
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  # Try netstat (Windows - Git Bash)
  netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | sort -u | while read pid; do
    taskkill //F //T //PID "$pid" 2>/dev/null || true
  done
done

sleep 2
echo "Process cleanup complete"
```

### 4.3 Remove Main Branch Worktree

```bash
CANONICAL_REPO=$(cat $ARTIFACTS_DIR/.canonical-repo | tr -d '\n')
MAIN_E2E_PATH=$(cat "$ARTIFACTS_DIR/.e2e-main-worktree" 2>/dev/null | tr -d '\n')
if [ -n "$MAIN_E2E_PATH" ] && [ -d "$MAIN_E2E_PATH" ]; then
  echo "Removing main E2E worktree: $MAIN_E2E_PATH"
  git -C "$CANONICAL_REPO" worktree remove "$MAIN_E2E_PATH" --force 2>/dev/null || rm -rf "$MAIN_E2E_PATH"
fi
echo "Worktree cleanup complete"
```

### 4.4 Write Findings

Write to `$ARTIFACTS_DIR/e2e-main.md`:

```markdown
# E2E Test Results: Main Branch

**PR**: #{number}
**Branch**: main @ {commit}
**Backend Port**: {port}
**Frontend Port**: {port}
**Screenshots**: $ARTIFACTS_DIR/e2e-main-*.png

## Test Summary

| Test Case | Result | Evidence |
|-----------|--------|----------|
| {test 1} | BUG REPRODUCED / NOT REPRODUCED | e2e-main-{N}.png |
| {test 2} | BUG REPRODUCED / NOT REPRODUCED | e2e-main-{N}.png |

## Detailed Findings

### Test 1: {description}
**Steps**: {what was done}
**Expected**: {what should happen on a fixed version}
**Actual**: {what happened on main — the bug}
**Screenshot**: `$ARTIFACTS_DIR/e2e-main-{N}.png`

### Test 2: {description}
{Same structure...}

## Additional Issues Discovered
{Any other bugs or UX issues noticed during testing}

## Reproduction Confidence
**HIGH / MEDIUM / LOW / NOT REPRODUCIBLE**

{Explain confidence level. If not reproducible, explain what was tried.}
```

---

## Success Criteria

- **ARCHON_STARTED**: Backend and frontend running on allocated ports
- **BROWSER_TESTED**: All test cases executed with chrome-devtools-axi
- **SCREENSHOTS_TAKEN**: Evidence captured for each test case
- **BUG_ASSESSED**: Each PR claim tested on main branch
- **ARCHON_STOPPED**: Processes killed, ports freed — **VERIFY ports are free before finishing**
- **ARTIFACT_WRITTEN**: `$ARTIFACTS_DIR/e2e-main.md` created
