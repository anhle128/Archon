---
name: select-verify-archon-targets
description: >-
  Choose verify-archon feature-map ids to prove after a product change.
  Use from Cursor via /select-verify-archon-targets (manual) or from an
  Archon workflow node. Picks ids under `.agents/skills/verify-archon/features/`
  from a plan and git diff. Not Archon-runtime-only.
---

# Select verify-archon targets

Pick the smallest set of feature-map ids whose user paths this change can break.
Do not implement product code. Do not start Mini, PM2, or Tailscale.

This skill is **Cursor-first**. You can run it with `/select-verify-archon-targets`
in a checkout with no Archon workflow. Workflow env vars are optional adapters.

## Map

Read `.agents/skills/verify-archon/features/README.md` and the feature files there.
Allowed ids only:

- `discover-workflows`
- `web-console`
- `diagnose-install`
- `run-deterministic-workflow`
- `inspect-run`

## Inputs (resolve in this order)

1. **Plan** — path the user names, or the newest relevant file under `docs/superpowers/plans/`, or "none".
2. **Base ref for diff** — first available:
   - path in `$BASE_SHA_FILE` or `$ARTIFACTS_DIR/superpowers/base-sha.txt` (workflow)
   - SHA/ref the user names (`develop`, `origin/develop`, a commit)
   - default: `git merge-base HEAD origin/develop` (fallback `origin/main`, then `HEAD~1`)
3. **Request text** — the user's message / PR description / empty.

Diff range: `base...HEAD`, plus staged and unstaged changes.

## Output locations (manual vs workflow)

| Mode | Write proposed ids to | Also print |
| --- | --- | --- |
| **Manual (default)** | `.agents/skills/verify-archon/evidence/last-select/feature-ids.proposed.txt` | JSON to the user |
| **Workflow** when `$ARTIFACTS_DIR` is set | `$ARTIFACTS_DIR/verify/feature-ids.proposed.txt` | JSON return for the node |

Create parent dirs as needed. One id per line, no commentary in the txt file.

Never require `$ARTIFACTS_DIR` for a successful manual run.

## Rules

- Include every id whose mapped user path the diff or plan can break.
- If anything under `packages/web` changed, include `web-console`.
- Always emit at least one id.
- If nothing else is justified, use `discover-workflows`.
- Local bun verify only (ids must be driveable by `verify-archon`).

## Return

Return JSON (and show it to the user when manual):

```json
{
  "feature_ids": ["web-console", "inspect-run"],
  "rationale": "…",
  "web_changed": true,
  "base_ref": "abc123…",
  "output_path": "…"
}
```

## Next step (manual)

Tell the user to run `/verify-archon` (or the helper) for each id:

```bash
.agents/skills/verify-archon/bin/verify-archon prove <id>
```

Or prove all selected:

```bash
while read -r id; do
  [ -n "$id" ] || continue
  .agents/skills/verify-archon/bin/verify-archon prove "$id" || exit 1
done < .agents/skills/verify-archon/evidence/last-select/feature-ids.proposed.txt
```

Note: today's feature map is CLI/HTTP/console-shell oriented. Deep product UI
(e.g. HITL run room) may need e2e or a new feature-map entry — say so if the
diff is broader than the map.
