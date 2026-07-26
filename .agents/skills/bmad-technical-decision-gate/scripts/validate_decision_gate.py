#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""Validate a story technical-decision gate artifact."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = ("story", "gate", "unresolvedDecisionCount")
REQUIRED_SECTIONS = (
    "Decision Summary",
    "Source Reconciliation",
    "Lifecycle and Ownership",
    "Decisions",
    "Unresolved Decisions",
    "Executable Proof Sketch",
    "Downstream Handoff",
)
BATCH_RISK_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
FINDING_REQUIRED_LABELS = ("Problem", "Evidence", "Impact", "Suggestion", "Suggestion rationale")
FINDING_ANSWER_LABELS = ("Answer", "Answer rationale")
FINDING_BLOCK_PATTERN = re.compile(
    r"(?ms)^### \[(HIGH|MEDIUM|LOW)\]\s+(TD-[A-Za-z0-9_.]+)([^\n]*)\n(.*?)(?=^### \[|^[-*]\s+TD-|\Z)"
)
SIMPLE_PROBLEM_PATTERN = re.compile(r"(?m)^(?:[-*]\s+|###\s+)TD-[^\n]+")
TABLE_HEADER = "| TD | Severity | Title | Status |"
TABLE_SEPARATOR = "| --- | --- | --- | --- |"
APPLY_BEGIN_TEMPLATE = "<!-- decision-gate:begin {story} -->"
APPLY_END_TEMPLATE = "<!-- decision-gate:end {story} -->"
MEMLOG_EVENT_PATTERN = re.compile(r"^\s*-\s+\(event(?: by [^)]+)?\)\s+(.+?)\s*$")


class ArtifactError(Exception):
    """Signal that the artifact cannot be parsed reliably."""


