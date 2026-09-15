---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments:
  - ../../specs/spec-agent-node-room/SPEC.md
  - ../../specs/spec-agent-node-room/tool-presentation-contract.md
  - ../../specs/spec-agent-node-room/todo-fold-contract.md
  - ../../specs/spec-agent-node-room/test-plan.md
  - ../../specs/spec-agent-node-room/engine-integration.md
  - ../../specs/spec-agent-node-room/provider-steering-matrix.md
  - ../../specs/spec-agent-node-room/control-states.md
  - ../ux-designs/ux-Archon-2026-09-09/DESIGN.md
  - ../ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md
  - ../architecture/architecture-Archon-2026-09-12/ARCHITECTURE-SPINE.md
  - ../architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
mockup: ../../../claude-design/design_handoff_node_room_transcript_steering/
---

# Archon — Agent Node Room — Epic Breakdown

## Overview

Decomposes `spec-agent-node-room` (13 capabilities) into implementable stories for the agent node view on both web surfaces. The spec has two halves with different risk and release cadence; they are **one epic** ("Agent Node Room", **owner decision 2026-09-13** — one epic, not two) with the halves sequenced inside it — read first, steering after:

- **Read half — Readable Agent Transcript** (CAP-1…7, Stories 1.1–1.6): replace the raw-JSON tool rows with a scannable transcript. **Retroactive** — a pure function of data already in the database, no schema/migration/backend change, so it improves every historical run the moment it ships. **Ships first.**
- **Steering half — Live Agent Steering** (CAP-8…13, Stories 1.7–1.13): send + interrupt a live agent without stopping the node. In-process, no durable state, but reaches only a node whose executor is in this process; parts are spike-gated (soft-inject) or SDK-bump-gated (`delivered`).

**One internal ordering dependency between the halves:** the operator row (CAP-11, Story 1.11) writes a new item kind into the transcript, so the renderer must recognize `origin='operator'` **before** CAP-11 ships (Story 1.1 carries that reader hook; Story 1.11 depends on it).

**Design references (mockup handoff)** — `claude-design/design_handoff_node_room_transcript_steering/`, four HTML screens, high-fidelity, recreate with existing tokens (Legacy hue 260 `packages/web/src/index.css`; Console hue 265 `experiments/console/theme.css`), **not** the literal values:

- **Transcript States** → read half (transcript rows + expanded bodies)
- **Console Node Room** / **Legacy Node Room** → both halves (full-panel context on each surface)
- **Steering Dock States** → steering half (composer dock across agent sub-states)

The contracts win over the mockup on any conflict; the two UX spines (`DESIGN.md` visual, `EXPERIENCE.md` behavioral) are the authoritative design contract. Two mockup elements — a **pinned todo strip** and a **loop iteration selector** — were confirmed **in scope** (owner decision, 2026-09-13) and folded into the success of CAP-3 and CAP-6 respectively; they are firm requirements, not deferred.

**Surfaces & boundaries:** Legacy `packages/web/src/components/workflows/`, Console `packages/web/src/experiments/console/`, shared render-neutral logic `packages/web/src/lib/`. `@archon/web` must not import `@archon/workflows`; Console must not import from `@/components/`; both node rooms ship together (owner decision), JSX written twice.

## Requirements Inventory

### Functional Requirements

