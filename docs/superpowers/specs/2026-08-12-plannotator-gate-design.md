# Plannotator Gate — Design Spec

**Date:** 2026-08-12  
**Status:** Draft for review  
**Context:** Speckit SDD workflow human-review surfaces (`clarify-gate`, `red-team-gate`) in `archon-speckit-feature.yaml`

## Problem

In `archon-speckit-feature`, `clarify-explain` (and `red-team-explain`) generate an interactive HTML explainer via Plannotator (`plannotator-visual-explainer` → `plannotator annotate`). Goals:

1. User reads what changed in a browser UI.
2. User asks AI **on that surface** (Plannotator built-in Ask AI — not a separate Archon chat session).
3. User approves when satisfied so the workflow continues (`clarify-apply` / `red-team-apply`).

Today these concerns are split badly:

| Step | What happens |
|------|----------------|
| `clarify-explain` | Agent opens Plannotator; HTTP server is **process-bound** to the annotate CLI / agent turn |
| Node completes | Plannotator **stops** (`waitForDecision` → `stopServer` → process exit) — **stock lifecycle** |
| `clarify-gate` | Separate Archon `approval:` pause; durable in DB; approve via CLI/Web/chat |

Result: the review website dies when the explain node ends; the durable gate has no live Plannotator surface (no Ask AI). User must open a manual session to discuss the artifact.

## Goals

- **Archon is gate of record** — durable pause; multi-surface approve/reject/abandon.
- **Plannotator is review surface** — stock annotate UI: read HTML, annotate, Ask AI, `--gate` decisions.
- **Default Plannotator lifecycle unchanged** — without new flags, every terminal decision still ends the process.
- **Opt-in Plannotator flag for team interact** — Close must not kill the shared live session (see below).
- **Do not fatten existing `approval:` node** — new node type for this concern.
- **Document path from previous node output** — plain path string (not hard-coded `$ARTIFACTS_DIR/...html`).
- **Send Annotations** triggers in-place rework agent while still paused, regenerates HTML, re-opens annotate (session ends, then new spawn).
- **Interactive team review** uses the **live** annotate server (not URL snapshot share).

## Non-goals

- Using Plannotator **Share** (`share.plannotator.ai` hash/paste) as the team interaction path — that is a **static snapshot**, not a live session (no live Ask AI / gate APIs).
- Building a custom multi-user Ask AI UI in Archon.
- Changing semantics of existing `approval:` nodes.
- Generic multi-vendor `review_gate` registry (YAGNI until a second surface exists).
- Strict `output_format` JSON schema on the producer (path-only prompt contract is enough for v1).
- `on_reject` / auto-reopen-on-dismiss / abandon-on-dismiss policies beyond MVP.
- Making **Send Annotations** keep the session alive (deferred; v1 still ends session).

## Locked decisions

| # | Decision |
|---|----------|
| 1 | Archon = gate of record |
| 2 | New node type `plannotator_gate` (not optional fields on `approval`) |
| 3 | Engine **supervisor loop** owns Plannotator spawn while paused (Approach 1) |
| 4 | Archon spawns: `plannotator annotate <path> --gate --json --persist-session` (flag name may be bikeshed; behavior fixed below) |
| 5 | `document` resolves from prior node; **entire `$prev.output` = one path string** (contract B) |
| 6 | Approve → end Plannotator session (stock) → `approveWorkflow` |
| 7 | Send Annotations → end Plannotator session (stock) → rework agent (still paused) → new path → annotate again with same flags |
| 8 | **Close with `--persist-session`** → does **not** resolve decision / does **not** stop server; Archon stays `WAITING_DECISION`; teammates can keep using the live URL |
| 9 | **Close without flag** (stock) → `dismissed` + stop server; Archon phase idle; `review-open` re-spawns |
| 10 | External Archon approve/reject/abandon wins over in-flight annotate (kill child) |
| 11 | Wire speckit clarify-gate (and red-team-gate if cheap in same change) |
| 12 | Plannotator change is **additive only**: default CLI/hook behavior unchanged when flag omitted |

---

## Plannotator: `--persist-session` (team interact)

### Problem

