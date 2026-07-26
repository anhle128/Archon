#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""Tests for the technical-decision gate validator."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "validate_decision_gate.py"


def load_validator() -> ModuleType:
    """Load the validator without requiring a package install."""
    spec = importlib.util.spec_from_file_location("validate_decision_gate", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load validator module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_validator()


def artifact(gate: str, count: int, unresolved: str = "None.") -> str:
    """Build a complete artifact fixture."""
    return f"""---
story: 3-4-example
gate: {gate}
unresolvedDecisionCount: {count}
---

## Decision Summary

The lifecycle is explicitly defined.

## Source Reconciliation

The approved plan and canonical fixture agree.

## Lifecycle and Ownership

The CLI owns validation and the worker owns execution.

## Decisions

- TD-001: Dispatch is durable before success is returned.

## Unresolved Decisions

{unresolved}

## Executable Proof Sketch

Run the real CLI, observe persisted dispatch, resume the worker, and verify terminal output.

## Downstream Handoff

Create-story must preserve TD-001 in acceptance criteria.
"""


def batch_artifact(
    gate: str,
    count: int,
    review_status: str,
    unresolved: str,
) -> str:
    """Build a batch artifact fixture."""
    return artifact(gate, count, unresolved).replace(
        f"unresolvedDecisionCount: {count}",
        f"unresolvedDecisionCount: {count}\nmode: batch\nreviewStatus: {review_status}",
    )


def finding(risk: str, identifier: str, answered: bool = False) -> str:
    """Build one structured finding block."""
    answer = (
        "\n**Answer:** Persist the dispatch before returning success.\n"
        "\n**Answer rationale:** Avoids stranded runs and matches operator expectations.\n"
        if answered
        else ""
    )
    return f"""### [{risk}] {identifier} — Dispatch ownership

**Problem:** The durable dispatch owner is not defined.

**Evidence:** The producer and consumer plans disagree.

**Impact:** A successful command can leave the run stranded.

**Suggestion:** Persist the dispatch before returning success.

**Suggestion rationale:** Durable dispatch is the only owner both plans accept.
{answer}"""


def findings_with_table(*specs: tuple) -> str:
    """Build finding blocks preceded by their matching tracking table."""
    rows = ["| TD | Severity | Title | Status |", "| --- | --- | --- | --- |"]
    blocks = []
    for spec in specs:
        risk, identifier, answered = (tuple(spec) + (False,))[:3]
        status = "answered" if answered else "pending"
        rows.append(f"| {identifier} | {risk} | Dispatch ownership | {status} |")
        blocks.append(finding(risk, identifier, answered))
    return "\n".join(rows) + "\n\n" + "\n".join(blocks)


EPIC_FIXTURE = """# Example Epic Breakdown

## Epic 2: Waits

### Story 2.6: Kind-Specific answerWait

**User Story**

As a developer, I want kind-specific waits.

**Acceptance Criteria**

- Given a wait, when answered, then the answer routes by kind.

### Story 2.7: Cancel

**User Story**

Another story body.
"""


class ValidateDecisionGateTests(unittest.TestCase):
    """Exercise gate consistency and structural validation."""

    def validate(self, content: str) -> tuple[dict[str, object], int]:
        """Validate one temporary artifact."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(content, encoding="utf-8")
            return VALIDATOR.validate_artifact(path)

    def test_valid_pass(self) -> None:
        result, exit_code = self.validate(artifact("PASS", 0))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_pass_rejects_unresolved_decisions(self) -> None:
        result, exit_code = self.validate(artifact("PASS", 1, "- TD-002: Choose dispatch owner."))
        self.assertEqual(exit_code, 1)
        self.assertIn("PASS requires unresolvedDecisionCount: 0", result["errors"])

    def test_valid_blocked(self) -> None:
        result, exit_code = self.validate(artifact("BLOCKED", 1, "- TD-002: Choose dispatch owner."))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_missing_section_fails(self) -> None:
        content = artifact("PASS", 0).replace("## Downstream Handoff", "## Handoff")
        result, exit_code = self.validate(content)
        self.assertEqual(exit_code, 1)
        self.assertIn("Missing section: ## Downstream Handoff", result["errors"])

    def test_malformed_frontmatter_is_an_error(self) -> None:
        result, exit_code = self.validate("story: 3-4-example\n")
        self.assertEqual(exit_code, 2)
        self.assertIn("Missing or malformed YAML frontmatter", result["errors"])

    def test_valid_pending_batch_review_orders_risks(self) -> None:
        unresolved = findings_with_table(("HIGH", "TD-002"), ("LOW", "TD-003"))
        result, exit_code = self.validate(batch_artifact("BLOCKED", 2, "PENDING", unresolved))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_pending_batch_review_can_block_without_problems(self) -> None:
        result, exit_code = self.validate(batch_artifact("BLOCKED", 0, "PENDING", "None."))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_batch_rejects_risk_order_drift(self) -> None:
        unresolved = findings_with_table(("LOW", "TD-002"), ("HIGH", "TD-003"))
        result, exit_code = self.validate(batch_artifact("BLOCKED", 2, "PENDING", unresolved))
        self.assertEqual(exit_code, 1)
        self.assertIn("batch problems must be ordered HIGH, MEDIUM, then LOW", result["errors"])

    def test_batch_normalization_sorts_and_derives_count(self) -> None:
        unresolved = f"{finding('LOW', 'TD-002')}\n{finding('HIGH', 'TD-003')}"
        content = batch_artifact("BLOCKED", 99, "PENDING", unresolved)
        normalized, changed, count = VALIDATOR.normalize_artifact(content)
        self.assertTrue(changed)
        self.assertEqual(count, 2)
        self.assertIn("unresolvedDecisionCount: 2", normalized)
        self.assertLess(normalized.index("[HIGH]"), normalized.index("[LOW]"))
        self.assertIn("| TD-003 | HIGH | Dispatch ownership | pending |", normalized)
        result, exit_code = self.validate(normalized)
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_normalization_marks_answered_findings_in_table(self) -> None:
        unresolved = f"{finding('HIGH', 'TD-002', answered=True)}\n{finding('LOW', 'TD-003')}"
        content = batch_artifact("BLOCKED", 0, "PENDING", unresolved)
        normalized, _, count = VALIDATOR.normalize_artifact(content)
        self.assertEqual(count, 2)
        self.assertIn("| TD-002 | HIGH | Dispatch ownership | answered |", normalized)
        self.assertIn("| TD-003 | LOW | Dispatch ownership | pending |", normalized)
        result, exit_code = self.validate(normalized)
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_structured_findings_require_tracking_table(self) -> None:
        result, exit_code = self.validate(
            batch_artifact("BLOCKED", 1, "PENDING", finding("HIGH", "TD-002"))
        )
        self.assertEqual(exit_code, 1)
        self.assertIn(
            "findings tracking table is missing above structured findings", result["errors"]
        )

    def test_tracking_table_must_match_finding_status(self) -> None:
        unresolved = findings_with_table(("HIGH", "TD-002")).replace("| pending |", "| answered |")
        result, exit_code = self.validate(batch_artifact("BLOCKED", 1, "PENDING", unresolved))
        self.assertEqual(exit_code, 1)
        self.assertIn(
            "findings tracking table does not match the finding entries", result["errors"]
        )

    def test_answer_requires_rationale_pairing(self) -> None:
        unresolved = findings_with_table(("HIGH", "TD-002", True)).replace(
            "\n**Answer rationale:** Avoids stranded runs and matches operator expectations.\n",
            "",
        )
        result, exit_code = self.validate(batch_artifact("BLOCKED", 1, "PENDING", unresolved))
        self.assertEqual(exit_code, 1)
        self.assertIn(
            "finding TD-002 must pair **Answer:** with **Answer rationale:** content",
            result["errors"],
        )

    def test_guided_structured_findings_count_with_simple_entries(self) -> None:
        unresolved = findings_with_table(("HIGH", "TD-002")) + "\n\n- TD-003: Choose recovery owner."
        result, exit_code = self.validate(artifact("BLOCKED", 2, unresolved))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_batch_normalization_rejects_unstructured_content(self) -> None:
        content = batch_artifact("BLOCKED", 1, "PENDING", "- Choose the dispatch owner.")
        with self.assertRaises(VALIDATOR.ArtifactError):
            VALIDATOR.normalize_artifact(content)

    def test_guided_normalization_derives_count(self) -> None:
        unresolved = "- TD-002: Choose dispatch owner.\n- TD-003: Choose recovery owner."
        content = artifact("BLOCKED", 99, unresolved)
        normalized, changed, count = VALIDATOR.normalize_artifact(content)
        self.assertTrue(changed)
        self.assertEqual(count, 2)
        self.assertIn("unresolvedDecisionCount: 2", normalized)
        result, exit_code = self.validate(normalized)
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_guided_normalization_rejects_unstructured_content(self) -> None:
        content = artifact("BLOCKED", 1, "Choose the dispatch owner.")
        with self.assertRaises(VALIDATOR.ArtifactError):
            VALIDATOR.normalize_artifact(content)

    def test_guided_validation_rejects_count_drift(self) -> None:
        unresolved = "- TD-002: Choose dispatch owner.\n- TD-003: Choose recovery owner."
        result, exit_code = self.validate(artifact("BLOCKED", 1, unresolved))
        self.assertEqual(exit_code, 1)
        self.assertIn(
            "unresolvedDecisionCount must match enumerated guided decisions",
            result["errors"],
        )

    def test_cli_normalize_atomically_updates_artifact(self) -> None:
        unresolved = f"{finding('LOW', 'TD-002')}\n{finding('HIGH', 'TD-003')}"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(batch_artifact("BLOCKED", 0, "PENDING", unresolved), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(path), "--normalize"],
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
            normalized = path.read_text(encoding="utf-8")
        self.assertEqual(completed.returncode, 0)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["normalized"])
        self.assertEqual(payload["derivedUnresolvedDecisionCount"], 2)
        self.assertLess(normalized.index("[HIGH]"), normalized.index("[LOW]"))

    def test_cli_normalize_derives_guided_count(self) -> None:
        unresolved = "- TD-002: Choose dispatch owner.\n- TD-003: Choose recovery owner."
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(artifact("BLOCKED", 0, unresolved), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(path), "--normalize"],
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
            normalized = path.read_text(encoding="utf-8")
        self.assertEqual(completed.returncode, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["derivedUnresolvedDecisionCount"], 2)
        self.assertIn("unresolvedDecisionCount: 2", normalized)

    def test_finding_requires_suggestion_rationale(self) -> None:
        unresolved = findings_with_table(("HIGH", "TD-002")).replace(
            "**Suggestion rationale:** Durable dispatch is the only owner both plans accept.\n",
            "",
        )
        result, exit_code = self.validate(batch_artifact("BLOCKED", 1, "PENDING", unresolved))
        self.assertEqual(exit_code, 1)
        self.assertIn(
            "finding TD-002 is missing **Suggestion rationale:** content", result["errors"]
        )

    def test_batch_pass_requires_whole_file_approval(self) -> None:
        result, exit_code = self.validate(batch_artifact("PASS", 0, "PENDING", "None."))
        self.assertEqual(exit_code, 1)
        self.assertIn("PENDING review requires gate: BLOCKED", result["errors"])

    def test_valid_batch_pass_after_whole_file_approval(self) -> None:
        result, exit_code = self.validate(batch_artifact("PASS", 0, "APPROVED", "None."))
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])

    def test_approved_batch_cannot_retain_unresolved_problems(self) -> None:
        content = batch_artifact("BLOCKED", 1, "APPROVED", findings_with_table(("HIGH", "TD-002")))
        result, exit_code = self.validate(content)
        self.assertEqual(exit_code, 1)
        self.assertIn("APPROVED batch review cannot retain unresolved problems", result["errors"])

    def test_initial_guided_artifact_is_valid_blocked_state(self) -> None:
        content = VALIDATOR.initial_artifact("3-4-example", False)
        result, exit_code = self.validate(content)
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])
        self.assertIn("unresolvedDecisionCount: 1", content)

    def test_initial_batch_artifact_is_valid_pending_state(self) -> None:
        content = VALIDATOR.initial_artifact("3-4-example", True)
        result, exit_code = self.validate(content)
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])
        self.assertIn("reviewStatus: PENDING", content)

    def test_initialize_artifact_does_not_overwrite_existing_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text("existing state\n", encoding="utf-8")
            result = VALIDATOR.initialize_artifact(path, "3-4-example", False)
            persisted = path.read_text(encoding="utf-8")
        self.assertFalse(result["created"])
        self.assertEqual(persisted, "existing state\n")

    def test_initialize_artifact_rejects_unsafe_story_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            with self.assertRaises(VALIDATOR.ArtifactError):
                VALIDATOR.initialize_artifact(path, "../outside", False)
            self.assertFalse(path.exists())

    def test_inspect_state_reports_completed_gate_memlog_and_story(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            artifact_path.write_text(artifact("PASS", 0), encoding="utf-8")
            memlog_path = artifact_path.parent / ".memlog.md"
            memlog_path.write_text(
                "- (event) started\n- (event by assistant) session complete\n",
                encoding="utf-8",
            )
            story_root = root / "stories"
            story_root.mkdir()
            (story_root / "3-4-example.md").write_text("# Story\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                story_root,
                "3-4-example",
                "revalidate",
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["statePair"]["status"], "COMPLETE")
        self.assertTrue(result["statePair"]["consistent"])
        self.assertTrue(result["artifact"]["completed"])
        self.assertTrue(result["memlog"]["sessionComplete"])
        self.assertTrue(result["storyArtifact"]["exists"])

    def test_inspect_state_reports_missing_files_without_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, exit_code = VALIDATOR.inspect_state(
                root / "gate" / "technical-decisions.md",
                root / "gate" / ".memlog.md",
                root / "stories",
                "3-4-example",
                "create",
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["statePair"]["status"], "ABSENT")
        self.assertFalse(result["artifact"]["exists"])
        self.assertFalse(result["memlog"]["exists"])
        self.assertFalse(result["storyArtifact"]["exists"])

    def test_inspect_state_rejects_completed_pass_for_another_story(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            original_artifact = artifact("PASS", 0)
            artifact_path.write_text(original_artifact, encoding="utf-8")
            memlog_path = artifact_path.parent / ".memlog.md"
            original_memlog = "- (event) session complete\n"
            memlog_path.write_text(original_memlog, encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                root / "stories",
                "9-9-other",
                "revalidate",
            )
            persisted_artifact = artifact_path.read_text(encoding="utf-8")
            persisted_memlog = memlog_path.read_text(encoding="utf-8")
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["statePair"]["consistent"])
        self.assertIn("does not match selected story", result["invariantViolations"][0])
        self.assertEqual(persisted_artifact, original_artifact)
        self.assertEqual(persisted_memlog, original_memlog)

    def test_inspect_state_rejects_blocked_gate_for_another_story(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            original_artifact = artifact("BLOCKED", 1, "- TD-002: Decide.")
            artifact_path.write_text(original_artifact, encoding="utf-8")
            memlog_path = artifact_path.parent / ".memlog.md"
            original_memlog = "- (event) started\n"
            memlog_path.write_text(original_memlog, encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                root / "stories",
                "9-9-other",
                "revalidate",
            )
            persisted_artifact = artifact_path.read_text(encoding="utf-8")
            persisted_memlog = memlog_path.read_text(encoding="utf-8")
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["statePair"]["consistent"])
        self.assertIn("does not match selected story", result["invariantViolations"][0])
        self.assertEqual(persisted_artifact, original_artifact)
        self.assertEqual(persisted_memlog, original_memlog)

    def test_inspect_state_rejects_revalidation_without_prior_subject(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, exit_code = VALIDATOR.inspect_state(
                root / "gate" / "technical-decisions.md",
                root / "gate" / ".memlog.md",
                root / "stories",
                "3-4-example",
                "revalidate",
            )
        self.assertEqual(exit_code, 1)
        self.assertTrue(result["statePair"]["consistent"])
        self.assertFalse(result["intentValid"])
        self.assertIn("revalidate requires", result["invariantViolations"][0])

    def test_inspect_state_rejects_create_for_existing_story(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            story_root = root / "stories"
            story_root.mkdir()
            (story_root / "3-4-example.md").write_text("# Story\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                root / "gate" / "technical-decisions.md",
                root / "gate" / ".memlog.md",
                story_root,
                "3-4-example",
                "create",
            )
        self.assertEqual(exit_code, 1)
        self.assertTrue(result["statePair"]["consistent"])
        self.assertFalse(result["intentValid"])
        self.assertIn("create cannot target", result["invariantViolations"][0])

    def test_inspect_state_blocks_when_only_artifact_survives(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            artifact_path.write_text(artifact("BLOCKED", 1, "- TD-002: Decide."), encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                artifact_path.parent / ".memlog.md",
                root / "stories",
                "3-4-example",
                "create",
            )
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["statePair"]["status"], "PARTIAL")
        self.assertIn("recover the missing memlog", result["invariantViolations"][0])

    def test_inspect_state_blocks_when_only_memlog_survives(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gate_root = root / "gate"
            gate_root.mkdir()
            memlog_path = gate_root / ".memlog.md"
            memlog_path.write_text("- (event) started\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                gate_root / "technical-decisions.md",
                memlog_path,
                root / "stories",
                "3-4-example",
                "create",
            )
        self.assertEqual(exit_code, 1)
        self.assertEqual(result["statePair"]["status"], "PARTIAL")
        self.assertIn("recover the missing artifact", result["invariantViolations"][0])

    def test_inspect_state_rejects_pass_without_completion_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            artifact_path.write_text(artifact("PASS", 0), encoding="utf-8")
            memlog_path = artifact_path.parent / ".memlog.md"
            memlog_path.write_text("- (event) started\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                root / "stories",
                "3-4-example",
                "revalidate",
            )
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["statePair"]["consistent"])
        self.assertIn("Completion state contradicts", result["invariantViolations"][0])

    def test_inspect_state_rejects_completion_event_for_blocked_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            artifact_path.write_text(artifact("BLOCKED", 1, "- TD-002: Decide."), encoding="utf-8")
            memlog_path = artifact_path.parent / ".memlog.md"
            memlog_path.write_text("- (event) session complete\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                root / "stories",
                "3-4-example",
                "revalidate",
            )
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["artifact"]["completed"])
        self.assertTrue(result["memlog"]["sessionComplete"])

    def test_inspect_state_rejects_completion_event_for_invalid_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            artifact_path.parent.mkdir()
            artifact_path.write_text(
                artifact("PASS", 1, "- TD-002: Still unresolved."),
                encoding="utf-8",
            )
            memlog_path = artifact_path.parent / ".memlog.md"
            memlog_path.write_text("- (event) session complete\n", encoding="utf-8")
            result, exit_code = VALIDATOR.inspect_state(
                artifact_path,
                memlog_path,
                root / "stories",
                "3-4-example",
                "revalidate",
            )
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["artifact"]["valid"])
        self.assertFalse(result["artifact"]["completed"])
        self.assertIn("Artifact fails validation", result["invariantViolations"][0])

    def test_begin_revalidation_atomically_blocks_and_resets_approval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(
                batch_artifact("PASS", 0, "APPROVED", "None."),
                encoding="utf-8",
            )
            result = VALIDATOR.begin_revalidation(path, True)
            persisted = path.read_text(encoding="utf-8")
        self.assertTrue(result["changed"])
        self.assertEqual(result["previousGate"], "PASS")
        self.assertEqual(result["gate"], "BLOCKED")
        self.assertEqual(result["reviewStatus"], "PENDING")
        self.assertIn("gate: BLOCKED", persisted)
        self.assertIn("reviewStatus: PENDING", persisted)

    def test_begin_revalidation_preserves_unaffected_batch_approval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(
                batch_artifact("PASS", 0, "APPROVED", "None."),
                encoding="utf-8",
            )
            result = VALIDATOR.begin_revalidation(path, False)
        self.assertEqual(result["gate"], "BLOCKED")
        self.assertEqual(result["reviewStatus"], "APPROVED")

    def test_cli_begin_revalidation_emits_transition_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "technical-decisions.md"
            path.write_text(artifact("PASS", 0), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(path), "--begin-revalidation"],
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
        self.assertEqual(completed.returncode, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["gate"], "BLOCKED")

    def test_cli_python_fallback_initializes_and_inspects_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            memlog_path = artifact_path.parent / ".memlog.md"
            story_root = root / "stories"
            initialized = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    str(artifact_path),
                    "--init",
                    "--story",
                    "3-4-example",
                    "--batch",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            memlog_path.write_text("- (event) started\n", encoding="utf-8")
            story_root.mkdir()
            inspected = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    str(artifact_path),
                    "--inspect",
                    "--memlog",
                    str(memlog_path),
                    "--story-root",
                    str(story_root),
                    "--story-key",
                    "3-4-example",
                    "--intent",
                    "create",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            initialized_payload = json.loads(initialized.stdout)
            inspected_payload = json.loads(inspected.stdout)
        self.assertEqual(initialized.returncode, 0)
        self.assertTrue(initialized_payload["created"])
        self.assertEqual(inspected.returncode, 0)
        self.assertTrue(inspected_payload["artifact"]["exists"])
        self.assertTrue(inspected_payload["memlog"]["exists"])

    def test_cli_rejects_batch_headless_without_creating_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_path = root / "gate" / "technical-decisions.md"
            memlog_path = artifact_path.parent / ".memlog.md"
            story_root = root / "stories"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    str(artifact_path),
                    "--inspect",
                    "--memlog",
                    str(memlog_path),
                    "--story-root",
                    str(story_root),
                    "--story-key",
                    "3-4-example",
                    "--intent",
                    "create",
                    "--batch",
                    "--headless",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
            artifact_parent_exists = artifact_path.parent.exists()
            story_root_exists = story_root.exists()
        self.assertEqual(completed.returncode, 2)
        self.assertFalse(payload["ok"])
        self.assertIn("mutually exclusive", payload["errors"][0])
        self.assertFalse(artifact_parent_exists)
        self.assertFalse(story_root_exists)

    HEADING = "### Story 2.6: Kind-Specific answerWait"

    def apply_fixture(self, directory: str, content: str) -> tuple[Path, Path]:
        """Write one artifact and one epic fixture into a temporary directory."""
        root = Path(directory)
        artifact_path = root / "technical-decisions.md"
        artifact_path.write_text(content, encoding="utf-8")
        epic_path = root / "epics-example.md"
        epic_path.write_text(EPIC_FIXTURE, encoding="utf-8")
        return artifact_path, epic_path

    def test_apply_inserts_marker_block_into_story_section(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(directory, artifact("PASS", 0))
            result = VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
            epic_text = epic_path.read_text(encoding="utf-8")
        self.assertTrue(result["ok"])
        self.assertFalse(result["replaced"])
        self.assertEqual(result["decisionCount"], 1)
        begin = "<!-- decision-gate:begin 3-4-example -->"
        self.assertIn(begin, epic_text)
        self.assertIn("**Technical Decisions**", epic_text)
        self.assertIn("TD-001: Dispatch is durable before success is returned.", epic_text)
        self.assertLess(epic_text.index("Acceptance Criteria"), epic_text.index(begin))
        self.assertLess(epic_text.index(begin), epic_text.index("### Story 2.7"))

    def test_apply_replaces_existing_block_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(directory, artifact("PASS", 0))
            VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
            first_epic = epic_path.read_text(encoding="utf-8")
            result = VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
            second_epic = epic_path.read_text(encoding="utf-8")
        self.assertTrue(result["ok"])
        self.assertTrue(result["replaced"])
        self.assertFalse(result["changed"])
        self.assertEqual(first_epic, second_epic)
        self.assertEqual(second_epic.count("decision-gate:begin"), 1)

    def test_apply_refuses_blocked_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(
                directory, artifact("BLOCKED", 1, "- TD-002: Decide.")
            )
            result = VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
            epic_text = epic_path.read_text(encoding="utf-8")
        self.assertFalse(result["ok"])
        self.assertIn("apply requires gate: PASS", result["errors"])
        self.assertEqual(epic_text, EPIC_FIXTURE)

    def test_apply_refuses_unapproved_batch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(
                directory, batch_artifact("PASS", 0, "PENDING", "None.")
            )
            result = VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
        self.assertFalse(result["ok"])
        self.assertIn("apply requires reviewStatus: APPROVED for batch artifacts", result["errors"])

    def test_apply_requires_unique_story_heading(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(directory, artifact("PASS", 0))
            epic_path.write_text(EPIC_FIXTURE + f"\n{self.HEADING}\n", encoding="utf-8")
            result = VALIDATOR.apply_decisions(artifact_path, epic_path, self.HEADING)
        self.assertFalse(result["ok"])
        self.assertIn("story heading must appear exactly once in the epic, found 2", result["errors"])

    def test_cli_apply_emits_stable_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact_path, epic_path = self.apply_fixture(directory, artifact("PASS", 0))
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    str(artifact_path),
                    "--apply",
                    "--epic",
                    str(epic_path),
                    "--story-heading",
                    self.HEADING,
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(completed.stdout)
        self.assertEqual(completed.returncode, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["action"], "apply")
        self.assertEqual(payload["story"], "3-4-example")


if __name__ == "__main__":
    unittest.main()
