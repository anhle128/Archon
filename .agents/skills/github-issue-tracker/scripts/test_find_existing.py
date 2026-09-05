#!/usr/bin/env python3
"""Regression tests for issue adoption matching (create_issue.issue_matches_story).

Guards the false-adoption bug: a blocker's story slug appears in a DEPENDENT's
"Blocked by" body list as `- `<slug>``; that arbitrary mention must NOT trigger
adoption. Adoption is only by the canonical title tracker key `] <story-id>:` or
the dedicated body line `- Tracker key: `<story-id>``.

Run: python3 .agents/skills/github-issue-tracker/scripts/test_find_existing.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_issue import default_body, issue_matches_story  # noqa: E402

S9 = "3-9-launch-writes-the-one-bind-row"
S11 = "3-11-reconnect-exact-loads-the-bind"
S1 = "3-1-record-adapter-readiness-and-refuse-unsupported-work"

# 3-11's real issue: canonical title + canonical body that lists 3-9 as a blocker.
ISSUE_311 = {
    "title": f"[RM-02][Epic 3] {S11}: Reconnect exact-loads the bind",
    "body": default_body(S11, 3, "Reconnect exact-loads the bind", [S9]),
}
# 3-9's real issue.
ISSUE_9 = {
    "title": f"[RM-02][Epic 3] {S9}: Launch writes the one bind row",
    "body": default_body(S9, 3, "Launch writes the one bind row", ["3-7-x", "3-8-y"]),
}
# Hand-created ad-hoc issue: non-canonical title, but canonical body carries the marker.
ISSUE_ADHOC_9 = {
    "title": "launch bind row (rough)",
    "body": default_body(S9, 3, "Launch writes the one bind row", []),
}
# A PR that happens to mention the slug — never adopt a PR.
ISSUE_PR = {"title": f"[RM-02][Epic 3] {S9}: x", "body": "", "pull_request": {"url": "x"}}

CASES = [
    # (issue, story_id, expected)
    (ISSUE_9, S9, True),                 # title key + own marker
    (ISSUE_ADHOC_9, S9, True),           # dedicated body marker adopts hand-created
    (ISSUE_311, S11, True),              # 3-11 adopts its own issue
    (ISSUE_311, S9, False),             # FALSE-MATCH GUARD: 3-9 mention in 3-11 "Blocked by"
    (ISSUE_9, S11, False),              # no cross-adoption
    (ISSUE_311, S1, False),             # prefix guard: 3-1 not in 3-11/3-10
    (ISSUE_PR, S9, False),              # never adopt a PR
]


def main() -> int:
    failures = []
    for issue, story, expected in CASES:
        got = issue_matches_story(issue, story)
        tag = "ok " if got == expected else "FAIL"
        if got != expected:
            failures.append((issue["title"], story, expected, got))
        print(f"{tag} match={got!s:5} expect={expected!s:5} story={story} title={issue['title'][:44]!r}")
    # Extra invariant: the canonical body's dedicated marker must be exactly one line
    # and must differ from the "Blocked by" mention form for the same slug.
    body = default_body(S11, 3, "x", [S9])
    assert f"- Tracker key: `{S11}`" in body, "canonical body must carry the tracker-key marker"
    assert f"- Tracker key: `{S9}`" not in body, "a blocker must NOT appear as a tracker-key line"
    assert f"- `{S9}`" in body, "blocker should appear as a plain mention (the false-match trap)"
    if failures:
        print(f"\n{len(failures)} FAILURE(S)")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