Team needs **live** interaction (annotate + Ask AI) on a shared review URL. Stock **Close** calls `/api/exit` → `resolveDecision({ exit: true })` → `stopServer()`, so one person's Close kills the session for everyone on that process.

Plannotator **Share** (Export → Copy Link → `share.plannotator.ai`) is a **compressed snapshot** (URL hash / encrypted paste). It is **not** connected to the live annotate server. Suitable for async read/import, **not** for co-interactive gate review.

### Solution (upstream Plannotator, small PR)

Add an opt-in CLI/server flag (working name **`--persist-session`**):

| Action | Default (no flag) | With `--persist-session` |
|--------|-------------------|---------------------------|
| **Close / Exit UI** | `dismissed` + stop server | **No** `resolveDecision`; **no** `stopServer`; client leaves; process stays up |
| **Approve** | `approved` + stop | **Unchanged** — approved + stop |
| **Send Annotations** | `annotated` + stop | **Unchanged** — annotated + stop (Archon rework then re-spawns) |
| Close browser tab (X) | Usually does not stop server | Same |

Implementation touchpoints (Plannotator repo):

1. CLI parse flag → `startAnnotateServer({ persistSession: true })` (and plan/review if ever needed; **MVP: annotate only**).
2. `/api/exit`: if `persistSession`, return `{ ok: true, keptAlive: true }` without resolving the decision promise.
3. UI Close path: respect server response (no “session ended” completion overlay that implies process death).
4. Tests: close with flag does not resolve `waitForDecision`; approve/annotate still do.
5. Docs: flag + team guidance (“prefer Close over killing the shared process; only the owner should Approve / Send Annotations”).

### Archon coupling

- `plannotator_gate` **always** passes `--persist-session` when spawning annotate for interactive gates.
- Supervisor still owns process lifetime: kill child on Archon approve/reject/abandon, after annotated decision, and on timeout if added later.
- With flag, **Close no longer produces `dismissed` JSON** → supervisor does **not** enter idle-on-dismiss from Close. Session stays in `WAITING_DECISION` until Approve, Annotations, external Archon action, or process death.
- `review-open` remains for crash recovery / process death / stock dismiss path if flag ever omitted.

### Team model (v1)

- One **canonical live** annotate process per gate open (shared URL / port / tunnel).
- Multiple browsers may attach for annotate + Ask AI.
- **Owner** (or designated decider) clicks **Approve** or **Send Annotations**.
- Teammates use **Close** (with flag) or close the tab — must not click Approve unless authorized.
- Do **not** treat Share snapshot as the interactive collab path.

---

## Architecture

```
┌──────────────────┐     stdout = "/abs/path/to/file.html"
│ producer node    │ ──────────────────────────────────────┐
│ (e.g. explain)   │     plain path string (contract B)    │
└──────────────────┘                                       │
                                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ plannotator_gate node                                           │
│  document: "$producer.output"                                   │
│                                                                 │
│  1. resolve + validate path                                     │
│  2. pauseWorkflowRun (reuse approval store/API machinery)       │
│  3. SUPERVISOR LOOP:                                            │
│       spawn: plannotator annotate <path> \                      │
│              --gate --json --persist-session                    │
│       approved  → approveWorkflow → complete node → resume DAG  │
│       annotated → rework agent → path string → loop             │
│       Close (persist) → no decision; keep WAITING_DECISION      │
│       process death / stock dismiss → idle + review-open        │
└─────────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
  Live Plannotator session               Archon rework agent
  (Ask AI, annotate; team share URL)     (while run paused)
```

### Components

| Component | Responsibility |
|-----------|----------------|
| YAML `plannotator_gate` | Declarative config: document, message, rework, capture_response |
| Executor handler | Validate path, pause, supervisor loop, map decisions |
| Pause/approve core (existing) | Durable status; CLI/Web/chat approve/reject/abandon |
| Plannotator CLI (external) | UI + Ask AI + gate JSON stdout |
| Rework agent | Apply annotations; print next HTML path (contract B) |
| `review-open` CLI/API | Re-spawn annotate when idle after dismiss/crash |

### Why not extend `approval:`

