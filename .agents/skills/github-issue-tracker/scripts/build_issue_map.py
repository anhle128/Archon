#!/usr/bin/env python3
"""Build or refresh the GitHub issue-map — the single source of truth for
story -> issue mapping AND story relationships (blocked_by).

Design (per Kevin, 2026-08-26):
- The issue-map is authoritative for relationships. Issue creation reads the
  map, never the epic, so relationships stay consistent one-by-one.
- This builder is the ONE place the relationship graph is seeded. It is driven
  by sprint-status.yaml (the authoritative list of stories + epics + status)
  and fills each story's {epic, title, blocked_by} from the SEED graph below.
- It NEVER clobbers `number` / `node_id` / `url` (filled by create_issue.py),
  and by default it does NOT overwrite an existing `blocked_by` you edited by
  hand in the map (use --reseed to force blocked_by/title back to SEED).

The SEED is a one-time transcription of the curated RM-02 dependency graph
(previously living in the removed batch script sync-github-issues.py).
After generation, edit relationships in the MAP, not here.

Usage:
  python .agents/skills/github-issue-tracker/scripts/build_issue_map.py
  python .../build_issue_map.py --status PATH --map PATH --seed PATH.json
  python .../build_issue_map.py --reseed        # force blocked_by/title from SEED
  python .../build_issue_map.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MILESTONE = 1
MAP_PATH = Path("_bmad-output/implementation-artifacts/rm-02/github-issue-map.json")
STATUS_PATH = Path("_bmad-output/implementation-artifacts/rm-02/sprint-status.yaml")

# story_id -> (title, blocked_by[])   epic is derived from the story id prefix.
# One-time seed of the curated RM-02 relationship graph. Edit the MAP after this.
SEED: dict[str, tuple[str, list[str]]] = {
    # Epic 1
    "1-1-list-gigo-without-external-detection": ("List Gigo without external detection", []),
    "1-2-detect-and-add-an-external-harness": ("Detect and add an external harness", ["1-1-list-gigo-without-external-detection"]),
    "1-3-create-a-project-with-a-uuid": ("Create a Project with a UUID", ["1-1-list-gigo-without-external-detection"]),
    "1-4-create-a-conversation-with-a-locked-harness": ("Create a Conversation with a locked harness", ["1-2-detect-and-add-an-external-harness", "1-3-create-a-project-with-a-uuid"]),
    # Epic 2 (retired in place; kept for dependency names only)
    "2-1-create-an-api-key-providerconnection": ("Create an API-key ProviderConnection", ["1-4-create-a-conversation-with-a-locked-harness"]),
    "2-2-run-gigo-owned-oauth-for-claude-and-codex-families": ("Run Gigo-owned OAuth for Claude and Codex families", ["2-1-create-an-api-key-providerconnection"]),
    "2-3-import-vendor-oauth-only-when-i-accept": ("Import vendor OAuth only when I accept", ["2-2-run-gigo-owned-oauth-for-claude-and-codex-families"]),
    "2-4-probe-identity-and-keep-accounts-distinct": ("Probe identity and keep accounts distinct", ["2-2-run-gigo-owned-oauth-for-claude-and-codex-families"]),
    "2-5-refresh-credentials-at-the-lease-boundary": ("Refresh credentials at the lease boundary", ["2-4-probe-identity-and-keep-accounts-distinct"]),
    "2-6-store-direct-llm-models-only-in-modelvault": ("Store direct-LLM models only in ModelVault", ["2-1-create-an-api-key-providerconnection"]),
    # Epic 3
    "3-1-record-adapter-readiness-and-refuse-unsupported-work": ("Record adapter readiness and refuse unsupported work", ["1-4-create-a-conversation-with-a-locked-harness"]),
    "3-2-versioned-capability-records-and-auth-before-prompt": ("Versioned capability records and auth-before-prompt", ["3-1-record-adapter-readiness-and-refuse-unsupported-work"]),
    "3-3-characterize-codex-app-server-lifecycle": ("Characterize Codex App Server lifecycle", ["1-2-detect-and-add-an-external-harness"]),
    "3-4-characterize-claude-native-lifecycle": ("Characterize Claude native lifecycle", ["1-2-detect-and-add-an-external-harness"]),
    "3-5-characterize-the-oh-my-pi-executor-and-lifecycle": ("Characterize the Oh My Pi executor and lifecycle", ["1-2-detect-and-add-an-external-harness"]),
    "3-6-implement-the-characterized-external-control-paths": ("Implement the characterized external control paths", ["3-2-versioned-capability-records-and-auth-before-prompt", "3-3-characterize-codex-app-server-lifecycle", "3-4-characterize-claude-native-lifecycle", "3-5-characterize-the-oh-my-pi-executor-and-lifecycle"]),
    "3-7-migrate-rm-01-native-session-binds": ("Introduce the native-session-bind authority and cut over", ["1-4-create-a-conversation-with-a-locked-harness"]),
    "3-8-list-native-sessions-when-the-matrix-allows-it": ("List native sessions when the matrix allows it", ["3-6-implement-the-characterized-external-control-paths"]),
    "3-9-launch-writes-the-one-bind-row": ("Launch writes the one bind row", ["3-7-migrate-rm-01-native-session-binds", "3-8-list-native-sessions-when-the-matrix-allows-it"]),
    "3-10-attach-is-first-writer-or-typed-unsupported": ("Attach is first-writer or typed unsupported", ["3-9-launch-writes-the-one-bind-row"]),
    "3-11-reconnect-exact-loads-the-bind": ("Reconnect exact-loads the bind", ["3-9-launch-writes-the-one-bind-row"]),
    "3-12-prompt-and-stream-with-a-frozen-turnbinding": ("Prompt and stream with a frozen TurnBinding", ["3-2-versioned-capability-records-and-auth-before-prompt", "3-8-list-native-sessions-when-the-matrix-allows-it", "3-9-launch-writes-the-one-bind-row", "3-11-reconnect-exact-loads-the-bind"]),
    "3-13-explain-eligibility-and-rejections": ("Explain eligibility and rejections", ["3-1-record-adapter-readiness-and-refuse-unsupported-work", "3-2-versioned-capability-records-and-auth-before-prompt"]),
    # Epic 4
    "4-1-classify-failures-into-the-locked-kinds": ("Classify failures into the locked kinds", ["3-1-record-adapter-readiness-and-refuse-unsupported-work"]),
    "4-2-auto-retry-only-on-the-same-turnbinding": ("Auto-retry only on the same TurnBinding", ["4-1-classify-failures-into-the-locked-kinds", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    "4-3-rebuild-projections-without-live-providers": ("Rebuild projections without live providers", ["4-1-classify-failures-into-the-locked-kinds", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    # Epic 5
    "5-1-list-models-from-the-owning-harness-source": ("List models from the owning harness source", ["3-6-implement-the-characterized-external-control-paths"]),
    "5-2-persist-and-commit-pending-binding-changes-at-idle": ("Persist and commit pending binding changes at idle", ["5-1-list-models-from-the-owning-harness-source", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    "5-3-replace-the-worker-after-a-binding-commit": ("Apply the committed binding on the live worker", ["5-2-persist-and-commit-pending-binding-changes-at-idle"]),
    "5-4-latch-and-recover-a-failed-binding-apply": ("Latch and recover a failed binding apply", ["5-3-replace-the-worker-after-a-binding-commit"]),
    "5-5-expose-thinking-and-fast-only-when-supported": ("Expose thinking and Fast only when supported", ["5-1-list-models-from-the-owning-harness-source", "3-2-versioned-capability-records-and-auth-before-prompt"]),
    # Epic 6
    "6-1-classify-commands-before-any-adapter": ("Classify commands before any adapter", ["3-2-versioned-capability-records-and-auth-before-prompt"]),
    "6-2-support-clear-and-compact-through-the-product-router": ("Support clear and compact through the product router", ["6-1-classify-commands-before-any-adapter", "5-1-list-models-from-the-owning-harness-source"]),
    "6-3-fail-closed-on-unknown-hidden-or-matrix-false-slash": ("Fail closed on unknown, hidden, or matrix-false slash", ["6-1-classify-commands-before-any-adapter"]),
    "6-4-invoke-a-skill-without-sending-the-slash": ("Invoke a skill without sending the slash", ["6-1-classify-commands-before-any-adapter"]),
    # Epic 7
    "7-1-return-typed-unsupported-or-uncharacterized-without-fake-success": ("Return typed unsupported or uncharacterized without fake success", ["3-6-implement-the-characterized-external-control-paths", "4-1-classify-failures-into-the-locked-kinds"]),
    "7-2-execute-load-and-resume-where-supported": ("Execute load and resume where supported", ["7-1-return-typed-unsupported-or-uncharacterized-without-fake-success", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    "7-3-answer-native-interactions-and-cancel-where-supported": ("Answer native interactions and cancel where supported", ["7-1-return-typed-unsupported-or-uncharacterized-without-fake-success", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    "7-4-disconnect-terminate-and-detach-where-supported": ("Disconnect, terminate, and detach where supported", ["7-1-return-typed-unsupported-or-uncharacterized-without-fake-success", "3-12-prompt-and-stream-with-a-frozen-turnbinding"]),
    "7-5-pass-the-shared-conformance-suite-per-adapter": ("Pass the shared conformance suite per adapter", ["7-1-return-typed-unsupported-or-uncharacterized-without-fake-success", "7-2-execute-load-and-resume-where-supported", "7-3-answer-native-interactions-and-cancel-where-supported", "7-4-disconnect-terminate-and-detach-where-supported"]),
    "7-6-complete-one-bounded-real-task-per-supported-harness": ("Complete one bounded real task per supported harness", ["7-5-pass-the-shared-conformance-suite-per-adapter", "2-2-run-gigo-owned-oauth-for-claude-and-codex-families"]),
}

STORY_RE = re.compile(r"^\s{2}([0-9]+-[0-9]+-[a-z0-9-]+):\s*(\S+)\s*$")


def epic_of(story_id: str) -> int:
    return int(story_id.split("-", 1)[0])


def parse_sprint_status(path: Path) -> dict[str, str]:
    """Return {story_id: status} for real stories (not epic-N / -retrospective)."""
    stories: dict[str, str] = {}
    in_block = False
    for line in path.read_text().splitlines():
        if line.startswith("development_status:"):
            in_block = True
            continue
        if in_block and line and not line.startswith(" "):
            break
        m = STORY_RE.match(line)
        if not m:
            continue
        key, status = m.group(1), m.group(2)
        if key.startswith("epic-") or key.endswith("-retrospective"):
            continue
        stories[key] = status
    return stories


def load_map(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"milestone": MILESTONE, "stories": {}}

def load_seed(path: Path | None) -> dict[str, tuple[str, list[str]]]:
    if path is None:
        return SEED
    raw = json.loads(path.read_text())
    out: dict[str, tuple[str, list[str]]] = {}
    for story_id, value in raw.items():
        if isinstance(value, dict):
            title = value["title"]
            blocked_by = list(value.get("blocked_by", []))
        else:
            title, blocked_by = value[0], list(value[1])
        out[story_id] = (title, blocked_by)
    return out


def main(argv: list[str] | None = None) -> int:


    parser = argparse.ArgumentParser(description="Build/refresh the GitHub issue-map from sprint-status + the seed relationship graph.")
    parser.add_argument("--map", type=Path, default=MAP_PATH)
    parser.add_argument("--status", type=Path, default=STATUS_PATH)
    parser.add_argument("--seed", type=Path, help="JSON object of story_id -> [title, blocked_by[]]; default is the built-in RM-02 SEED")
    parser.add_argument("--milestone", type=int, default=MILESTONE)
    parser.add_argument("--reseed", action="store_true", help="force blocked_by/title back to SEED (overwrites manual edits)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if not args.status.exists():
        print(f"error: sprint-status not found: {args.status}", file=sys.stderr)
        return 2

    tracked = parse_sprint_status(args.status)
    seed = load_seed(args.seed)
    data = load_map(args.map)
    data.setdefault("milestone", args.milestone)
    stories = data.setdefault("stories", {})

    added, filled, warned = [], [], []
    for story_id, status in tracked.items():
        if story_id not in seed:
            warned.append(f"in sprint-status but not in SEED (no title/deps): {story_id}")
            continue
        title, blocked_by = seed[story_id]
        entry = stories.get(story_id)
        if entry is None:
            stories[story_id] = {"epic": epic_of(story_id), "title": title, "blocked_by": list(blocked_by), "status": status}
            added.append(story_id)
            continue
        # non-destructive fill; preserve number/node_id/url and manual blocked_by
        entry.setdefault("epic", epic_of(story_id))
        entry.setdefault("title", title)
        if args.reseed or "blocked_by" not in entry:
            entry["blocked_by"] = list(blocked_by)
        entry["status"] = status
        filled.append(story_id)

    for story_id in seed:
        if story_id not in tracked and (args.seed is not None or epic_of(story_id) != 2):
            warned.append(f"in SEED but not tracked in sprint-status: {story_id}")
    # sort stories for stable diffs
    data["stories"] = {k: stories[k] for k in sorted(stories, key=lambda s: (epic_of(s), [int(p) for p in s.split('-')[:2]]))}

    if args.dry_run:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        args.map.parent.mkdir(parents=True, exist_ok=True)
        args.map.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")

    ready = [s for s, m in data["stories"].items() if not m.get("blocked_by") and not m.get("number")]
    print(f"map: {args.map}")
    print(f"tracked stories: {len(tracked)}  added: {len(added)}  filled: {len(filled)}")
    for w in warned:
        print(f"  warn: {w}", file=sys.stderr)
    print(f"ready-now (no blockers, no issue yet): {', '.join(ready) or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
