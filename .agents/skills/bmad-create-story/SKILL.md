---
name: bmad-create-story
description: Create, validate, or repair a BMAD implementation story as a decision-complete contract. Use for explicit create, validate, or repair modes, including readiness checks before development.
---

# BMAD Create Story

Create a draft story, validate it independently, or repair validation findings. Keep authoring and review responsibilities separate.

## Resolve the invocation

Require exactly one explicit mode:

- `create <story-selector>` creates one new draft story.
- `validate <story-file>` reviews one existing story and never rewrites its substantive content.
- `repair <story-file> <findings-file>` repairs one draft from a structured validation report.

Reject missing or unknown modes. Never reinterpret `validate` as `create`, discover a backlog story during validation, or overwrite an existing story during creation.

Resolve `{skill-root}` to this directory and `{project-root}` to the repository root. Run:

```bash
python3 {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key workflow
```

Apply the resolved activation steps, persistent facts, and completion hook. Load `{project-root}/_bmad/bmm/config.yaml`. Use its language and artifact paths.

Read these resources completely before executing a mode:

- `story-contract.md` for authority, risk profiling, surface discovery, and proof rules.
- `discover-inputs.md` for source discovery.
- `template.md` when creating a story.
- `checklist.md` when validating or repairing a story.

## Shared authority rules

Use this precedence unless a higher authority explicitly delegates a choice:

1. Approved story technical decisions, when the optional artifact exists.
2. Project constitution and project context.
3. Approved architecture and contracts.
4. PRD and epic/story acceptance criteria.
5. Current code and tests as runtime evidence, not automatic product authority.
6. Previous stories and git history as historical evidence only.

Look for the optional artifact at:

```text
{planning_artifacts}/story-decisions/{story_key}/technical-decisions.md
```

If absent, continue normally. If present, require matching story identity, `gate: PASS`, `unresolvedDecisionCount: 0`, and complete coverage of every `TD-*` decision. Never silently weaken or replace it.

Stop with `BLOCKED` when authorities materially conflict, a required technical choice cannot be inferred safely, or a repair would change approved scope or ownership.

## Create mode

1. Resolve exactly one target from the selector or, when no selector was supplied after the explicit `create` mode, from the first backlog entry in sprint status.
2. Refuse to overwrite an existing story file.
3. Discover PRD, epic, architecture, UX, project context, optional technical decisions, previous-story evidence, relevant git history, and current implementation surfaces.
4. Trace the implementation blast radius before writing tasks: ingress, operations, persistence, async/process boundaries, first-party consumers, shared legacy callers, schemas, generated artifacts, and owning tests.
5. Classify the story risk dimensions from `story-contract.md`. Add the applicable contract modules and justify every non-applicable dimension.
6. Build one normative Decision and Invariant Ledger. Derive tasks, changed surfaces, and proofs from it; do not create competing descriptions of the implementation plan.
7. Populate `template.md` completely. Use stable IDs: `AC-*`, `INV-*` or `TD-*`, `TASK-*`, `SURF-*`, and `PROOF-*`.
   Do not return the story while any template placeholder, legacy AC numbering, legacy task numbering, or freeform proof/deferral/reference section remains.
   A story with rich prose but without the exact Story Contract headings, tables, and mappings is not draft-ready.
8. Keep `Status: draft`. Do not update sprint status to `ready-for-dev`.
9. Run the deterministic structural check:

```bash
python3 {skill-root}/scripts/validate_story_readiness.py {story_file} --json
```

When the optional technical-decision artifact exists, append:

```bash
--technical-decisions {planning_artifacts}/story-decisions/{story_key}/technical-decisions.md
```

Fix every deterministic structural failure that is supported by authority before returning.
If the checker reports missing `Story Contract`, `AC_IDS`, `TASK_IDS`, `PROOF_TABLE`, `DEFERRAL_TABLE`, `TD_COVERAGE`, or placeholder findings, normalize the story into the required contract shape instead of treating the prose draft as complete.
Return `BLOCKED` for material ambiguity.
Never return `draft` unless the deterministic checker returns `gate: PASS` with zero findings.