- Different concern: human pause vs review-surface loop + rework.
- Avoid regression on every existing approval gate.
- Keeps vendor-specific fields off the core approval surface.
- Internally **reuses** the same pause/approve store and HTTP/CLI paths.

### Why not Plannotator-as-gate-of-record

- Process death loses the gate; contradicts durable Archon pause and multi-surface approve.

---

## YAML schema

```yaml
- id: clarify-gate
  depends_on: [clarify-explain]
  plannotator_gate:
    document: "$clarify-explain.output"   # required — path string after substitution
    message: |                            # optional — shown when paused
      Review the explainer in Plannotator. Approve when satisfied.
    capture_response: true                # optional — default false
    on_dismiss: stay_paused               # MVP only; fixed policy
    rework:
      prompt: |                           # required
        HTML path: $REVIEW_DOCUMENT
        Annotations:
        $REVIEW_ANNOTATIONS
        # ... apply feedback, regenerate HTML under $ARTIFACTS_DIR ...
        # Print ONLY the absolute path to the next HTML file.
      provider: claude                    # optional
      model: sonnet                       # optional
      effort: medium                      # optional
```

### Load-time validation

- `plannotator_gate.document` non-empty string.
- `plannotator_gate.rework.prompt` required.
- `$node.output` refs in `document` validated like other DAG refs.
- Follow engine unknown-key strip/warn policy.

### Runtime document resolution (contract B)

1. Substitute workflow variables and `$node.output` refs.
2. `trim`; take **first non-empty line** if multi-line (rest ignored; optional warn).
3. Resolve relative paths against workflow `cwd`.
4. Fail if empty, missing file, or unreadable.
5. Optional: fail if path escapes cwd / artifacts root.
6. Optional warn if not `.html`/`.htm`.

Same rules apply to **rework agent stdout**.

---

## Supervisor variables

| Variable | When | Content |
|----------|------|---------|
| `$REVIEW_DOCUMENT` | Annotate spawn + rework | Current HTML path |
| `$REVIEW_ANNOTATIONS` | Rework only | Markdown feedback from Plannotator annotated decision |
| Gate node `$id.output` | After approve if `capture_response` | Optional approve notes |

---

## Decision mapping

Invoke each open:

```text
plannotator annotate "$REVIEW_DOCUMENT" --gate --json --persist-session
```

Parse one-line JSON from stdout when the process **exits** (Approve / Send Annotations). Close with `--persist-session` does **not** exit the process and emits **no** decision line.

| Plannotator | Process / JSON | Supervisor | Archon run |
|-------------|----------------|------------|------------|
| Approve | exit + `approved` (+ optional `feedback`) | `approveWorkflow(runId, notes?)` → complete node | paused → resume DAG |
| Send Annotations | exit + `annotated` + `feedback` | Rework agent; update path; loop (re-spawn with same flags) | **still paused** |
| Close + `--persist-session` | **no exit**, no JSON | Keep waiting on same child | **still paused**, still `WAITING_DECISION` |
| Close **without** flag (stock) | exit + `dismissed` | Phase idle; `review-open` to re-spawn | **still paused** |

### Parallel Archon surfaces

| Action | Behavior |
|--------|----------|
| approve (CLI/Web/chat) | Same as Plannotator Approve; kill in-flight annotate child; idempotent complete |
| reject | Kill child; reject/fail gate per existing approval reject semantics (MVP: no plannotator-specific on_reject) |
| abandon | Kill child; cancel run |
| `review-open` | Only if paused at `plannotator_gate` and phase idle (or equivalent); spawn annotate on metadata document |

### Race: external approve while browser open

1. `approveWorkflow` succeeds.
2. Supervisor observes status / abort signal.
3. Kill annotate child; do not double-complete node.

---

## State machine

```
enter node
  → resolve + validate document
  → preflight: plannotator binary available (fail before pause if missing)
  → pauseWorkflowRun(metadata.approval = PlannotatorGateContext)
  → OPENING → spawn annotate (--persist-session)
  → WAITING_DECISION  (child may stay up across teammate Close)
       ├ approved (child exit or Archon) → COMPLETED
       ├ annotated (child exit) → REWORKING → validate path → OPENING
       ├ Close with persist → no transition (still WAITING_DECISION)
       └ child crash / stock dismissed → IDLE
            ├ review-open → OPENING
            ├ Archon approve → COMPLETED
            └ reject/abandon → TERMINAL
```