FR1 (CAP-1): Render each tool call as one scannable row — family chip, status glyph, headline naming the salient argument, right-aligned badges; successful calls collapsed on first render, failed calls expanded; no serialized-data punctuation on a collapsed row.
FR2 (CAP-2): Expand a call into a body shaped for its family per `tool-presentation-contract.md`; a tool matching no family renders ≤3 scalar `key: value` pairs (`{…}`/`[n]` for objects/arrays), never a JSON dump; generic fallback <2% of rows.
FR3 (CAP-3): Render the agent's todo list as folded `TodoPhase[]` state (phases + per-item status), once, anchored at the last todo call; earlier todo calls collapse; an `rm`-emptied phase disappears; plus a **pinned todo strip** at the top of the transcript mirroring the same state, visible while scrolling, absent when no todos (UX-DR9).
FR4 (CAP-4): Render a subagent dispatch as batch context (markdown) + one collapsible card per subtask, naming the subtask and its agent (normalized to `TaskSubtask[]`).
FR5 (CAP-5): Render an inline line diff for a file edit when the payload carries before+after; else path + preview; never fabricate a diff from one side.
FR6 (CAP-6): Group rows by `occurrence_id` with a per-group header when a node spans >1; render none when a single occurrence; group on `occurrence_id`, never `attempt_id`; plus a **loop-iteration selector** to navigate between groups (headers stay the anchors), absent on single-occurrence (UX-DR10).
FR7 (CAP-7): Every card exposes a Raw toggle revealing the original JSON, closed by default — the only place serialized JSON appears; preserve today's `canLoadFullOutput` flow.
FR8 (CAP-8): Composer mounted + enabled while the node runs; send reads `Queue`; sending holds the message (node untouched, nothing interrupted/lost), delivered as the next turn at the natural boundary; the queue is stated per-tab.
FR9 (CAP-9): An interrupt control ends the agent's current turn (claude `interrupt()` or stream-abort); the provider session stays alive; the node stays `running` (agent → `idle-after-interrupt`), never paused/pending/`node_failed`; the in-flight tool call shows `interrupted`, not `failed`; distinct from Cancel; nothing implies the interrupt undid written work.
FR10 (CAP-10): When `idle-after-interrupt`, send reads `Send now`; delivers every queued message + the one just typed, in written order, as the next turn on the same session; the node continues (never "resumes"). Controls follow the projected sub-state.
FR11 (CAP-11): Operator messages + the interrupted tool call appear as ordinary transcript rows in happened-order (between the call interrupted and the one caused); an operator row is visibly the operator's, never mistakable for agent text.
FR12 (CAP-12): Sending is an ordinary prompt; `Queue` (every provider) delivers at the boundary; soft-inject (claude streaming input) delivers mid-turn with no interrupt where transport allows — spike-gated; v1 floor = interrupt + Queue.
FR13 (CAP-13): A message reads `sent` until the provider echoes the stamped id → `delivered`; correlation by id alone; claude-only and needs SDK ≥ 0.3.246; at pin 0.3.209 all stay `sent`.

### NonFunctional Requirements

NFR1: The read half ships **no** schema change, migration, or backend change — retroactive on historical runs.
NFR2: Status is decodable **without colour** — a glyph character carries it; colour only reinforces.
NFR3: No raw `JSON.stringify` as a default presentation anywhere in the transcript; it survives only behind CAP-7's Raw toggle.
NFR4: The steering half is **in-process only**; no durable steering state; a server restart drops the live session and any in-flight steer, and the run resumes normally.
NFR5: An interrupt never fails the node; steering never trips the node-level abort check (`dag-executor.ts:3124`), which stays Cancel-only.
NFR6: The 30-minute idle-await fail is an **inactivity** timer, re-armed by a composing keepalive (WCAG SC 2.2.1); the 30-minute value is fixed; resuming a failed node re-runs with a fresh session.
NFR7: Strict TypeScript, no unjustified `any`, ESLint at zero warnings; `bun run validate` is the pre-PR gate.
NFR8: Accessibility floor WCAG 2.2 AA per `EXPERIENCE.md` — SC 1.4.1 (colour-free status), SC 4.1.3 (status messages: serialized composite announcements, delivery-failure assertive), SC 2.2.1 (timing), `aria-disabled` never the native `disabled` attribute, contrast floors per `DESIGN.md`.

### Additional Requirements

