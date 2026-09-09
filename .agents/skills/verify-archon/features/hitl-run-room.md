# Open the HITL run room

Open the HITL run room lets a user open a workflow run detail page, keep the room absent until they pick an execution, then open a percentage-sized room that shows that execution's agent history (and Ask cards when the run is waiting). A passing proof is a **visible** room on `/console/p/:projectId/r/:runId` — HTTP 200 on the run API is not enough.

## Sub-features

- `room-absent` opens run detail with no room and no resize divider.
- `room-open-close` opens the room from a Log execution, sizes it near 40% of the work area, then Close restores the full main view.
- `room-history` shows assistant text and a tool card from the selected execution.
- `room-deeplink` opens the same node from `?node=<nodeId>` exactly once for that query value.

## How to get to it (user POV)

- Open `/console/p/<projectId>/r/<runId>` after a run exists (console run-detail).
- Click a Log execution row (accessible name contains the node id) or a graph node.
- Follow a deep link `/console/p/<projectId>/r/<runId>?node=<nodeId>`.
- Open the Legacy run page `/legacy/workflows/runs/<runId>` and use the Logs tab (same room contract; console is the verification default).

## Driving it with verify-archon

Preconditions:

- Isolated local target (not Mini). `verify-archon doctor` passed.
- Vite is running (`launch --with-web`). `prove hitl-run-room` starts both.
- Solo SQLite: `GET /api/auth/status` is `{ "enabled": false }`.
- System Chrome is installed. The helper sets `ARCHON_E2E_FAKE_PROVIDER=1` so the seeded `e2e-hitl-run` fixture can run without vendor AI keys.
- The isolated home has the home-scoped YAML copied from `e2e/fixtures/workflows/e2e-hitl-run.yaml`.

End-to-end (preferred):

```bash
.agents/skills/verify-archon/bin/verify-archon prove hitl-run-room
```

That is `launch --with-web` → seed fixture → `workflow run e2e-hitl-run --no-worktree --json` (pauses at Ask) → Playwright `drive hitl-run-room` → cleanup.

Step-wise:

```bash
.agents/skills/verify-archon/bin/verify-archon launch --with-web
.agents/skills/verify-archon/bin/verify-archon doctor --json
.agents/skills/verify-archon/bin/verify-archon drive hitl-run-room
.agents/skills/verify-archon/bin/verify-archon cleanup
```

- **Seed and run.** Copy `e2e/fixtures/workflows/e2e-hitl-run.yaml` to `$ARCHON_HOME/workflows/`. Register this checkout (`POST /api/codebases`). Run `verify-archon cli -- workflow run e2e-hitl-run --no-worktree --json`. Exit 0. Stdout contains a `workflowRunRef.runId`. `result.state` is `paused` (AskHuman on `ask-starter`).
- **Auth posture.** `verify-archon http /api/auth/status`. Status `200`, `enabled` is `false`.
- **Open run detail.** Playwright (viewport `1440×1000`) opens `/console/p/<codebase_id>/r/<runId>` using `codebase_id` from `GET /api/workflows/runs/<runId>`. The run title includes `e2e-hitl-run`. `#console-run-room` is absent. No `separator` named `Resize node room`.
- **Open room.** Click `button[id^="console-log-"]` whose name contains `inspect-file`. Region `inspect-file room` is visible. Room width / (room + main) is between `0.38` and `0.42`. Screenshot: `hitl-room-open.png`.
- **History.** Inside the room, `ASSISTANT` is visible and `HITL_TOOL_OUTPUT_VISIBLE` is visible.
- **Close.** Click `button` named `Close`. `#console-run-room` is gone. Screenshot: `hitl-room-closed.png`.
- **Deep link.** Open the same run with `?node=inspect-file`. Region `inspect-file room` is visible again. Screenshot: `hitl-room-deeplink.png`.
- **Proof.** Evidence contains those three PNGs, `ui-assertions.json` with `"ok": true`, `hitl-run.cli.json`, and `run-detail.http.json`. HTTP-only is not a pass.

## Gotchas

- `web-console` only proves `/console` and Settings. Do not treat a green `web-console` as a run-room proof.
- `inspect-run` only proves CLI/HTTP `runs` / `get` / `status`. It does not open the room.
- The fixture uses `provider: e2e-fake`. Without `ARCHON_E2E_FAKE_PROVIDER=1` on the CLI process, the run fails looking for a real provider.
- `workflow run --json` without `--detach` is one JSON envelope only after the CLI exits (here: paused at Ask). Parse the last line that contains `workflowRunRef`.
- `GET /api/workflows/runs/<id>` must include `run.codebase_id` or `/console/p/:projectId/r/:runId` cannot be built. Register the checkout before the run.
- Viewport must be wide enough for the split (`1440×1000` in the harness). A 390-wide viewport hides the split and uses single-pane Back — that path is covered by e2e, not this recipe.
- Selectors come from `packages/web/src/experiments/console/` (`#console-run-room`, `button[id^="console-log-"]`, region `<nodeId> room`). Never click by coordinates.
- Mini over Tailscale is not this feature's target. Fake-provider HITL runs belong on the isolated local instance.