### `PlannotatorGateContext` (metadata sketch)

```ts
{
  type: 'plannotator_gate',
  nodeId: string,
  message: string,
  document: string,
  captureResponse?: boolean,
  phase: 'opening' | 'waiting_decision' | 'reworking' | 'idle',
  lastDecision?: 'approved' | 'annotated' | 'dismissed',
  annotatePid?: number, // best-effort
}
```

Use a distinct `type` so existing `approval` handlers do not mis-handle context; share approve/resume paths where type-agnostic.

---

## Error handling

| Failure | Behavior |
|---------|----------|
| Invalid producer path | Fail node before or at start (clear error); prefer fail before pause when possible |
| Missing `plannotator` binary | Preflight fail with install hint |
| Annotate crash / no JSON / gate exit 2 | Stay paused; phase idle; user can review-open or approve/reject via Archon |
| Rework fails / empty / bad path | Stay paused; error event; do not approve |
| Concurrent external approve | Approve wins; kill child; single complete |

### Crash recovery (process boundaries)

- Do **not** autonomously mark paused runs failed based on staleness (Archon principle).
- Server/CLI death leaves run **paused**; annotate child may orphan (OS reaps).
- Recovery: `review-open` uses saved `document`; or approve/reject/abandon via Archon.
- Rework incomplete: keep previous document path until rework succeeds.

---

## Observability events (suggested)

| Event | Meaning |
|-------|---------|
| `approval_pending` / existing pause events | Reuse; include `surface: plannotator_gate` when possible |
| `review_surface_opened` | document path; url/port best-effort |
| `review_surface_decision` | approved \| annotated \| dismissed |
| `review_rework_started` / `review_rework_completed` | duration; new path |
| `review_surface_idle` | after dismiss |

Do not log full annotation bodies at info level.

---

## Workflow migration (`archon-speckit-feature`)

### Flow

```
clarify-respond → clarify-explain → clarify-gate (plannotator_gate) → clarify-apply
```

Same pattern for red-team explain/gate when included.

### `clarify-explain` producer contract

1. Generate explainer (visual-explainer skill as today).
2. Persist final HTML under `$ARTIFACTS_DIR` (stable path).
3. **Final model/stdout output: only the absolute path** to that file (contract B).
4. Do **not** use the explain node's annotate session as the human gate (that dies with the node).

### Example gate node

```yaml
- id: clarify-gate
  depends_on: [clarify-explain]
  plannotator_gate:
    document: "$clarify-explain.output"
    message: |
      Drafted answers + explainer are ready. Review in Plannotator
      (Ask AI / annotations). Approve when satisfied.
      Next step: `$speckit-clarifybatch --apply`.
    capture_response: true
    rework:
      prompt: |
        Human annotations on the clarification explainer follow.
        Two kinds: (1) content change → edit source MD + regenerate HTML;
        (2) visual clarify/explain → HTML only, do not edit source MD.
        Source of truth: <feature_directory>/clarification-questions.md (not under visual/).
        HTML path: $REVIEW_DOCUMENT
        Annotations:
        $REVIEW_ANNOTATIONS
        Print ONLY the absolute path to the HTML for the next review.
```

Ensure workflow `interactive: true` if web foreground is required for human gates (existing Archon pattern).

---

## CLI / API additions (MVP)

```text
archon workflow review-open <run-id>
POST /api/workflows/runs/{runId}/review-open
```

- Run must be `paused` at a `plannotator_gate` node.
- Spawns annotate on `metadata.approval.document`.
- Returns URL if known / ok.

Approve/reject/abandon remain existing commands and routes.

---

## Testing

### Unit

- Schema accept/reject (missing document / rework.prompt).
- Path parse (trim, first line, empty).
- Decision JSON parse (approved / annotated / dismissed).
- Malformed stdout → no false approve.
- Variable substitution for `$REVIEW_*`.