- `@archon/web` must not import `@archon/workflows`; wire types come from `api.generated.d.ts` through `lib/api.ts`. Console must not import from `@/components/`; shared logic in `packages/web/src/lib/`, JSX written twice, thin.
- The tool presenter is one pure, React-free module `packages/web/src/lib/tool-presentation.ts`; resolver = four tiers, duck-type over alias sets, **exact-token** match (never substring), provider shapes normalized at the edge; strip the Codex `/bin/*sh -lc '…'` wrapper; MCP `mcp__server__tool` → `generic` label `server · tool`.
- CAP-5 needs a new `packages/web/src/lib/diff-hunks.ts` (jsdiff `structuredPatch`, bounded `maxEditLength`, memoized) → `GitDiffHunk` → `react-diff-view` via the existing `git-hunk-adapter.ts`.
- Interrupt uses a **fresh per-turn** `AbortSignal.any([nodeAbortController.signal, perTurnSignal])`, never the one-shot `nodeAbortController` (`:2209`/`:2223`); `operatorInterrupt` is a per-turn flag resolved by **placement** (`canReask :3032` also stops on it; branch after the `:3124` Cancel check; reset at turn N+1; `result` at `:2533` is the natural-end discriminator).
- Multi-turn on one session reuses the `attemptResumeId` re-ask seam (`:2290`); codex re-runs the resumed thread (`resumeThread`, `providers/src/codex/provider.ts:1006`).
- In-process registry keyed `(runId, nodeId)`; `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt` under `resolveAuthContext` (HITL/AD-7). Operator row = ordinary `text` row + three additive `.strict()` metadata fields (`origin`, `operator_user_id`, `message_id`) + regenerated `api.generated` — **no migration**; executor is the sole writer; reconcile `sent` ids on the node's terminal event only.

### UX Design Requirements

UX-DR1 (CAP-1): Collapsed row anatomy — chevron `▸/▾`, status glyph, family chip, headline (middle-elide for `path`, end-elide for text; `min-width:0` in the flex row), right-aligned non-wrapping badges (duration, exit code, `+n −m`, match count). _Mockup: Transcript States; `DESIGN.md` Components; `EXPERIENCE.md` State Patterns._
UX-DR2 (CAP-1/CAP-9): Five status glyphs `✓ ✕ ◐ ⚠ –`, colour-free; `⚠` interrupted is its own character, never a recoloured `✕`.
UX-DR3 (CAP-2/3/4/5): Expanded body arms — terminal (`$ cmd` / output / exit), diff (add/del/hunk lines), matches list (`path:line`), paths flat list, code highlight, todo checklist (phase headers + per-item glyphs), task subtask cards, generic `key: value`. _Mockup: Transcript States._
UX-DR4 (CAP-8/9/10): Composer dock across agent sub-states — `generating` (`Stop`/`Queue`), `interrupting` transient (`Stopping…` `aria-disabled`), `idle-after-interrupt` (`Send now`, header `WILL SEND`), `generating again`, finished (read-only, `NEVER SENT`). _Mockup: Steering Dock States; Console + Legacy Node Room._
UX-DR5 (CAP-11): Operator transcript row — `operator · <sender display name>` label + full-strength text (distinct from assistant without hue) + `sent`/`delivered` badge.
UX-DR6 (CAP-9/10): 30-minute-fail dock treatment + disclosure copy (`no redirect ends this node after 30 min of inactivity · typing keeps it open`); `NEVER SENT` read-only box; focus moves to the last transcript row on dock removal.
UX-DR7 (accessibility): serialized composite live-region announcements per transition (steering state last; delivery-failure on an assertive `role="alert"`); `aria-disabled` discipline; `aria-describedby` on the blocked Send; reduced-motion on the dock; contrast floor for the pending-ask-blocked Send = text-secondary; CSS `text-transform`, not literal DOM capitals.
UX-DR8 (surfaces): Legacy vs Console delta — Console send control is bordered, Legacy is the filled shadcn `Button` the ask card uses; `:root` token differences (hue 260 vs 265); anatomy, order, and wording identical.
UX-DR9 (CAP-3, **in scope** — owner-confirmed 2026-09-13): a **pinned todo strip** surfacing current todo state at the top of the transcript, beyond the folded in-line checklist row; mirrors the same `TodoPhase[]`, stays visible while the transcript scrolls, absent when the node has no todos. Folded into CAP-3 success.
UX-DR10 (CAP-6, **in scope** — owner-confirmed 2026-09-13): a **loop iteration selector** to navigate between occurrence/iteration groups, beyond the per-group headers (headers stay the anchors it targets); absent on a single-occurrence node. Folded into CAP-6 success.

### FR Coverage Map

