#!/usr/bin/env python3
"""Unit cases for pack flags, seed JSON, and skipped Feature type (no network).

Run: python3 .agents/skills/github-issue-tracker/scripts/test_pack_flags.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_issue_map as builder  # noqa: E402
import create_issue as ci  # noqa: E402


def test_load_seed_tuple_and_dict() -> None:
    raw = {
        "1-1-see-this-runs-uncommitted-files": [
            "See this run's uncommitted files",
            [],
        ],
        "1-2-open-a-changed-file-in-the-shared-viewer": {
            "title": "Open a changed file in the shared viewer",
            "blocked_by": ["1-1-see-this-runs-uncommitted-files"],
        },
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(raw, fh)
        path = Path(fh.name)
    try:
        seed = builder.load_seed(path)
        assert seed["1-1-see-this-runs-uncommitted-files"] == (
            "See this run's uncommitted files",
            [],
        )
        assert seed["1-2-open-a-changed-file-in-the-shared-viewer"] == (
            "Open a changed file in the shared viewer",
            ["1-1-see-this-runs-uncommitted-files"],
        )
        assert builder.load_seed(None) is builder.SEED
    finally:
        path.unlink()


def test_desired_labels_pack_and_extra() -> None:
    ci.PACK_LABEL = "archon-source-control"
    ci.EXTRA_LABELS = ["archon-source-control"]
    labels = ci.desired_labels(1, {"status": "backlog", "blocked_by": []}, {})
    assert labels == ["New Feature", "archon-source-control", "epic-1"]
    ci.PACK_LABEL = "rm-02"
    ci.EXTRA_LABELS = []
    labels = ci.desired_labels(3, {"status": "ready-for-dev", "blocked_by": []}, {})
    assert labels == ["New Feature", "rm-02", "epic-3", "status:ready"]


def test_default_body_pack_and_workflow() -> None:
    ci.MILESTONE_TAG = "SC"
    ci.SPRINT_STATUS = "_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml"
    ci.EPICS_PATH = "_bmad-output/planning-artifacts/epics-source-control/epics.md"
    ci.TARGET_REPO = "Archon"
    ci.PACK_LABEL = "archon-source-control"
    ci.WORKFLOW = "superpower-feature"
    body = ci.default_body("1-1-see-this-runs-uncommitted-files", 1, "See this run's uncommitted files", [])
    assert "- Tracker key: `1-1-see-this-runs-uncommitted-files`" in body
    assert "- Target repository: `Archon`" in body
    assert "- Pack label: `archon-source-control`" in body
    assert "Archon `superpower-feature` workflow" in body
    ci.MILESTONE_TAG = "RM-02"
    ci.SPRINT_STATUS = "_bmad-output/implementation-artifacts/rm-02/sprint-status.yaml"
    ci.EPICS_PATH = "_bmad-output/planning-artifacts/epics/epics-rm-02-plurality-headless-2026-08-25/epics.md"
    ci.TARGET_REPO = "harness-service"
    ci.PACK_LABEL = "rm-02"
    ci.WORKFLOW = ""
    rm_body = ci.default_body("3-9-launch-writes-the-one-bind-row", 3, "Launch writes the one bind row", [])
    assert "superpower-feature" not in rm_body
    assert "- Target repository: `harness-service`" in rm_body


def test_set_feature_type_skips_empty_id() -> None:
    previous = ci.FEATURE_TYPE_ID
    ci.FEATURE_TYPE_ID = ""

    def boom(*_a, **_k):
        raise AssertionError("gh must not be called when Feature type id is empty")

    old_run = ci.run
    ci.run = boom  # type: ignore[method-assign]
    try:
        ci.set_feature_type("I_unused")
    finally:
        ci.run = old_run  # type: ignore[method-assign]
        ci.FEATURE_TYPE_ID = previous


def main() -> int:
    test_load_seed_tuple_and_dict()
    print("  ok: load_seed")
    test_desired_labels_pack_and_extra()
    print("  ok: desired_labels pack")
    test_default_body_pack_and_workflow()
    print("  ok: default_body pack/workflow")
    test_set_feature_type_skips_empty_id()
    print("  ok: set_feature_type skip")
    print("all pack-flag unit cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
