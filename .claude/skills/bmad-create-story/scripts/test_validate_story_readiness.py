#!/usr/bin/env python3
"""Regression tests for validate_story_readiness.py."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate_story_readiness.py")
SPEC = importlib.util.spec_from_file_location("story_readiness", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def valid_story(*, behavior: str = "Return the selected value without mutation.", observable: str = "return-value", command: str = "bun test packages/example/src/value.test.ts") -> str:
    return f"""# Story 1.1: Safe Change

Status: draft

## Story

As a maintainer,
I want a selected value,
so that behavior stays deterministic.

## Acceptance Criteria

1. [AC-1] The operation returns the selected value without mutation.

## Story Contract

### Authority and Source Precedence

| Source | Claim | Disposition | Effect on this story |
| --- | --- | --- | --- |
| docs/architecture.md#Rules | Keep the operation deterministic. | ADOPT | Implement deterministic selection. |

### Risk Profile

- stateful: not-applicable — the operation reads an in-memory scalar only
- async-process: not-applicable — no process or asynchronous handoff exists
- cli-api: not-applicable — no CLI, HTTP, or public schema changes
- cross-package: not-applicable — one private module owns all behavior
- compatibility: not-applicable — no existing public or persisted contract changes
- security: not-applicable — no untrusted input, identity, or secret is involved

### Decision and Invariant Ledger

This table is the normative implementation authority for this story.

| ID | Source | Acceptance IDs | Required behavior | Owner or boundary | Task IDs | Surface IDs | Proof IDs | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INV-1 | docs/architecture.md#Rules | AC-1 | {behavior} | value operation | TASK-1 | SURF-1 | PROOF-1 | IMPLEMENT |

### Changed Surface Contract

| Surface ID | Classification | Module or contract | Current behavior | Required or preserved behavior | Consumers | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| SURF-1 | CHANGE | packages/example/src/value.ts | Returns the default value. | Return the selected value. | Internal value caller. | example package |

### Stateful and Persistence Contract

N/A — risk profile marks stateful not-applicable because the operation reads an in-memory scalar only.

### Async and Process Contract

N/A — risk profile marks async-process not-applicable because no asynchronous handoff exists.

### CLI and API Contract

N/A — risk profile marks cli-api not-applicable because no CLI, HTTP, or public schema changes.

### Cross-Package and Generated Contract

N/A — risk profile marks cross-package not-applicable because one private module owns all behavior.

### Compatibility Contract

N/A — risk profile marks compatibility not-applicable because no existing public contract changes.

### Security Contract

N/A — risk profile marks security not-applicable because no untrusted input or secret is involved.

## Tasks / Subtasks

- [ ] [TASK-1] Close deterministic selection (AC: AC-1; Invariants: INV-1; Surfaces: SURF-1; Proof: PROOF-1)
  - [ ] Implement deterministic selection at the operation boundary.
  - [ ] Add focused positive and negative assertions.

## Proof Plan

| Proof ID | Covers | Observable | Owning boundary | Command or test | Positive assertion | Negative or boundary assertion |
| --- | --- | --- | --- | --- | --- | --- |
| PROOF-1 | AC-1, INV-1 | {observable} | value operation | {command} | Selected value is returned. | Input and adjacent state remain unchanged. |

## Explicit Deferrals

| Deferred item | Owner | Reason | Residual risk | Follow-up trigger |
| --- | --- | --- | --- | --- |
| None | N/A | No deferral | None | N/A |

## References

- docs/architecture.md#Rules

## Dev Agent Record

### Agent Model Used

Not assigned before implementation.

### Debug Log References

None before implementation.

### Completion Notes List

None before implementation.

### File List

None before implementation.
"""


class StoryReadinessTests(unittest.TestCase):
    def validate(self, story: str, decisions: str | None = None) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as temp_dir:
            story_path = Path(temp_dir) / "1-1-safe-change.md"
            story_path.write_text(story, encoding="utf-8")
            decision_path = None
            if decisions is not None:
                decision_path = Path(temp_dir) / "technical-decisions.md"
                decision_path.write_text(decisions, encoding="utf-8")
            return MODULE.validate_story(story_path, decision_path)

    def codes(self, result: dict[str, object]) -> set[str]:
        return {finding["code"] for finding in result["findings"]}

    def test_valid_story_without_optional_decisions_passes(self) -> None:
        result = self.validate(valid_story())
        self.assertTrue(result["ok"])
        self.assertEqual(result["decision_coverage"], "not-applicable")

    def test_present_decision_must_be_covered(self) -> None:
        decisions = """---
story: 1-1-safe-change
gate: PASS
unresolvedDecisionCount: 0
---

## Decisions

### TD-001 — Exact value identity

The exact selected value must be returned.
"""
        result = self.validate(valid_story(), decisions)
        self.assertIn("TD_COVERAGE", self.codes(result))

    def test_present_decision_passes_when_normative_mappings_are_closed(self) -> None:
        decisions = """---
story: 1-1-safe-change
gate: PASS
unresolvedDecisionCount: 0
---

## Decisions

### TD-001 — Exact value identity

The exact selected value must be returned.
"""
        result = self.validate(valid_story().replace("INV-1", "TD-001"), decisions)
        self.assertTrue(result["ok"])
        self.assertEqual(result["decision_coverage"], "1/1")

    def test_worker_claim_cannot_be_proven_by_dispatch_ack(self) -> None:
        result = self.validate(
            valid_story(
                behavior="The exact detached worker claim must preserve run identity.",
                observable="dispatch-ack",
            )
        )
        self.assertIn("PROOF_TARGET", self.codes(result))

    def test_broad_suite_is_not_focused_proof(self) -> None:
        result = self.validate(valid_story(command="bun run validate"))
        self.assertIn("PROOF_BROAD_ONLY", self.codes(result))

    def test_orphan_task_and_missing_ledger_task_are_rejected(self) -> None:
        story = valid_story().replace("| TASK-1 | SURF-1 |", "| TASK-2 | SURF-1 |")
        result = self.validate(story)
        self.assertIn("LEDGER_TASK_REF", self.codes(result))
        self.assertIn("TASK_LEDGER", self.codes(result))


if __name__ == "__main__":
    unittest.main()