| FR / CAP                         | Story                     |
| -------------------------------- | ------------------------- |
| FR1 (CAP-1)                      | 1.1                       |
| FR7 (CAP-7)                      | 1.1                       |
| FR2 (CAP-2)                      | 1.2                       |
| FR5 (CAP-5)                      | 1.3                       |
| FR3 (CAP-3)                      | 1.4 (+ UX-DR9)            |
| FR4 (CAP-4)                      | 1.5                       |
| FR6 (CAP-6)                      | 1.6 (+ UX-DR10)           |
| FR9 (CAP-9) engine               | 1.7                       |
| FR10 (CAP-10) engine             | 1.7                       |
| routes/registry/race handling    | 1.8                       |
| FR8 (CAP-8) dock                 | 1.9                       |
| FR9/FR10 dock                    | 1.10                      |
| FR11 (CAP-11)                    | 1.11 (dep: 1.1 reader)    |
| terminal reconcile / 30-min fail | 1.12                      |
| FR12 (CAP-12) soft-inject        | 1.13 (spike, deferred)    |
| FR13 (CAP-13) delivered          | 1.13 (SDK bump, deferred) |

## Epic List

1. **Epic 1 — Agent Node Room** (CAP-1…13) — the readable transcript (retroactive, ships first, Stories 1.1–1.6) and live steering (node keeps running, Stories 1.7–1.13), in one epic.

---

## Epic 1: Agent Node Room

The agent node view on both node rooms (Legacy + Console), made **readable** and **steerable** — the whole of `spec-agent-node-room` (CAP-1…13) as one epic. Two halves sequenced by risk and release cadence: the **read half** (Stories 1.1–1.6) ships first, retroactively; the **steering half** (Stories 1.7–1.13) follows. Both node rooms ship together; shared render-neutral logic in `packages/web/src/lib/`, JSX written twice.

**Read half (CAP-1…7) — scannable transcript; retroactive, ships first.**

Replace the two always-open blocks of pretty-printed JSON per tool call with a scannable transcript on both node rooms — one line per call, expandable into a body shaped for the tool. A pure function of data already stored and served; no schema, migration, or backend change, so it improves every historical run immediately. Design: **Transcript States** + **Console/Legacy Node Room** screens; `DESIGN.md`/`EXPERIENCE.md` authoritative.

### Story 1.1: Scannable one-line tool rows + the presenter + Raw escape hatch

As an operator opening an agent node,
I want each tool call rendered as one scannable line I can expand,
So that I can follow what the agent did without reading serialized JSON.

**Acceptance Criteria:**

**Given** a historical node with forty tool calls
**When** I open it in either node room (Legacy or Console)
**Then** it renders forty single-line rows, each with a family chip, a status glyph (`✓ ✕ ◐ ⚠ –`), a headline naming the salient argument, and right-aligned badges
**And** successful calls are collapsed on first render, failed calls expanded, and no collapsed row contains serialized-data punctuation.

**Given** any tool call
**When** the row renders
**Then** the status is legible without colour (the glyph carries it), and the chip shows the tool name as sent only when it is a single token ≤24 chars, else the family name.

**Given** a developer needs the exact bytes
**When** they open a card's Raw toggle (closed by default)
**Then** the original JSON is shown — the only place JSON appears — and the existing `canLoadFullOutput` flow still works.

**Given** the write half will later add operator rows
**When** the renderer encounters a row whose `metadata.origin === 'operator'`
**Then** it recognizes the kind rather than rendering it as agent text (the reader hook Story 1.11 depends on).

_Refs:_ CAP-1, CAP-7, NFR1–3; `tool-presentation-contract.md` (collapsed row, resolver tiers, glyph mapping); presenter = pure `packages/web/src/lib/tool-presentation.ts`; mockup **Transcript States**; `DESIGN.md` Components, `EXPERIENCE.md` State Patterns + Accessibility Floor. Shared logic in `lib/`, JSX written twice.

### Story 1.2: Family-shaped expanded bodies

As a reader,
I want an expanded call rendered for the kind of tool it is,
So that I see a terminal, a search result, or code — not a data structure.

**Acceptance Criteria:**

**Given** a tool call of a known family
**When** I expand it
**Then** it renders that family's declared body arm (shell → terminal `$ cmd` + output + exit; search → `matches`/`paths` by `output_mode`; glob → flat paths; code → highlighted source; web → url + markdown).

**Given** a tool matching no family
**When** I expand it
**Then** it renders ≤3 scalar `key: value` pairs (objects/arrays collapsed to `{…}`/`[n]`), never a JSON dump.

