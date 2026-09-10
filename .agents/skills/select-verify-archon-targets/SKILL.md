---
name: select-verify-archon-targets
description: >-
  Use when choosing user-facing verification coverage for an Archon product
  change, or selecting behavior regressions to check on a historical checkout.
  Works manually in an editor without an Archon workflow.
---

# Select Verification Targets

The agent interprets impact; the helper validates coverage. Produce a JSON
proposal of affected behaviors, then a normalized selection whose required
scenarios come from the catalog. A feature name or smoke result is not coverage.

## Inputs

Read the user's request, named plan or PR, relevant source, and complete diff.
Use the helper from the checkout containing the current verification tooling;
`--repo` can point at a separate clean product worktree.

Resolve the base from an explicit user ref first, then `$BASE_SHA_FILE` when
supplied. Otherwise inspect refs and use the merge-base with the project's
actual development branch (`origin/dev` or `origin/develop`). If ambiguous,
report the missing base instead of substituting `main` or `HEAD~1`.
For an explicitly requested historical snapshot check, use `--base HEAD --historical` and
derive affected behaviors from the requested regression, not an empty diff.

```bash
VERIFY=/absolute/path/to/current-tooling/.agents/skills/verify-archon/bin/verify-archon
"$VERIFY" catalog --json
"$VERIFY" snapshot --repo /absolute/path/to/product --base BASE_REF
git -C /absolute/path/to/product diff BASE_SHA..HEAD_SHA
```

The snapshot supplies exact `base_sha`, `head_sha`, `changed_paths`, and `dirty`.
A dirty product checkout cannot receive commit-bound proof. Preserve its edits
and use a clean worktree; do not stash, commit, or reset user changes for this skill.

## Proposal Contract

Read the JSON manifests in `verify-archon/features/`; these are authoritative.
Choose behavior IDs by their observable guarantees, not keyword similarity.
For example, Ask rendering does not cover answering: answering requires an
actual browser submit, persisted answer, continuation and final state.

Write `proposal.json` with this shape, using real snapshot values:

```json
{
  "version": 1,
  "base_sha": "<snapshot base_sha>",
  "head_sha": "<snapshot head_sha>",
  "changed_paths": ["<every path from snapshot>"],
  "affected_behaviors": [
    {
      "id": "hitl.answer",
      "confidence": "high",
      "rationale": "Ask ownership changes can prevent submitting an answer."
    }
  ],
  "coverage_gaps": []
}
```

Use `high` only when the evidence supports that scope. `medium` or `low` expands
to every behavior in that feature. Include every affected behavior; path mappings
also add known obligations and expand omitted impacted features.

If the requested behavior has no executable scenario, record the gap and report
selection failure. Unknown IDs, unmapped changed paths, empty selections, and
coverage gaps fail validation. **There is no `discover-workflows` fallback.**
Do not omit paths or mark uncertainty `high` just to obtain a smaller test set.

## Normalize And Hand Off

Manual artifacts default to `verify-archon/evidence/last-select/` and are local.
An explicitly supplied artifact directory may be used instead; no workflow
environment variable is required. Keep artifacts outside the product checkout
or in an ignored location so they do not make it dirty.

```bash
"$VERIFY" normalize-selection /absolute/path/to/proposal.json \
  --repo /absolute/path/to/product --base BASE_REF \
  --out /absolute/path/to/selection.json
"$VERIFY" validate-selection /absolute/path/to/selection.json \
  --repo /absolute/path/to/product --base BASE_REF
```

Report the normalized behavior/scenario IDs, automatic expansions, both SHAs,
and selection path. On failure, report the actual validation error; no usable
selection was established. Never hand-edit normalized scenario IDs.

For execution, use **verify-archon** with the normalized artifact:

```bash
"$VERIFY" prove --selection /absolute/path/to/selection.json \
  --repo /absolute/path/to/product --base BASE_REF
```

The runner revalidates selection and checkout. A changed diff, catalog, or HEAD
requires a fresh selection. Selection success is not a product PASS. Workflow
wiring is a separate integration step; this skill does not update workflows.

For an empty-diff historical regression, pass the same explicit
`--base HEAD --historical` flags to normalize, validate, and prove. The
normalized artifact records its mode, so it cannot later be consumed as an
ordinary change selection.