### Integration (mock Plannotator + AI)

- Approve via child JSON → gate complete, downstream runs.
- Approve via API while child running → child killed, single complete.
- Annotated → rework → second annotate; still paused until approve.
- Rework bad path → stay paused.
- Dismiss → idle → review-open → annotate again.
- Abandon mid-loop → child killed, cancelled.
- Missing binary preflight.
- Producer missing file.

### Regression

- Existing `approval:` tests unchanged in behavior.
- Workflow validate loads updated defaults.

### Manual smoke

1. Mini workflow: write sample HTML path → plannotator_gate → echo done.
2. Ask AI in browser; Approve resumes.
3. Annotations rework updates HTML; new session.
4. Close → review-open.
5. Approve via CLI with Plannotator still open.

---

## Success criteria

- [ ] User reviews clarify explainer in Plannotator with Ask AI without keeping the explain agent node open.
- [ ] Approve (Plannotator or Archon) advances to apply step.
- [ ] Annotations rework without leaving durable pause (session ends on annotations, then re-spawns).
- [ ] With `--persist-session`, Close does not kill the locally supervised live server.
- [ ] Without the flag, Plannotator stock lifecycle is unchanged.
- [ ] Default hooks/CLI without the flag keep existing behavior.
- [ ] Existing Archon `approval:` nodes unaffected.

---

## Implementation sketch (not a plan)

Ordered work packages for a later implementation plan:

1. **Plannotator (upstream/fork):** `--persist-session` + tests + docs.
2. **Archon schema:** `plannotator_gate` + loader/type guards.
3. **Archon executor:** pause context type, supervisor loop, spawn with flag, child management.
4. Rework agent invocation via existing AI deps.
5. review-open CLI + API (crash / stock dismiss recovery).
6. Unit/integration tests (both repos as applicable).
7. Update `archon-speckit-feature` (and red-team pair); bundled defaults regenerate if applicable.
8. Docs: node reference and SDD recipe; remote sharing remains deferred pending an upstream machine-readable URL contract plus Archon authentication and exposure design.

## 2026-08-13 stabilization correction

`gateId` is the logical process owner for a `plannotator_gate` supervisor instance.
Normal Plannotator approval is supervisor-owned: the live supervisor resolves the gate and owns workflow continuation after the child reports approval.
`review-open` is an explicit takeover that replaces the current owner by rotating `gateId` before starting a replacement supervisor.
Generic Archon approve must not auto-resume this gate type, because an external approval records the decision but must not start a second executor while the live supervisor may still own continuation.

The v1 guarantee is that Archon launches and supervises a local Plannotator session.
Remote sharing is deferred until Plannotator provides a stable machine-readable URL contract and Archon has an authentication and exposure design for that surface.

---

## Open follow-ups (explicitly deferred)

- `on_dismiss: auto_reopen`.
- `on_reject` prompt path for plannotator_gate.
- Generic `review_gate` + `surface:` enum.
- Strict producer `output_format` enforcement.
- Capturing live annotate URL into run metadata for remote/tunnel users.
- Send Annotations **without** ending session (hot-reload document) — rejected for v1 (decision A).
- True multi-decider (anyone Approve) conflict rules.
- Upstream: exact flag spelling if Plannotator maintainers prefer another name (`--keep-alive`, etc.).

---

## References

- Workflow: `.archon/workflows/defaults/archon-speckit-feature.yaml`
- Archon: `executeApprovalNode`, `pauseWorkflowRun`, `approveWorkflow`, `POST /api/workflows/runs/{runId}/approve`
- Plannotator: `packages/server/annotate.ts` (`/api/exit`, `/api/approve`, `/api/feedback`), `apps/hook/server/annotate-command.ts`, docs `commands/annotate.md`, `guides/ai-features.md`, `guides/annotate-gates-and-json-responses.md`
- Plannotator Share (not interactive collab): docs `guides/sharing-and-collaboration.md`, `packages/ui/hooks/useSharing.ts`, `packages/server/share-url.ts`
- Ask AI: native sidebar + selection Ask AI; `/api/ai/query`; disabled via `PLANNOTATOR_AI=disabled`