**Given** the production corpus
**When** rows are resolved
**Then** the generic fallback claims <2% of rows.

_Refs:_ CAP-2; `tool-presentation-contract.md` (Expanded body table; the `glob` `path`-vs-`pattern` trap; grep arm from `output_mode`); mockup **Transcript States**.

### Story 1.3: Inline file-edit diff

As a reader,
I want a file edit shown as the change it made,
So that I see what changed inline without leaving the transcript.

**Acceptance Criteria:**

**Given** a file-edit call whose payload carries both before and after content
**When** I expand it
**Then** a line diff renders through `react-diff-view` (add/del/hunk lines).

**Given** a Codex file edit that attaches no input
**When** I expand it
**Then** it falls back to path + preview; a diff is never fabricated from one side.

**Given** a pathological input
**When** the diff is computed
**Then** `diff-hunks.ts` bounds it with an explicit `maxEditLength` (never a wall-clock timeout) and degrades to path + preview rather than hanging the thread.

_Refs:_ CAP-5; Additional Requirements (`diff-hunks.ts` + `git-hunk-adapter.ts`); mockup **Transcript States**.

### Story 1.4: Todo list folded as state (+ pinned strip)

As a reader,
I want the agent's todo list as current state, not a sequence of updates,
So that I see phases and per-item status at a glance.

**Acceptance Criteria:**

**Given** a node with todo calls (OMP ops or Claude whole-list `TodoWrite`)
**When** I view it
**Then** both provider shapes fold to one `TodoPhase[]` per `todo-fold-contract.md`, the checklist renders once anchored at the last todo call, and earlier todo calls collapse to a one-line row.

**Given** a phase emptied by `rm`
**When** the checklist renders
**Then** the phase disappears rather than rendering an empty header.

**Given** a node with todo state (owner-confirmed in scope)
**When** the transcript renders
**Then** current todo state also surfaces as a **pinned strip** at the top of the transcript panel, mirroring the same `TodoPhase[]`, staying visible while the transcript scrolls, and absent when the node has no todos.

_Refs:_ CAP-3 (incl. UX-DR9, folded into CAP-3 success); `todo-fold-contract.md` (nine OMP ops incl. the three traps; Claude last-call-wins); mockup **Transcript States**.

### Story 1.5: Subagent dispatch cards

As a reader,
I want a task dispatch shown as its brief and its subtasks,
So that I see what a subagent was asked to do.

**Acceptance Criteria:**

**Given** a task dispatch (OMP batch or Claude single)
**When** I expand it
**Then** both shapes normalize to `TaskSubtask[]`, batch context renders as markdown, and each subtask is one collapsible card naming the subtask and its agent.

_Refs:_ CAP-4; mockup **Transcript States**.

### Story 1.6: Occurrence grouping headers (+ loop iteration selector)

As a reader,
I want to tell which attempt or loop iteration produced a call,
So that a re-run or loop node is not one undifferentiated list.

**Acceptance Criteria:**

**Given** a node whose rows span more than one `occurrence_id`
**When** I view it
**Then** a header renders per group; grouping keys on `occurrence_id`, never `attempt_id`.

**Given** a single-occurrence node
**When** I view it
**Then** no group header renders.

**Given** a node spanning more than one occurrence (owner-confirmed in scope)
**When** the transcript renders
**Then** a **loop-iteration selector** lets me navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and it is absent on a single-occurrence node.

_Refs:_ CAP-6 (incl. UX-DR10, folded into CAP-6 success); mockup **Console/Legacy Node Room**.

---

**Steering half (CAP-8…13) — live-session write half; ships after the read half above.**

Send a message to a running agent, and interrupt its current thinking to redirect it — both without stopping the node (the node stays `running`; stopping the whole node is the existing Cancel feature). In-process, no durable state. Design: **Steering Dock States** + **Console/Legacy Node Room**; `control-states.md` + `EXPERIENCE.md` authoritative. **One cross-half dependency:** the operator row (Story 1.11) needs Story 1.1's transcript reader to recognize `origin='operator'` first.

### Story 1.7: Per-turn interrupt signal + multi-turn session loop + in-process registry (engine)

As the engine,
I want a steered node to interrupt the current turn and run further turns on one live session, with its live handle reachable in-process,
So that steering never fails the node and the agent continues from where the operator redirected it.

