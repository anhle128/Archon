#!/usr/bin/env python3
"""Deterministically validate the BMAD story-readiness Markdown contract."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


REQUIRED_SECTIONS = (
    "Story",
    "Acceptance Criteria",
    "Story Contract",
    "Tasks / Subtasks",
    "Proof Plan",
    "Explicit Deferrals",
    "References",
    "Dev Agent Record",
)
REQUIRED_CONTRACT_SECTIONS = (
    "Authority and Source Precedence",
    "Risk Profile",
    "Decision and Invariant Ledger",
    "Changed Surface Contract",
    "Stateful and Persistence Contract",
    "Async and Process Contract",
    "CLI and API Contract",
    "Cross-Package and Generated Contract",
    "Compatibility Contract",
    "Security Contract",
)
RISK_MODULES = {
    "stateful": "Stateful and Persistence Contract",
    "async-process": "Async and Process Contract",
    "cli-api": "CLI and API Contract",
    "cross-package": "Cross-Package and Generated Contract",
    "compatibility": "Compatibility Contract",
    "security": "Security Contract",
}
ALLOWED_OBSERVABLES = {
    "return-value",
    "protocol-envelope",
    "durable-state",
    "dispatch-ack",
    "worker-claim",
    "terminal-outcome",
    "consumer-contract",
    "no-side-effect",
}
PLACEHOLDER_MARKERS = (
    "{{",
    "[add ",
    "[specific reason]",
    "[same concrete reason]",
    "[normative claim]",
    "[concrete requirement]",
    "[required and prohibited behavior]",
    "[owning module/process/store]",
    "[path or public contract]",
    "[current evidence]",
    "[required behavior]",
    "[callers/consumers]",
    "[owner]",
    "[exact focused command/test]",
    "[concrete assertion]",
    "[concrete failing or boundary assertion]",
    "[source: path#section]",
)


@dataclass(frozen=True)
class Finding:
    code: str
    message: str


def section(text: str, title: str, level: int) -> str | None:
    marker = "#" * level
    next_heading = rf"^#{{1,{level}}}\s+"
    match = re.search(
        rf"(?ms)^{re.escape(marker)}\s+{re.escape(title)}\s*$\n(.*?)(?={next_heading}|\Z)",
        text,
    )
    return match.group(1).strip() if match else None


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def markdown_table(body: str) -> tuple[list[str], list[dict[str, str]]]:
    lines = [line for line in body.splitlines() if line.lstrip().startswith("|")]
    if len(lines) < 2:
        return [], []
    headers = split_table_row(lines[0])
    delimiter = split_table_row(lines[1])
    if len(headers) != len(delimiter) or not all(re.fullmatch(r":?-{3,}:?", cell) for cell in delimiter):
        return [], []
    rows: list[dict[str, str]] = []
    for line in lines[2:]:
        cells = split_table_row(line)
        if len(cells) == len(headers):
            rows.append(dict(zip(headers, cells, strict=True)))
    return headers, rows


def ids(value: str, prefix: str) -> set[str]:
    return set(re.findall(rf"\b{re.escape(prefix)}-[A-Z0-9]+(?:-[A-Z0-9]+)*\b", value, re.IGNORECASE))


def all_ids(value: str, prefixes: Iterable[str]) -> set[str]:
    result: set[str] = set()
    for prefix in prefixes:
        result.update(identifier.upper() for identifier in ids(value, prefix))
    return result


def duplicate_ids(values: Iterable[str]) -> list[str]:
    counts = Counter(value.upper() for value in values)
    return sorted(identifier for identifier, count in counts.items() if count > 1)


def find_project_root(story_file: Path) -> Path | None:
    for candidate in (story_file.parent, *story_file.parents):
        if (candidate / "_bmad").is_dir():
            return candidate
    return None


def parse_flat_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if not match:
        return {}
    values: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        if ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def validate_technical_decisions(
    story_key: str,
    decision_file: Path | None,
    ledger_ids: set[str],
    findings: list[Finding],
) -> tuple[int, int] | None:
    if decision_file is None or not decision_file.exists():
        return None
    decision_text = decision_file.read_text(encoding="utf-8")
    frontmatter = parse_flat_frontmatter(decision_text)
    if frontmatter.get("story") != story_key:
        findings.append(Finding("TD_IDENTITY", "Technical-decision artifact targets a different story"))
    if frontmatter.get("gate") != "PASS":
        findings.append(Finding("TD_GATE", "Technical-decision artifact gate is not PASS"))
    if frontmatter.get("unresolvedDecisionCount") != "0":
        findings.append(Finding("TD_UNRESOLVED", "Technical-decision artifact has unresolved decisions"))
    decision_ids = {
        match.upper()
        for match in re.findall(r"(?m)^###\s+(TD-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b", decision_text)
    }
    missing = sorted(decision_ids - ledger_ids)
    if missing:
        findings.append(Finding("TD_COVERAGE", f"Ledger does not cover technical decisions: {', '.join(missing)}"))
    return len(decision_ids & ledger_ids), len(decision_ids)


def validate_story(story_file: Path, decision_override: Path | None) -> dict[str, object]:
    findings: list[Finding] = []
    if not story_file.is_file():
        return {
            "ok": False,
            "gate": "FAIL",
            "story_file": str(story_file),
            "findings": [asdict(Finding("FILE", "Story file does not exist"))],
        }

    text = story_file.read_text(encoding="utf-8")
    status_match = re.search(r"(?m)^Status:\s*(\S.*?)\s*$", text)
    if not status_match or status_match.group(1) not in {"draft", "ready-for-dev"}:
        findings.append(Finding("STATUS", "Status must be draft or ready-for-dev during readiness validation"))

    lowered = text.lower()
    present_placeholders = [marker for marker in PLACEHOLDER_MARKERS if marker in lowered]
    if present_placeholders:
        findings.append(Finding("PLACEHOLDER", f"Story contains placeholders: {', '.join(present_placeholders)}"))

    for title in REQUIRED_SECTIONS:
        if section(text, title, 2) is None:
            findings.append(Finding("SECTION", f"Missing required section: ## {title}"))
    for title in REQUIRED_CONTRACT_SECTIONS:
        if section(text, title, 3) is None:
            findings.append(Finding("CONTRACT_SECTION", f"Missing story-contract section: ### {title}"))

    ac_body = section(text, "Acceptance Criteria", 2) or ""
    ac_definition_ids = re.findall(r"(?mi)^\s*\d+\.\s+\[(AC-[A-Z0-9-]+)\]", ac_body)
    ac_ids = {identifier.upper() for identifier in ac_definition_ids}
    if not ac_ids:
        findings.append(Finding("AC_IDS", "Acceptance criteria must use stable AC-* identifiers"))
    for duplicate in duplicate_ids(ac_definition_ids):
        findings.append(Finding("DUPLICATE_ID", f"Acceptance criterion ID is duplicated: {duplicate}"))

    risk_body = section(text, "Risk Profile", 3) or ""
    risk_states: dict[str, str] = {}
    for risk, module in RISK_MODULES.items():
        match = re.search(
            rf"(?mi)^-\s*{re.escape(risk)}:\s*(applicable|not-applicable)\s*[—-]\s*(\S.*)$",
            risk_body,
        )
        if not match:
            findings.append(Finding("RISK_PROFILE", f"Missing classification and rationale for {risk}"))
            continue
        state, rationale = match.group(1).lower(), match.group(2).strip()
        risk_states[risk] = state
        if len(rationale) < 12:
            findings.append(Finding("RISK_RATIONALE", f"Risk rationale for {risk} is not concrete"))
        module_body = section(text, module, 3) or ""
        if state == "applicable" and (not module_body or re.match(r"(?i)^N/A\b", module_body)):
            findings.append(Finding("RISK_MODULE", f"Applicable risk {risk} has no populated {module} module"))
        if state == "not-applicable" and not re.search(r"(?i)\bN/A\b.*\bbecause\b", module_body, re.DOTALL):
            findings.append(Finding("RISK_NA", f"Non-applicable risk {risk} lacks a matching N/A rationale"))

    authority_headers, authority_rows = markdown_table(section(text, "Authority and Source Precedence", 3) or "")
    if authority_headers != ["Source", "Claim", "Disposition", "Effect on this story"] or not authority_rows:
        findings.append(Finding("AUTHORITY_TABLE", "Authority table is missing, empty, or has the wrong columns"))
    else:
        allowed = {"ADOPT", "PRESERVE", "SUPERSEDE", "DEFER", "CONFLICT"}
        for row in authority_rows:
            if row["Disposition"] not in allowed:
                findings.append(Finding("AUTHORITY_DISPOSITION", f"Invalid authority disposition: {row['Disposition']}"))
            if row["Disposition"] == "CONFLICT":
                findings.append(Finding("AUTHORITY_CONFLICT", "Authority table contains an unresolved CONFLICT"))

    ledger_headers, ledger_rows = markdown_table(section(text, "Decision and Invariant Ledger", 3) or "")
    expected_ledger_headers = [
        "ID",
        "Source",
        "Acceptance IDs",
        "Required behavior",
        "Owner or boundary",
        "Task IDs",
        "Surface IDs",
        "Proof IDs",
        "Disposition",
    ]
    if ledger_headers != expected_ledger_headers or not ledger_rows:
        findings.append(Finding("LEDGER_TABLE", "Decision and Invariant Ledger is missing, empty, or has the wrong columns"))
        ledger_rows = []

    ledger_id_values = [row.get("ID", "") for row in ledger_rows]
    ledger_ids = {
        identifier.upper()
        for identifier in ledger_id_values
        if re.fullmatch(r"(?:TD|INV)-[A-Z0-9-]+", identifier, re.IGNORECASE)
    }
    for identifier in ledger_id_values:
        if not re.fullmatch(r"(?:TD|INV)-[A-Z0-9-]+", identifier, re.IGNORECASE):
            findings.append(Finding("LEDGER_ID", f"Invalid ledger ID: {identifier or '<missing>'}"))
    for duplicate in duplicate_ids(ledger_id_values):
        findings.append(Finding("DUPLICATE_ID", f"Ledger ID is duplicated: {duplicate}"))
    ledger_ac_ids: set[str] = set()
    ledger_task_ids: set[str] = set()
    ledger_surface_ids: set[str] = set()
    ledger_proof_ids: set[str] = set()
    for row in ledger_rows:
        ledger_ac_ids.update(all_ids(row.get("Acceptance IDs", ""), ("AC",)))
        ledger_task_ids.update(all_ids(row.get("Task IDs", ""), ("TASK",)))
        ledger_surface_ids.update(all_ids(row.get("Surface IDs", ""), ("SURF",)))
        ledger_proof_ids.update(all_ids(row.get("Proof IDs", ""), ("PROOF",)))
        if row.get("Disposition") not in {"IMPLEMENT", "PRESERVE", "DEFER"}:
            findings.append(Finding("LEDGER_DISPOSITION", f"Invalid ledger disposition for {row.get('ID', '<missing>')}"))
        for field in ("Source", "Required behavior", "Owner or boundary"):
            if not row.get(field, "").strip():
                findings.append(Finding("LEDGER_CELL", f"{row.get('ID', '<missing>')} has empty {field}"))
        for field, prefixes in (
            ("Acceptance IDs", ("AC",)),
            ("Task IDs", ("TASK",)),
            ("Surface IDs", ("SURF",)),
            ("Proof IDs", ("PROOF",)),
        ):
            if not all_ids(row.get(field, ""), prefixes):
                findings.append(Finding("LEDGER_MAPPING", f"{row.get('ID', '<missing>')} has no {field} mapping"))

    surface_headers, surface_rows = markdown_table(section(text, "Changed Surface Contract", 3) or "")
    expected_surface_headers = [
        "Surface ID",
        "Classification",
        "Module or contract",
        "Current behavior",
        "Required or preserved behavior",
        "Consumers",
        "Owner",
    ]
    if surface_headers != expected_surface_headers or not surface_rows:
        findings.append(Finding("SURFACE_TABLE", "Changed Surface Contract is missing, empty, or has the wrong columns"))
        surface_rows = []
    surface_id_values = [row.get("Surface ID", "") for row in surface_rows]
    surface_ids = {
        identifier.upper()
        for identifier in surface_id_values
        if re.fullmatch(r"SURF-[A-Z0-9-]+", identifier, re.IGNORECASE)
    }
    for identifier in surface_id_values:
        if not re.fullmatch(r"SURF-[A-Z0-9-]+", identifier, re.IGNORECASE):
            findings.append(Finding("SURFACE_ID", f"Invalid surface ID: {identifier or '<missing>'}"))
    for duplicate in duplicate_ids(surface_id_values):
        findings.append(Finding("DUPLICATE_ID", f"Surface ID is duplicated: {duplicate}"))
    for row in surface_rows:
        if row.get("Classification") not in {"CHANGE", "PRESERVE", "GENERATE", "DEFER"}:
            findings.append(Finding("SURFACE_CLASS", f"Invalid classification for {row.get('Surface ID', '<missing>')}"))
        if any(not row.get(field, "").strip() for field in expected_surface_headers[2:]):
            findings.append(Finding("SURFACE_CELL", f"Surface {row.get('Surface ID', '<missing>')} has empty contract cells"))

    tasks_body = section(text, "Tasks / Subtasks", 2) or ""
    task_matches = list(re.finditer(r"(?m)^-\s+\[([ xX])\]\s+\[(TASK-[A-Z0-9-]+)\]\s+(.+)$", tasks_body))
    task_ids = {match.group(2).upper() for match in task_matches}
    for duplicate in duplicate_ids(match.group(2) for match in task_matches):
        findings.append(Finding("DUPLICATE_ID", f"Task ID is duplicated: {duplicate}"))
    if not task_matches:
        findings.append(Finding("TASK_IDS", "Top-level tasks must use stable TASK-* identifiers"))
    task_ac_ids: set[str] = set()
    task_invariant_ids: set[str] = set()
    task_surface_ids: set[str] = set()
    task_proof_ids: set[str] = set()
    for match in task_matches:
        if match.group(1).lower() == "x":
            findings.append(Finding("TASK_COMPLETE", f"Readiness story task {match.group(2)} is already marked complete"))
        task_text = match.group(3)
        task_ac_ids.update(all_ids(task_text, ("AC",)))
        task_invariant_ids.update(all_ids(task_text, ("INV", "TD")))
        task_surface_ids.update(all_ids(task_text, ("SURF",)))
        task_proof_ids.update(all_ids(task_text, ("PROOF",)))
        for prefix in ("AC", "SURF", "PROOF"):
            if not all_ids(task_text, (prefix,)):
                findings.append(Finding("TASK_MAPPING", f"{match.group(2)} is missing {prefix} mapping"))
        if not all_ids(task_text, ("INV", "TD")):
            findings.append(Finding("TASK_MAPPING", f"{match.group(2)} is missing invariant/decision mapping"))

    proof_headers, proof_rows = markdown_table(section(text, "Proof Plan", 2) or "")
    expected_proof_headers = [
        "Proof ID",
        "Covers",
        "Observable",
        "Owning boundary",
        "Command or test",
        "Positive assertion",
        "Negative or boundary assertion",
    ]
    if proof_headers != expected_proof_headers or not proof_rows:
        findings.append(Finding("PROOF_TABLE", "Proof Plan is missing, empty, or has the wrong columns"))
        proof_rows = []
    proof_id_values = [row.get("Proof ID", "") for row in proof_rows]
    proof_ids = {
        identifier.upper()
        for identifier in proof_id_values
        if re.fullmatch(r"PROOF-[A-Z0-9-]+", identifier, re.IGNORECASE)
    }
    for identifier in proof_id_values:
        if not re.fullmatch(r"PROOF-[A-Z0-9-]+", identifier, re.IGNORECASE):
            findings.append(Finding("PROOF_ID", f"Invalid proof ID: {identifier or '<missing>'}"))
    for duplicate in duplicate_ids(proof_id_values):
        findings.append(Finding("DUPLICATE_ID", f"Proof ID is duplicated: {duplicate}"))
    proof_rows_by_id = {row.get("Proof ID", "").upper(): row for row in proof_rows}
    proof_covers: set[str] = set()
    for row in proof_rows:
        row_covers = all_ids(row.get("Covers", ""), ("AC", "INV", "TD"))
        proof_covers.update(row_covers)
        if not all_ids(row.get("Covers", ""), ("AC",)) or not all_ids(row.get("Covers", ""), ("INV", "TD")):
            findings.append(Finding("PROOF_MAPPING", f"Proof {row.get('Proof ID', '<missing>')} must cover an AC and an invariant/decision"))
        observables = {token.strip() for token in re.split(r"[,/]", row.get("Observable", "")) if token.strip()}
        if not observables or not observables.issubset(ALLOWED_OBSERVABLES):
            findings.append(Finding("PROOF_OBSERVABLE", f"Proof {row.get('Proof ID', '<missing>')} has an invalid observable"))
        for field in expected_proof_headers[3:]:
            if not row.get(field, "").strip():
                findings.append(Finding("PROOF_CELL", f"Proof {row.get('Proof ID', '<missing>')} has empty {field}"))
        normalized_command = re.sub(r"\s+", " ", row.get("Command or test", "").strip())
        if normalized_command in {"bun run test", "bun run validate", "bun test", "npm test"}:
            findings.append(Finding("PROOF_BROAD_ONLY", f"Proof {row.get('Proof ID', '<missing>')} uses only a broad suite"))

    for row in ledger_rows:
        behavior = row.get("Required behavior", "").lower()
        mapped_proofs = all_ids(row.get("Proof IDs", ""), ("PROOF",))
        mapped_observables = {
            observable.strip()
            for proof_id in mapped_proofs
            for observable in re.split(r"[,/]", proof_rows_by_id.get(proof_id, {}).get("Observable", ""))
            if observable.strip()
        }
        required_observables: set[str] = set()
        if "worker claim" in behavior or "worker-claim" in behavior:
            required_observables.add("worker-claim")
        if "terminal outcome" in behavior or "terminal-outcome" in behavior:
            required_observables.add("terminal-outcome")
        if any(term in behavior for term in ("durable state", "durable transition", "compare-and-swap", "persisted state")):
            required_observables.add("durable-state")
        if "consumer contract" in behavior or "consumer-visible" in behavior:
            required_observables.add("consumer-contract")
        if "no side effect" in behavior or "must not mutate" in behavior:
            required_observables.add("no-side-effect")
        missing_observables = sorted(required_observables - mapped_observables)
        if missing_observables:
            findings.append(
                Finding(
                    "PROOF_TARGET",
                    f"{row.get('ID', '<missing>')} requires owning-boundary observables: {', '.join(missing_observables)}",
                )
            )

    deferral_headers, deferral_rows = markdown_table(section(text, "Explicit Deferrals", 2) or "")
    expected_deferral_headers = ["Deferred item", "Owner", "Reason", "Residual risk", "Follow-up trigger"]
    if deferral_headers != expected_deferral_headers or not deferral_rows:
        findings.append(Finding("DEFERRAL_TABLE", "Explicit Deferrals is missing, empty, or has the wrong columns"))
    else:
        for row in deferral_rows:
            if row.get("Deferred item") != "None" and any(not row.get(field, "").strip() for field in expected_deferral_headers[1:]):
                findings.append(Finding("DEFERRAL_CELL", f"Deferral {row.get('Deferred item', '<missing>')} is incomplete"))

    for missing_ac in sorted(ac_ids - ledger_ac_ids):
        findings.append(Finding("AC_LEDGER", f"Acceptance criterion {missing_ac} is not mapped in the ledger"))
    for missing_ac in sorted(ac_ids - task_ac_ids):
        findings.append(Finding("AC_TASK", f"Acceptance criterion {missing_ac} is not mapped by a task"))
    for missing_ac in sorted(ac_ids - proof_covers):
        findings.append(Finding("AC_PROOF", f"Acceptance criterion {missing_ac} is not covered by a proof"))
    for missing in sorted(ledger_task_ids - task_ids):
        findings.append(Finding("LEDGER_TASK_REF", f"Ledger references missing task {missing}"))
    for missing in sorted(ledger_surface_ids - surface_ids):
        findings.append(Finding("LEDGER_SURFACE_REF", f"Ledger references missing surface {missing}"))
    for missing in sorted(ledger_proof_ids - proof_ids):
        findings.append(Finding("LEDGER_PROOF_REF", f"Ledger references missing proof {missing}"))
    for missing in sorted(ledger_ids - proof_covers):
        findings.append(Finding("INVARIANT_PROOF", f"Ledger invariant {missing} is not covered by a proof"))
    for orphan in sorted(task_ids - ledger_task_ids):
        findings.append(Finding("TASK_LEDGER", f"Task {orphan} is not derived from a ledger row"))
    for orphan in sorted(surface_ids - ledger_surface_ids):
        findings.append(Finding("SURFACE_LEDGER", f"Surface {orphan} is not derived from a ledger row"))
    for orphan in sorted(proof_ids - ledger_proof_ids):
        findings.append(Finding("PROOF_LEDGER", f"Proof {orphan} is not derived from a ledger row"))
    for unknown in sorted(task_ac_ids - ac_ids):
        findings.append(Finding("TASK_AC_REF", f"Task references unknown acceptance criterion {unknown}"))
    for unknown in sorted(task_invariant_ids - ledger_ids):
        findings.append(Finding("TASK_INVARIANT_REF", f"Task references unknown invariant or decision {unknown}"))
    for unknown in sorted(task_surface_ids - surface_ids):
        findings.append(Finding("TASK_SURFACE_REF", f"Task references unknown surface {unknown}"))
    for unknown in sorted(task_proof_ids - proof_ids):
        findings.append(Finding("TASK_PROOF_REF", f"Task references unknown proof {unknown}"))
    for unknown in sorted(proof_covers - ac_ids - ledger_ids):
        findings.append(Finding("PROOF_COVER_REF", f"Proof references unknown AC, invariant, or decision {unknown}"))

    project_root = find_project_root(story_file.resolve())
    story_key = story_file.stem
    decision_file = decision_override
    if decision_file is None and project_root is not None:
        candidate = project_root / "_bmad-output" / "planning-artifacts" / "story-decisions" / story_key / "technical-decisions.md"
        decision_file = candidate if candidate.exists() else None
    decision_coverage = validate_technical_decisions(story_key, decision_file, ledger_ids, findings)

    result: dict[str, object] = {
        "ok": not findings,
        "gate": "PASS" if not findings else "FAIL",
        "story_file": str(story_file),
        "findings_count": len(findings),
        "findings": [asdict(finding) for finding in findings],
        "decision_coverage": (
            "not-applicable" if decision_coverage is None else f"{decision_coverage[0]}/{decision_coverage[1]}"
        ),
        "ac_coverage": f"{len(ac_ids & ledger_ac_ids & proof_covers)}/{len(ac_ids)}",
        "invariant_coverage": f"{len(ledger_ids & proof_covers)}/{len(ledger_ids)}",
        "risk_profile": risk_states,
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("story_file", type=Path)
    parser.add_argument("--technical-decisions", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = validate_story(args.story_file, args.technical_decisions)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    elif result["ok"]:
        print(f"PASS: {args.story_file}")
    else:
        print(f"FAIL: {args.story_file}")
        for finding in result["findings"]:
            print(f"- {finding['code']}: {finding['message']}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
