# UI verification and repair

`pr-e2e-verify` runs against an isolated checkout of an open PR.
The local runner requires macOS or Linux for owned process-group cleanup.
Pass both named inputs as full GitHub URLs.
Run Archon from this source checkout:

```sh
bun run cli workflow run pr-e2e-verify \
  --input pr=https://github.com/anhle128/Archon/pull/NUMBER \
  --input issue=https://github.com/anhle128/Archon/issues/144
```

The issue must link the complete approved plan and mockup with same-repository GitHub `blob` or `tree` URLs pinned to a commit.
The workflow saves the full issue title/body, PR metadata and every linked source file before test authoring.
It verifies that the checkout source files match those pinned bytes.
Unpinned or unsupported cross-repository sources fail with an explicit error.
Use local Claude and Codex authentication already configured for Archon.
The repair node uses literal `claude-sonnet-5`; the independent author, audit, diagnosis and review use fresh `gpt-5.6-sol` sessions.
There is no model fallback.

The run follows this sequence:

```text
source lock → test authoring → independent contract audit → test lock
                                                           ↓
                                   build/tests → browser/image/third-party review
                                         ↑                 ↓
                                      repair ← diagnosis ← failed gate
                                                           ↓ passed
                                                    verified-tree push
```

The negative route shows each problem, expected and actual behavior, evidence, source owner, root cause, proposed fix and regression check before repair.
Archon's `route_loop.max_iterations` is the only repair counter.
It is set to five repairs, with verification after each repair.
If verification still fails, the exhausted node exits nonzero and retains the findings.
Do not restart or reset a run to bypass that limit.
A failed source/contract audit stops before product repair.

## Acceptance manifest

The test author writes `ui-verification/manifest.json` under the run's artifact directory.
The schema in [the gate helper](../.archon/scripts/ui-verification.ts) is authoritative.
This example shows one criterion, not the complete required manifest:

```json
{
  "requirements": [
    {
      "id": "room-closed",
      "source": "issue.md",
      "quote": "A plain run URL has no room"
    }
  ],
  "criteria": [
    {
      "id": "console-plain-desktop",
      "requirementIds": ["room-closed"],
      "surface": "console",
      "state": "paused run, no selected node",
      "viewport": { "width": 1440, "height": 1000 },
      "test": {
        "file": "e2e/ui/workflow-run-hitl-visual.spec.ts",
        "title": "[P1] Console plain run has no room"
      },
      "visual": {
        "source": "_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/console.html",
        "actual": "console-plain-1440-actual.png",
        "reference": "console-plain-1440-reference.png"
      }
    }
  ],
  "unitTests": [],
  "mockedExternals": []
}
```

`source` is `issue.md` or an exact path from `authority.files`.
Each requirement quote must exist in its preserved source.
Each requirement needs criteria, and each criterion needs an exact durable E2E file and test title.
For a nested test, join its enclosing `describe` titles and leaf title with `›`; exclude the file name.
The independent audit checks full semantic coverage against every source before freeze.
Include every accepted observable UI and behavior requirement, including all room types, history, accessibility and retained controls such as Terminal; the gate does not substitute a small fixed bug list for the source scope.
Delivery and workflow constraints remain binding outside the UI manifest.
Record each such constraint, its existing deterministic workflow/helper/contract-test owners, validation checks and current evidence in `author-notes.md`.
The independent audit checks both categories before freeze; do not invent browser criteria for model, routing or publication rules, or claim future publication already passed.
Both Console and Legacy require image evidence at 1440×1000, 1280×900, 390×844 and 768×1024.
Use responsive source rules for narrow layouts and matched mockup states for desktop comparisons.
For a criterion that needs no image comparison, set `visual` to `null`.
For shared behavior, use `surface: "shared"`.

Test authoring may correct existing false assertions, helpers, workflow fixtures and Playwright configuration before freeze.
List corrected existing unit-test paths in `unitTests`.
Authoring must not change product implementation, package scripts, dependency locks or source authority.
Meaningful failing tests on the original UI are required; a skill that assumes green tests at authoring does not override this bugfix contract.
Record those failures and browser observations in `author-notes.md` in the artifact directory.