Return only an object with:

```json
{
  "status": "draft|blocked",
  "story_name": "...",
  "story_key": "...",
  "story_file": "...",
  "sprint_status": "...",
  "risk_profile": ["..."],
  "validation_summary": "..."
}
```

## Validate mode

Validation is an independent, fresh-context review. Do not use the creating agent's claims as evidence.

1. Require an existing story file and derive its story key.
2. Reload all canonical sources, optional technical decisions, current code, callers, consumers, schemas, generated surfaces, and relevant tests.
3. Run the deterministic checker and retain its findings. Pass `--technical-decisions` when the optional artifact exists; do not require or fabricate the flag when it is absent.
4. Review semantics against `checklist.md`: authority reconciliation, complete blast radius, ownership, lifecycle, failure behavior, compatibility, and proof observables at the owning runtime boundary.
5. Fingerprint each finding as `<invariant-id>:<failure-class>:<surface-id>`. Consolidate variants of the same root invariant.
6. Write the exact returned report to `$ARTIFACTS_DIR/story-readiness/latest.json` when `ARTIFACTS_DIR` is available. This report is operational state, not story content.
7. On any finding, leave story and sprint status unchanged and return `FAIL` or `BLOCKED`.
8. On PASS only, change `Status: draft` to `Status: ready-for-dev` and update the matching sprint-status entry from `backlog` to `ready-for-dev`. Do not alter any other story content.

Return only an object with:

```json
{
  "gate": "PASS|FAIL|BLOCKED",
  "story_file": "...",
  "findings_count": 0,
  "findings": [
    {
      "id": "SR-001",
      "fingerprint": "INV-1:proof-target:SURF-2",
      "severity": "critical|high|medium|low",
      "invariant": "INV-1",
      "surface": "SURF-2",
      "problem": "...",
      "evidence": ["path:line"],
      "required_fix": "...",
      "authority": "...",
      "repairable": true
    }
  ],
  "decision_coverage": "covered/total or not-applicable",
  "ac_coverage": "covered/total",
  "invariant_coverage": "covered/total",
  "summary": "..."
}
```

Never return PASS with findings. Never classify a material authority, scope, or ownership decision as repairable.

## Repair mode

1. Require an existing `draft` story and a validation report whose `story_file` matches it and whose gate is `FAIL` or `BLOCKED`.
2. Refuse stale reports when a reported evidence excerpt or fingerprint no longer matches the story.
3. Group findings by fingerprint and repair the underlying invariant once, updating the ledger and every derived task, surface, and proof reference consistently.
4. Repair only facts derivable from existing authority and code evidence.
5. Return `BLOCKED` without inventing a solution when a finding requires a new technical decision, scope expansion, or ownership change.
6. Keep `Status: draft`; validation must run again.
7. Run the deterministic checker before returning.
   If the existing story uses legacy prose sections, normalize it into `template.md`'s exact contract structure while preserving supported content.
   Convert prose ACs to stable `AC-*` IDs, top-level tasks to `[TASK-*]`, technical decisions to `TD-*` ledger rows, surfaces to `SURF-*`, proofs to `PROOF-*`, and deferrals/references to the required top-level sections.
   Remove all template placeholders.
   Never return `repaired` unless the deterministic checker returns `gate: PASS` with zero findings.

Return only an object with:

```json
{
  "status": "repaired|blocked",
  "story_name": "...",
  "story_key": "...",
  "story_file": "...",
  "sprint_status": "...",
  "risk_profile": ["..."],
  "validation_summary": "...",
  "resolved_findings": ["SR-001"],
  "blocked_findings": []
}
```

## Completion discipline

- A populated heading is not proof of completeness; every ledger row must close behavior, owner, surfaces, tasks, and observables.
- A broad test command is not proof unless its assertions observe the required boundary.
- Do not mark tasks complete during create, validate, or repair.
- Do not add implementation or production code.
- Execute the resolved completion hook only after the selected mode has reached its terminal result.
