#!/usr/bin/env python3
"""Pure unit cases for status-label derivation in create_issue.py (no network).
Run: python3 .agents/skills/github-issue-tracker/scripts/test_status_labels.py"""
import importlib.util, pathlib

spec = importlib.util.spec_from_file_location(
    "create_issue", pathlib.Path(__file__).with_name("create_issue.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

STORIES = {
    "blk-open": {"status": "backlog"},
    "blk-review": {"status": "review"},
    "blk-done": {"status": "done"},
}

def case(desc, entry, expect_ready):
    got = m.status_is_ready(entry, STORIES)
    assert got is expect_ready, f"FAIL {desc}: status_is_ready={got} expected={expect_ready}"
    has = "status:ready" in m.desired_labels(3, entry, STORIES)
    assert has is expect_ready, f"FAIL {desc}: label present={has} expected={expect_ready}"
    print(f"  ok: {desc} -> ready={got}")

def main():
    # backlog -> never ready (this is Story 3.6's real case)
    case("backlog + blockers", {"status": "backlog", "blocked_by": ["blk-done"]}, False)
    # ready-for-dev + all blockers done -> ready
    case("ready-for-dev + done blocker", {"status": "ready-for-dev", "blocked_by": ["blk-done"]}, True)
    # ready-for-dev + an open blocker -> NOT ready
    case("ready-for-dev + open blocker", {"status": "ready-for-dev", "blocked_by": ["blk-open"]}, False)
    # ready-for-dev + non-done (review) blocker -> NOT ready
    case("ready-for-dev + review blocker", {"status": "ready-for-dev", "blocked_by": ["blk-review"]}, False)
    # ready-for-dev, no blockers -> ready
    case("ready-for-dev + no blockers", {"status": "ready-for-dev", "blocked_by": []}, True)
    # in-progress / review / done are past-ready -> no label
    case("in-progress", {"status": "in-progress", "blocked_by": []}, False)
    case("review", {"status": "review", "blocked_by": []}, False)
    case("done", {"status": "done", "blocked_by": []}, False)
    # missing status defaults to backlog -> no label
    case("missing status", {"blocked_by": []}, False)
    print("all status-label unit cases passed")

if __name__ == "__main__":
    main()