**Acceptance Criteria:**

**Given** a running node
**When** steering interrupts
**Then** it aborts a **fresh per-turn signal** (`AbortSignal.any` with the node-level one), never the one-shot `nodeAbortController`, so the `:3124` Cancel check is never tripped and the node stays `running`.

**Given** an interrupted turn
**When** the loop resolves it
**Then** `operatorInterrupt` is honored by placement — `canReask` (`:3032`) also stops on it, validation is skipped, its branch sits after the `:3124` Cancel check, and the flag resets at turn N+1; a turn that emitted a `result` (`:2533`) is treated as a natural end regardless of the flag.

**Given** a delivered operator message
**When** the turn ends
**Then** the node runs turn N+1 on the same session via the `attemptResumeId` re-ask seam (`:2290`); a natural end auto-drains the queue, an interrupted end enters idle-await and drains only on `Send now`.

**Given** a node running in-process
**When** the executor starts and ends the node
**Then** it registers `(runId, nodeId) → live session handle + inbound queue` in the in-process registry on start and tears it down on any terminal, so later stories can resolve the handle to send or interrupt (a node with no in-process handle is not steerable).

_Refs:_ CAP-9, CAP-10, NFR4–5; `engine-integration.md` (the abort seam, placement clauses, discriminator, the registry); provider mechanics in `provider-steering-matrix.md`.

### Story 1.8: Send/Interrupt routes + registry resolution + race handling

As the system,
I want authorized steering routes that resolve the live node and never lose a message to a race,
So that the dock has a transport to call before it is built, and nothing is silently dropped.

**Acceptance Criteria:**

**Given** `POST …/nodes/:nodeId/send` and `…/interrupt`
**When** called
**Then** identity resolves via `resolveAuthContext` (HITL/AD-7), and each route resolves the live handle from the Story 1.7 registry keyed `(runId, nodeId)`.

**Given** a Send arriving while an interrupt is still in flight
**When** the route handles it
**Then** it waits in the registry queue for `Send now` (never delivered automatically); the queue absorbs the race with no 409.

**Given** a node no longer running, or a detached run with no live handle
**When** a Send/Interrupt is called
**Then** the only refusals fire — `node finished` → 409 (the draft stays in the browser) or "not steerable here" for the detached run; Cancel and normal `/workflow resume` still work on the detached run.

_Refs:_ CAP-8/9 infra, NFR4; `engine-integration.md` (routes, registry, refusals); `control-states.md` (Send-now-no-server-gate, the 409). Depends on Story 1.7's registry.

### Story 1.9: Composer dock — compose and Queue while generating

As an operator watching a running node,
I want to write and queue a message without disturbing the agent,
So that my correction is ready to deliver at the next turn.

**Acceptance Criteria:**

**Given** a running node with a generating agent
**When** the dock renders
**Then** the composer is mounted and enabled, the send control reads `Queue`, and the draft box header reads `QUEUED · n` with `this tab only`.

**Given** I press `Queue`
**When** the message is held
**Then** it is sent to the Story 1.8 send route, the node is untouched, no tool call is interrupted, nothing is lost, and it is delivered as the next turn when the current turn ends naturally.

**Given** the projected agent sub-state
**When** the dock reads it
**Then** controls follow the sub-state (`generating` | `idle-after-interrupt`), never a remembered mode; `Enter` inserts a newline and never sends.

_Refs:_ CAP-8, NFR8; mockup **Steering Dock States** (state 1); `control-states.md`, `EXPERIENCE.md` The dock. Depends on Stories 1.7 (engine queue-drain) and 1.8 (send route).

### Story 1.10: Interrupt control, idle-after-interrupt, and Send now

As an operator,
I want to stop the agent's current thinking and then send what to do instead,
So that the agent continues on the right thing without the node ever stopping.

**Acceptance Criteria:**

**Given** a generating agent
**When** I press `Stop`
**Then** the interrupt route (Story 1.8) fires, the current turn ends (session alive), the node stays `running`, the agent moves to `idle-after-interrupt`, the in-flight tool call shows `⚠ interrupted` (not failed), and a brief `Stopping…` transient (if shown) is `aria-disabled`, not the native attribute.