def parse_frontmatter(text: str) -> dict[str, str]:
    """Parse the flat YAML frontmatter contract used by this artifact."""
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if match is None:
        raise ArtifactError("Missing or malformed YAML frontmatter")

    fields: dict[str, str] = {}
    for line_number, raw_line in enumerate(match.group(1).splitlines(), start=2):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ArtifactError(f"Invalid frontmatter line {line_number}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if not key or not value:
            raise ArtifactError(f"Empty frontmatter key or value on line {line_number}")
        fields[key] = value
    return fields


def section_body(text: str, section: str) -> str | None:
    """Return a level-two section body, or None when the heading is absent."""
    pattern = rf"(?ms)^## {re.escape(section)}\s*$\n(.*?)(?=^## |\Z)"
    match = re.search(pattern, text)
    return match.group(1).strip() if match is not None else None


def label_has_content(body: str, label: str) -> bool:
    """Return whether one bold label line carries non-empty content."""
    return re.search(rf"(?m)^\*\*{re.escape(label)}:\*\*\s*\S", body) is not None


def finding_entries(body: str) -> list[dict[str, str]]:
    """Parse structured finding blocks into severity, id, title, status, and text."""
    entries: list[dict[str, str]] = []
    for match in FINDING_BLOCK_PATTERN.finditer(body):
        severity, identifier, title_tail, block_body = match.groups()
        title = re.sub(r"^\s*(?:—|--|-)\s*", "", title_tail).strip()
        answered = all(label_has_content(block_body, label) for label in FINDING_ANSWER_LABELS)
        entries.append(
            {
                "severity": severity,
                "id": identifier,
                "title": title,
                "status": "answered" if answered else "pending",
                "body": block_body.strip(),
                "block": match.group(0).strip(),
            }
        )
    return entries


def simple_problem_entries(body: str) -> list[str]:
    """Return the enumerated plain unresolved entries outside structured findings."""
    without_blocks = FINDING_BLOCK_PATTERN.sub("", body)
    return [match.group(0) for match in SIMPLE_PROBLEM_PATTERN.finditer(without_blocks)]


def finding_table(entries: list[dict[str, str]]) -> str:
    """Derive the findings tracking table from parsed finding entries."""
    rows = [TABLE_HEADER, TABLE_SEPARATOR]
    for entry in entries:
        rows.append(
            f"| {entry['id']} | {entry['severity']} | {entry['title']} | {entry['status']} |"
        )
    return "\n".join(rows)


def split_leading_table(body: str) -> tuple[str, str]:
    """Split one leading pipe table from the rest of a section body."""
    match = re.match(r"\s*((?:\|[^\n]*(?:\n|\Z))+)", body)
    if match is None:
        return "", body.strip()
    return match.group(1).strip(), body[match.end() :].strip()


def table_rows(table_text: str) -> list[tuple[str, ...]]:
    """Return the data rows of a pipe table as stripped cell tuples."""
    rows: list[tuple[str, ...]] = []
    for line in table_text.splitlines():
        cells = tuple(cell.strip() for cell in line.strip().strip("|").split("|"))
        if not cells or all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        if cells[0].upper() == "TD":
            continue
        rows.append(cells)
    return rows


def is_none_marker(body: str) -> bool:
    """Return whether a section body explicitly represents no entries."""
    normalized = re.sub(r"[\s.*_`-]", "", body).lower()
    return normalized in {"none", "none.", "0"}


def replace_frontmatter_value(text: str, key: str, value: str) -> str:
    """Replace one required flat frontmatter value while preserving other fields."""
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if match is None:
        raise ArtifactError("Missing or malformed YAML frontmatter")
    frontmatter = match.group(1)
    pattern = rf"(?m)^{re.escape(key)}\s*:\s*.*$"
    if re.search(pattern, frontmatter) is None:
        raise ArtifactError(f"Missing frontmatter field: {key}")
    updated = re.sub(pattern, f"{key}: {value}", frontmatter, count=1)
    start, end = match.span(1)
    return f"{text[:start]}{updated}{text[end:]}"


def replace_section_body(text: str, section: str, body: str) -> str:
    """Replace one level-two section body while preserving the document order."""
    pattern = rf"(?ms)(^## {re.escape(section)}\s*$\n)(.*?)(?=^## |\Z)"
    match = re.search(pattern, text)
    if match is None:
        raise ArtifactError(f"Missing section: ## {section}")
    start, end = match.span(2)
    return f"{text[:start]}\n{body.strip()}\n\n{text[end:]}"


def normalize_artifact(text: str) -> tuple[str, bool, int]:
    """Derive unresolved counts, sort findings, and regenerate the tracking table."""
    fields = parse_frontmatter(text)
    unresolved_body = section_body(text, "Unresolved Decisions")
    if unresolved_body is None:
        raise ArtifactError("Missing section: ## Unresolved Decisions")

    is_batch = fields.get("mode") == "batch"
    _, rest = split_leading_table(unresolved_body)
    entries = finding_entries(rest)
    entries.sort(key=lambda entry: BATCH_RISK_ORDER[entry["severity"]])
    simple = simple_problem_entries(rest)
    leftovers = SIMPLE_PROBLEM_PATTERN.sub("", FINDING_BLOCK_PATTERN.sub("", rest)).strip()

    if is_batch:
        if simple or (leftovers and not is_none_marker(leftovers)):
            raise ArtifactError("Batch Unresolved Decisions contains unstructured content")
        count = len(entries)
    else:
        if not entries and not simple and not is_none_marker(rest):
            raise ArtifactError("Guided Unresolved Decisions contains unstructured content")
        count = len(entries) + len(simple)

    normalized = replace_frontmatter_value(text, "unresolvedDecisionCount", str(count))
    if entries:
        parts = [finding_table(entries)]
        parts.extend(entry["block"] for entry in entries)
        trailing = FINDING_BLOCK_PATTERN.sub("", rest).strip()
        if trailing and not is_none_marker(trailing):
            parts.append(trailing)
        normalized = replace_section_body(normalized, "Unresolved Decisions", "\n\n".join(parts))
    elif is_batch:
        normalized = replace_section_body(normalized, "Unresolved Decisions", "None.")
    return normalized, normalized != text, count


def write_text_atomic(path: Path, text: str) -> None:
    """Atomically replace a UTF-8 text file in its existing directory."""
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def initial_artifact(story: str, batch: bool) -> str:
    """Build the deterministic working skeleton for a new gate."""
    batch_fields = "mode: batch\nreviewStatus: PENDING\n" if batch else ""
    count = 0 if batch else 1
    unresolved = "None." if batch else "- TD-INIT: Complete technical decision discovery."
    return f"""---
story: {story}
gate: BLOCKED
unresolvedDecisionCount: {count}
{batch_fields}---

## Decision Summary

Pending evidence reconciliation.

## Source Reconciliation

Pending evidence reconciliation.

## Lifecycle and Ownership

Pending lifecycle reconciliation.

## Decisions

None yet.

## Unresolved Decisions

{unresolved}

## Executable Proof Sketch

Pending technical decisions.

## Downstream Handoff

Blocked until the gate passes.
"""


def initialize_artifact(path: Path, story: str, batch: bool) -> dict[str, Any]:
    """Create a missing working artifact without overwriting existing state."""
    safe_story_artifact_path(Path("."), story)
    if path.exists():
        return {
            "ok": True,
            "action": "init",
            "path": str(path),
            "created": False,
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, initial_artifact(story, batch))
    return {
        "ok": True,
        "action": "init",
        "path": str(path),
        "created": True,
    }


def last_memlog_event(text: str) -> str | None:
    """Return the final typed event entry from an append-only memlog."""
    for line in reversed(text.splitlines()):
        match = MEMLOG_EVENT_PATTERN.match(line)
        if match is not None:
            return match.group(1)
    return None


def safe_story_artifact_path(story_root: Path, story_key: str) -> Path:
    """Resolve one exact story filename without accepting path traversal."""
    if not story_key or Path(story_key).name != story_key or story_key in {".", ".."}:
        raise ArtifactError("story key must be a filesystem-safe filename stem")
    return story_root / f"{story_key}.md"


def inspect_state(
    artifact_path: Path,
    memlog_path: Path,
    story_root: Path,
    story_key: str,
    intent: str,
) -> tuple[dict[str, Any], int]:
    """Inspect durable gate state and emit compact machine-readable facts."""
    errors: list[str] = []
    state_pair_violations: list[str] = []
    intent_violations: list[str] = []
    fields: dict[str, str] | None = None
    artifact_validation: dict[str, Any] | None = None
    artifact_exists = artifact_path.is_file()
    if artifact_exists:
        try:
            fields = parse_frontmatter(artifact_path.read_text(encoding="utf-8"))
        except (ArtifactError, OSError) as error:
            errors.append(f"Cannot inspect artifact: {error}")
        artifact_validation, validation_exit_code = validate_artifact(artifact_path)
        if validation_exit_code == 2:
            errors.extend(str(error) for error in artifact_validation["errors"])
        elif validation_exit_code == 1:
            state_pair_violations.append(
                "Artifact fails validation: " + "; ".join(artifact_validation["errors"])
            )

    memlog_exists = memlog_path.is_file()
    final_event: str | None = None
    if memlog_exists:
        try:
            final_event = last_memlog_event(memlog_path.read_text(encoding="utf-8"))
        except OSError as error:
            errors.append(f"Cannot inspect memlog: {error}")
    session_complete = final_event is not None and final_event.strip().lower() == "session complete"

    if artifact_exists == memlog_exists:
        state_pair_status = "COMPLETE" if artifact_exists else "ABSENT"
    else:
        state_pair_status = "PARTIAL"
        missing = "memlog" if artifact_exists else "artifact"
        state_pair_violations.append(
            f"State pair is partial: preserve existing state and recover the missing {missing}"
        )

    validated_pass = (
        artifact_validation is not None
        and bool(artifact_validation.get("ok"))
        and artifact_validation.get("gate") == "PASS"
    )
    if state_pair_status == "COMPLETE" and not errors and session_complete != validated_pass:
        state_pair_violations.append(
            "Completion state contradicts the validated artifact and final memlog event"
        )
    if fields is not None:
        artifact_story = fields.get("story")
        if artifact_story is not None and artifact_story != story_key:
            state_pair_violations.append(
                f"Artifact story identity {artifact_story!r} does not match selected story {story_key!r}"
            )

    try:
        story_artifact_path = safe_story_artifact_path(story_root, story_key)
    except ArtifactError as error:
        errors.append(str(error))
        story_artifact_path = None
    story_artifact_exists = (
        story_artifact_path.is_file() if story_artifact_path is not None else False
    )

    if intent == "revalidate" and not artifact_exists and not story_artifact_exists:
        intent_violations.append(
            "revalidate requires an existing gate or story artifact; use --intent create"
        )
    if intent == "create" and story_artifact_exists:
        intent_violations.append(
            "create cannot target an existing story; use --intent revalidate or $validate-story"
        )
    invariant_violations = state_pair_violations + intent_violations

    result: dict[str, Any] = {
        "ok": not errors and not invariant_violations,
        "action": "inspect",
        "intent": intent,
        "statePair": {
            "status": state_pair_status,
            "consistent": not state_pair_violations,
        },
        "intentValid": not intent_violations,
        "artifact": {
            "path": str(artifact_path),
            "exists": artifact_exists,
            "fields": fields,
            "valid": artifact_validation is not None and bool(artifact_validation.get("ok")),
            "completed": validated_pass,
            "validationErrors": artifact_validation.get("errors", [])
            if artifact_validation is not None
            else [],
        },
        "memlog": {
            "path": str(memlog_path),
            "exists": memlog_exists,
            "lastEvent": final_event,
            "sessionComplete": session_complete,
        },
        "storyArtifact": {
            "path": str(story_artifact_path) if story_artifact_path is not None else None,
            "exists": story_artifact_exists,
        },
        "errors": errors + invariant_violations,
        "invariantViolations": invariant_violations,
    }
    if errors:
        return result, 2
    return result, 1 if invariant_violations else 0


def begin_revalidation(path: Path, approved_content_affected: bool) -> dict[str, Any]:
    """Atomically invalidate completion metadata before revalidation work."""
    source = path.read_text(encoding="utf-8")
    fields = parse_frontmatter(source)
    previous_gate = fields.get("gate")
    previous_review_status = fields.get("reviewStatus")

    updated = replace_frontmatter_value(source, "gate", "BLOCKED")
    if fields.get("mode") == "batch" and approved_content_affected:
        updated = replace_frontmatter_value(updated, "reviewStatus", "PENDING")
    changed = updated != source
    if changed:
        write_text_atomic(path, updated)

    updated_fields = parse_frontmatter(updated)
    return {
        "ok": True,
        "action": "begin-revalidation",
        "path": str(path),
        "changed": changed,
        "previousGate": previous_gate,
        "gate": updated_fields.get("gate"),
        "previousReviewStatus": previous_review_status,
        "reviewStatus": updated_fields.get("reviewStatus"),
    }


def apply_decisions(artifact_path: Path, epic_path: Path, story_heading: str) -> dict[str, Any]:
    """Write the approved decisions into the owning epic's marker-delimited block."""
    text = artifact_path.read_text(encoding="utf-8")
    fields = parse_frontmatter(text)
    errors: list[str] = []
    if fields.get("gate") != "PASS":
        errors.append("apply requires gate: PASS")
    if fields.get("mode") == "batch" and fields.get("reviewStatus") != "APPROVED":
        errors.append("apply requires reviewStatus: APPROVED for batch artifacts")
    story = fields.get("story")
    if not story:
        errors.append("apply requires a story frontmatter field")
    decisions_body = section_body(text, "Decisions")
    if not decisions_body or is_none_marker(decisions_body):
        errors.append("apply requires a non-empty ## Decisions section")

    epic_text = epic_path.read_text(encoding="utf-8")
    heading = story_heading.strip()
    heading_matches = list(re.finditer(rf"(?m)^{re.escape(heading)}\s*$", epic_text))
    if len(heading_matches) != 1:
        errors.append(
            f"story heading must appear exactly once in the epic, found {len(heading_matches)}"
        )
    if errors:
        return {
            "ok": False,
            "action": "apply",
            "path": str(epic_path),
            "errors": errors,
            "warnings": [],
            "exitCode": 1,
        }

    begin = APPLY_BEGIN_TEMPLATE.format(story=story)
    end = APPLY_END_TEMPLATE.format(story=story)
    block = f"{begin}\n\n**Technical Decisions**\n\n{decisions_body.strip()}\n\n{end}"
    decision_count = len(
        re.findall(r"(?m)^(?:[-*]\s+|###\s+(?:\[(?:HIGH|MEDIUM|LOW)\]\s+)?)TD-", decisions_body)
    )

    begin_index = epic_text.find(begin)
    end_index = epic_text.find(end)
    if (begin_index == -1) != (end_index == -1) or (begin_index != -1 and end_index < begin_index):
        return {
            "ok": False,
            "action": "apply",
            "path": str(epic_path),
            "errors": ["apply markers are unpaired in the epic; repair them before applying"],
            "warnings": [],
            "exitCode": 1,
        }

    if begin_index != -1:
        updated = f"{epic_text[:begin_index]}{block}{epic_text[end_index + len(end):]}"
        replaced = True
    else:
        heading_match = heading_matches[0]
        section_end_match = re.compile(r"(?m)^#{1,3} ").search(epic_text, heading_match.end())
        insert_at = section_end_match.start() if section_end_match is not None else len(epic_text)
        section = epic_text[heading_match.end() : insert_at].rstrip("\n")
        updated = (
            f"{epic_text[: heading_match.end()]}{section}\n\n{block}\n\n{epic_text[insert_at:]}"
        )
        replaced = False

    changed = updated != epic_text
    if changed:
        write_text_atomic(epic_path, updated)
    return {
        "ok": True,
        "action": "apply",
        "path": str(epic_path),
        "story": story,
        "replaced": replaced,
        "changed": changed,
        "decisionCount": decision_count,
    }


def validate_artifact(path: Path) -> tuple[dict[str, Any], int]:
    """Return a machine-readable validation result and its process exit code."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return {
            "ok": False,
            "path": str(path),
            "gate": None,
            "errors": [f"Cannot read artifact: {error}"],
            "warnings": [],
        }, 2

    try:
        fields = parse_frontmatter(text)
    except ArtifactError as error:
        return {
            "ok": False,
            "path": str(path),
            "gate": None,
            "errors": [str(error)],
            "warnings": [],
        }, 2

    errors: list[str] = []
    warnings: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in fields:
            errors.append(f"Missing frontmatter field: {field}")

    gate = fields.get("gate")
    if gate not in {"PASS", "BLOCKED"}:
        errors.append("gate must be PASS or BLOCKED")

    unresolved_count: int | None = None
    raw_count = fields.get("unresolvedDecisionCount")
    if raw_count is not None:
        try:
            unresolved_count = int(raw_count)
            if unresolved_count < 0:
                errors.append("unresolvedDecisionCount cannot be negative")
        except ValueError:
            errors.append("unresolvedDecisionCount must be an integer")

    mode = fields.get("mode")
    review_status = fields.get("reviewStatus")
    is_batch = mode == "batch"
    if is_batch and review_status not in {"PENDING", "APPROVED"}:
        errors.append("batch mode requires reviewStatus: PENDING or APPROVED")
    if review_status == "PENDING" and gate != "BLOCKED":
        errors.append("PENDING review requires gate: BLOCKED")
    if is_batch and gate == "PASS" and review_status != "APPROVED":
        errors.append("batch PASS requires reviewStatus: APPROVED")

    bodies: dict[str, str | None] = {}
    for section in REQUIRED_SECTIONS:
        body = section_body(text, section)
        bodies[section] = body
        if body is None:
            errors.append(f"Missing section: ## {section}")
        elif not body:
            errors.append(f"Section is empty: ## {section}")

    if gate == "PASS" and unresolved_count not in {None, 0}:
        errors.append("PASS requires unresolvedDecisionCount: 0")
    pending_batch_review = is_batch and review_status == "PENDING"
    if (
        gate == "BLOCKED"
        and unresolved_count is not None
        and unresolved_count < 1
        and not pending_batch_review
    ):
        errors.append("BLOCKED requires at least one unresolved decision")

    unresolved_body = bodies.get("Unresolved Decisions")
    if gate == "PASS" and unresolved_body is not None:
        if not is_none_marker(unresolved_body):
            errors.append("PASS requires the Unresolved Decisions section to state only None")
    if gate == "BLOCKED" and unresolved_body is not None and unresolved_count != 0:
        has_item = bool(re.search(r"(?m)^(?:[-*] |### )", unresolved_body))
        if not has_item:
            errors.append("BLOCKED requires an enumerated unresolved decision")

    if unresolved_body is not None and unresolved_count is not None:
        table_text, rest = split_leading_table(unresolved_body)
        entries = finding_entries(rest)
        simple = simple_problem_entries(rest)
        for entry in entries:
            for label in FINDING_REQUIRED_LABELS:
                if not label_has_content(entry["body"], label):
                    errors.append(f"finding {entry['id']} is missing **{label}:** content")
            answer_states = [label_has_content(entry["body"], label) for label in FINDING_ANSWER_LABELS]
            if any(answer_states) and not all(answer_states):
                errors.append(
                    f"finding {entry['id']} must pair **Answer:** with **Answer rationale:** content"
                )
        if entries:
            if not table_text:
                errors.append("findings tracking table is missing above structured findings")
            elif table_rows(table_text) != table_rows(finding_table(entries)):
                errors.append("findings tracking table does not match the finding entries")
        elif table_text:
            errors.append("findings tracking table is present without structured findings")
        if is_batch:
            if unresolved_count != len(entries):
                errors.append("batch unresolvedDecisionCount must match structured problem entries")
            risks = [BATCH_RISK_ORDER[entry["severity"]] for entry in entries]
            if risks != sorted(risks):
                errors.append("batch problems must be ordered HIGH, MEDIUM, then LOW")
        else:
            if is_none_marker(unresolved_body):
                derived_count = 0
            elif entries or simple:
                derived_count = len(entries) + len(simple)
            else:
                derived_count = None
                errors.append("Guided Unresolved Decisions contains unstructured content")
            if derived_count is not None and unresolved_count != derived_count:
                errors.append("unresolvedDecisionCount must match enumerated guided decisions")
    if is_batch and review_status == "APPROVED" and unresolved_count not in {None, 0}:
        errors.append("APPROVED batch review cannot retain unresolved problems")

    result: dict[str, Any] = {
        "ok": not errors,
        "path": str(path),
        "gate": gate,
        "errors": errors,
        "warnings": warnings,
    }
    return result, 0 if not errors else 1


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path, help="technical-decisions.md state path")
    parser.add_argument("-o", "--output", type=Path, help="also write the JSON result here")
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--inspect",
        action="store_true",
        help="inspect artifact, memlog, and exact story-artifact state",
    )
    action.add_argument(
        "--init",
        action="store_true",
        help="create a missing working artifact without overwriting existing state",
    )
    action.add_argument(
        "--begin-revalidation",
        action="store_true",
        help="atomically set gate BLOCKED before revalidation",
    )
    action.add_argument(
        "--apply",
        action="store_true",
        help="write approved decisions into the owning epic's marker-delimited block",
    )
    parser.add_argument(
        "--normalize",
        action="store_true",
        help="derive unresolvedDecisionCount and stably sort batch problems before validation",
    )
    parser.add_argument("--memlog", type=Path, help="memlog path required by --inspect")
    parser.add_argument("--story-root", type=Path, help="story artifact directory for --inspect")
    parser.add_argument("--story-key", help="filesystem-safe story key for --inspect")
    parser.add_argument(
        "--intent",
        choices=("create", "revalidate"),
        help="accepted gate intent required by --inspect",
    )
    parser.add_argument("--story", help="story value required by --init")
    parser.add_argument("--epic", type=Path, help="epic file path required by --apply")
    parser.add_argument(
        "--story-heading",
        help="exact epic story heading line required by --apply",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="select batch mode and initialize a batch artifact with --init",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="assert headless mode for invocation-conflict validation",
    )
    parser.add_argument(
        "--approved-content-affected",
        action="store_true",
        help="reset batch approval while beginning revalidation",
    )
    parser.add_argument("--verbose", action="store_true", help="emit diagnostics to stderr")
    return parser


def emit_result(result: dict[str, Any], output: Path | None, verbose: bool) -> int:
    """Emit one JSON result and return its declared exit code."""
    exit_code = int(result.pop("exitCode", 0 if result.get("ok") else 1))
    payload = json.dumps(result, ensure_ascii=False, sort_keys=True)
    print(payload)

    if output is not None:
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            write_text_atomic(output, f"{payload}\n")
        except OSError as error:
            print(f"Cannot write output: {error}", file=sys.stderr)
            return 2

    if verbose:
        status = "passed" if result.get("ok") else "failed"
        print(f"{result.get('action', 'validation')} {status} for {result.get('path')}", file=sys.stderr)
        for warning in result.get("warnings", []):
            print(f"warning: {warning}", file=sys.stderr)
        for error in result.get("errors", []):
            print(f"error: {error}", file=sys.stderr)
    return exit_code


def action_error(action: str, path: Path, message: str) -> dict[str, Any]:
    """Build one stable action-error payload."""
    return {
        "ok": False,
        "action": action,
        "path": str(path),
        "errors": [message],
        "warnings": [],
        "exitCode": 2,
    }


def main() -> int:
    """Run validation and emit a stable JSON result."""
    args = build_parser().parse_args()
    if args.batch and args.headless:
        result = action_error(
            "arguments",
            args.artifact,
            "--batch and --headless are mutually exclusive",
        )
        return emit_result(result, args.output, args.verbose)

    action_selected = args.inspect or args.init or args.begin_revalidation or args.apply
    if action_selected and args.normalize:
        result = action_error("arguments", args.artifact, "--normalize cannot be combined with a state action")
        return emit_result(result, args.output, args.verbose)

    if args.inspect:
        if (
            args.memlog is None
            or args.story_root is None
            or args.story_key is None
            or args.intent is None
        ):
            result = action_error(
                "inspect",
                args.artifact,
                "--inspect requires --memlog, --story-root, --story-key, and --intent",
            )
            return emit_result(result, args.output, args.verbose)
        result, exit_code = inspect_state(
            args.artifact,
            args.memlog,
            args.story_root,
            args.story_key,
            args.intent,
        )
        result["exitCode"] = exit_code
        return emit_result(result, args.output, args.verbose)

    if args.init:
        if args.story is None:
            result = action_error("init", args.artifact, "--init requires --story")
            return emit_result(result, args.output, args.verbose)
        try:
            result = initialize_artifact(args.artifact, args.story, args.batch)
        except (ArtifactError, OSError) as error:
            result = action_error("init", args.artifact, f"Cannot initialize artifact: {error}")
        return emit_result(result, args.output, args.verbose)

    if args.begin_revalidation:
        try:
            result = begin_revalidation(args.artifact, args.approved_content_affected)
        except (ArtifactError, OSError) as error:
            result = action_error("begin-revalidation", args.artifact, f"Cannot begin revalidation: {error}")
        return emit_result(result, args.output, args.verbose)

    if args.apply:
        if args.epic is None or args.story_heading is None:
            result = action_error("apply", args.artifact, "--apply requires --epic and --story-heading")
            return emit_result(result, args.output, args.verbose)
        try:
            result = apply_decisions(args.artifact, args.epic, args.story_heading)
        except (ArtifactError, OSError) as error:
            result = action_error("apply", args.artifact, f"Cannot apply decisions: {error}")
        return emit_result(result, args.output, args.verbose)

    normalized = False
    derived_count: int | None = None
    if args.normalize:
        try:
            source = args.artifact.read_text(encoding="utf-8")
            updated, normalized, derived_count = normalize_artifact(source)
            if normalized:
                write_text_atomic(args.artifact, updated)
        except (ArtifactError, OSError) as error:
            result = {
                "ok": False,
                "path": str(args.artifact),
                "gate": None,
                "errors": [f"Cannot normalize artifact: {error}"],
                "warnings": [],
                "normalized": False,
                "exitCode": 2,
            }
            return emit_result(result, args.output, args.verbose)

    result, exit_code = validate_artifact(args.artifact)
    result["normalized"] = normalized
    if derived_count is not None:
        result["derivedUnresolvedDecisionCount"] = derived_count
    result["exitCode"] = exit_code
    return emit_result(result, args.output, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