The freeze includes all E2E files, corrected unit tests, workflow and gate scripts, package manifests, dependency locks and configuration files.
It also locks the manifest, author notes and independent audit.
The authority, lock and checks digests pass through Archon's saved node outputs, so a changed artifact cannot replace its own expected hash.
Repair can change product implementation and add real provider contract anchors.
It cannot weaken any frozen test or change reference sources.
A scope gap in frozen acceptance needs an explicit failed finding.

## Checks and evidence

Each pass creates a new `rounds/<uuid>/` directory and `current.json` identifies its candidate tree and round.
The candidate tree uses a temporary Git index to include current tracked bytes, deletions, file modes and allowed new source/test files.
It does not use `HEAD` as a substitute for working content and does not change the checkout's real index.
New unrelated files fail the candidate check.

The helper runs frozen dependency installation, Chromium setup, a fresh web build, E2E type checking, the complete standalone UI suite with no retries or focused tests, and `bun run validate`.
It saves command exit codes and logs.
A failed setup/build cannot lead to acceptance of a stale bundle.
The test suite uses the existing fixture-owned isolated server, SQLite database and executor.
The fake AI provider is a test seam; independent review still requires real provider contract anchors for all mocked or changed external surfaces.

Tests write fresh PNG captures under `UI_VERIFY_EVIDENCE_DIR`.
Use Playwright's test output directory when that variable is absent during normal CI.
Do not write captures into the approved plan or tracked reference directory.
Each actual/reference pair must show the same state and viewport.
Reference failures must fail the test.
Do not work around a browser policy block with another URL or tool.

The independent reviewer must open actual images and drive the real browser for every criterion.
It returns each criterion exactly once with the observed result and image/browser checks.
It also repeats third-party coverage on the current candidate and identifies anchor files.
The gate rejects missing, duplicated, skipped, retried or failing required tests; incomplete review; copied/blank/invalid images; changed sources/tests; changed candidates; failed commands; and missing third-party anchors.
An unrelated pre-existing `fixme` outside every criterion does not add a new acceptance requirement.
Image bytes and test reports are rechecked before publication.
Semantic visual judgment belongs to the independent reviewer; file hashes alone cannot prove that a design matches.

Publication rechecks the gate and remote PR head and creates a clean child commit from the verified tree.
It proves the exact tree and single parent, then uses an exact expected-head lease as an atomic concurrency guard.
This permits only the verified direct child; it does not permit a history rewrite or an unbound force push.
Concurrent branch changes fail publication.
The commit contains both product repair and durable acceptance tests, without the engine's intermediate checkpoint history.
The run records the published commit, candidate and round in `published.json`.
It also posts the verification result and per-criterion observations on the PR.
It never merges the PR.

## Dispatch and CI

The local command above starts the repair workflow with explicit issue and PR inputs.
It uses the source checkout and local provider authentication.
It does not install a webhook, polling service or self-hosted runner.

The existing [PR E2E Verify runner](../.github/workflows/pr-e2e-verify.yml) also starts this workflow for eligible UI PRs to `develop` or `dev`.
Automatic dispatch requires exactly one issue in GitHub's typed closing-issue references for the PR.
Missing or multiple linked closing issues fail before the repair workflow starts; the caller does not infer an issue from prose.
Manual Actions dispatch takes an explicit `pr_number` and a full GitHub issue URL in `issue_url`.
The caller resolves the PR URL and passes both references to Archon through its named `pr` and `issue` inputs.
The hosted runner requires its own provider secrets; it does not copy local Claude Max or Codex ChatGPT credentials.
See [the E2E runner guide](../e2e/README.md) for trigger filters, hosted setup and final artifact checks.
The separate GitHub test workflow retains normal UI regression checks on configured PRs and branch pushes, including `develop`.

Automatic runs load the CLI and workflow from the trusted PR base, then verify the PR candidate in an isolated worktree.
They do not execute a workflow from an arbitrary PR head with write credentials.
For the first workflow upgrade, use a reviewed local run until the trusted base contains the new named-input workflow and helper.
Alternatively, an authorized maintainer can use manual Actions dispatch and explicitly select a reviewed trusted branch that contains the upgrade.
If the selected trusted checkout lacks that contract, the hosted runner fails with a bootstrap error; it does not run the old workflow or report verification success.
Neither caller adds a repair counter or retries an exhausted run; the Archon route-loop setting remains the only repair limit.