**Given** the agent is `idle-after-interrupt`
**When** the dock renders
**Then** the stop control is gone, send reads `Send now`, the draft header reads `WILL SEND · n`, and a disclosure states the interrupt did not undo written work.

**Given** I press `Send now`
**When** delivery runs
**Then** every queued message plus the one just typed is delivered in written order as the next turn on the same session, and the agent generates again (`Stop`/`Queue` return).

_Refs:_ CAP-9, CAP-10; mockup **Steering Dock States** (states 2–4); `control-states.md`, `EXPERIENCE.md`. Depends on Stories 1.8 (interrupt route) and 1.9 (dock).

### Story 1.11: Operator message in the transcript record

As anyone reading the transcript later,
I want the operator's messages recorded in order among the agent's calls,
So that the exchange is part of the permanent record.

**Acceptance Criteria:**

**Given** an operator message is delivered
**When** the executor writes it
**Then** it is an ordinary `text` row with three additive `metadata` fields (`origin='operator'`, `operator_user_id`, `message_id`), no new table and no widened `kind`, written by the executor alone, placed by `seq` between the call it interrupted and the one it caused.

**Given** the row reaches the transcript
**When** the reader renders it
**Then** it is visibly the operator's (label `operator · <display name>`, full-strength text), never mistakable for agent text — **requires Story 1.1's reader recognizing `origin='operator'`** (build that first).

_Refs:_ CAP-11, Cross-half dependency; `engine-integration.md` (operator row), `EXPERIENCE.md`; mockup operator row. Depends on Story 1.1 (reader hook).

### Story 1.12: Terminal reconciliation + 30-minute inactivity fail (lifecycle safety)

As the system,
I want a message never silently undelivered and an abandoned interrupt never to hang the node forever,
So that steering fails safe when the operator walks away or the process drops the queue.

**Acceptance Criteria:**

**Given** any terminal (finish, Cancel, or the 30-minute fail)
**When** the client reconciles on the node's terminal event only
**Then** each `sent` id is matched against the `message_id` on written operator rows; any unmatched id returns to the draft box as `NEVER SENT`; the reconciliation never runs on a live refetch (it would mis-mark a delivered message before the final insert commits).

**Given** an `idle-after-interrupt` agent with nothing sent
**When** 30 minutes of composer inactivity pass
**Then** the node fails (`interrupted by operator, no redirect received`) on an explicit fail branch (never the existing idle timeout that completes); the timer is re-armed by any composer activity (keystroke/focus/`Send now`) and its limit is disclosed in the dock; resuming re-runs with a fresh session.

**Given** two docks steering one node on a multi-user install
**When** their sends arrive
**Then** global order is the registry's server-side receipt order (no per-node lock), each row attributed by `operator_user_id`; per-operator "written order" holds within each sender's stream.

_Refs:_ CAP-11 record + NFR4/NFR6/NFR8; `engine-integration.md` (reconciliation on terminal only, idle-await fail branch), `control-states.md` (`NEVER SENT`); mockup **Steering Dock States** (state 5, fail). Depends on Stories 1.8 (routes), 1.11 (operator row), 1.7 (idle-await entry).

### Story 1.13: Delivery confirmation and mid-turn soft-inject (deferred / gated)

As an operator,
I want to know a message actually reached the agent, and to have it arrive mid-turn where the provider allows,
So that I trust delivery and get acceleration when possible — without blocking the v1 floor.

**Acceptance Criteria:**

**Given** the v1 floor
**When** the steering half ships
**Then** every message shows `sent` and delivery is interrupt + `Queue` on every provider; neither of the two capabilities below blocks it.

**Given** an SDK bump to `@anthropic-ai/claude-agent-sdk` ≥ 0.3.246
**When** claude echoes the stamped `message_id`
**Then** that message advances `sent → delivered` (claude-only, by id); until the bump every message stays `sent`. _(Deferred — gated on the pin moving.)_

**Given** the claude `AsyncIterable`-input-plus-resume spike clears
**When** a message is soft-injected
**Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. _(Deferred — spike-gated; grok hooks a separate spike.)_

_Refs:_ CAP-12, CAP-13; `provider-steering-matrix.md`; SPEC Open questions (SDK bump, AsyncIterable spike, grok hooks).
