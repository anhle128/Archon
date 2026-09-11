---
name: verify-archon
description: >-
  Use when verifying Archon CLI, API, or web behavior after a change, when
  checking historical bug reproductions, or when a passing smoke test may
  omit the user action, persisted outcome, or workflow continuation.
---

# Verify Archon

Prove the requested behaviors with executable scenarios. A passing room or
screenshot does not establish that an Ask can be answered. Run this skill
directly from an agent session; no Archon workflow or artifact environment is
required.

## Manual Procedure

1. Read the complete user request and relevant design/plan. Identify the product
   checkout and the expected observable outcome. Read the catalog:
   `.agents/skills/verify-archon/bin/verify-archon catalog --json`.
2. For a change-level claim, use `select-verify-archon-targets` to produce
   normalized `selection.json`. Run `validate-selection`, then
   `prove --selection`. The helper, not the agent, determines the verdict.
3. Read the new run's `result.json` and its scenario evidence. Report the target
   SHA, selected behaviors/scenarios, verdict, exact failures, and evidence path.
   State incomplete coverage or unsupported setup separately from a reproduced
   product bug.
4. When a fix changes the product HEAD, read the new diff and select again.
   Neither an older selection nor an earlier passing result proves the new HEAD.

```bash
VERIFY=.agents/skills/verify-archon/bin/verify-archon
$VERIFY validate-selection /tmp/archon-selection/selection.json \
  --repo /path/to/checkout --base BASE_REF
$VERIFY prove --selection /tmp/archon-selection/selection.json \
  --repo /path/to/checkout --base BASE_REF
```

The product checkout must be clean. Keep existing edits in their checkout and
use an isolated worktree for a historical revision. The selection normalizer
rejects unknown IDs, unmapped paths, empty impact, and missing scenarios.
Uncertainty broadens coverage. An explicit coverage gap stays failing.

## Historical Bug Checks

Check out the exact defective commit in a separate worktree. Keep the current
verification suite outside that worktree and use `--repo` to target it:

```bash
.agents/skills/verify-archon/bin/verify-archon prove \
  --scenario hitl.console-unowned-ask \
  --scenario hitl.legacy-unowned-ask \
  --repo /path/to/defective-checkout
```

To create commit-bound selection evidence for an unchanged historical checkout,
pass `--base HEAD --historical` to normalize, validate, and prove. Without that
explicit mode, an empty change diff fails closed.

A successful negative-control experiment has a **FAIL product verdict caused
by the expected behavioral assertion**. Preserve that FAIL; do not invert it
into product PASS. A build failure, obsolete locator, unsupported fixture, or
missing browser does not prove detection of the product defect. Confirm a
corresponding healthy control can pass. Keep known bugs in the target intact;
repair verification code separately and re-run it against the same target.

Scenario mode is diagnostic. It cannot establish complete change coverage.
The compatible `prove <feature-id>` command runs the catalog's full feature
scenario set in diagnostic mode; there is no default smoke.

## Executable Evidence

JSON manifests under [features/](features/) are the machine source of truth.
They link behaviors to durable scenarios and describe proof obligations.
Selectors and assertions live in executable code, not the manifests.

- UI: the same tagged Playwright specs in `e2e/ui/` used by the durable suite.
- CLI/API: the shared isolated recipes in `bin/runtime`, called by this helper.
- First-party mutation: browser/CLI action, real write, authoritative read-back,
  required transition, and final UI where applicable.
- Screenshots support behavioral assertions; they are not a substitute for them.

Every run creates `evidence/runs/<id>/selection.json`, `result.json`, process
logs, and `scenarios/<id>/result.json` with attachments. Evidence records the
product HEAD, selection/catalog digests, and exact verification-tooling digest.
Required missing, skipped, flaky, failed, unsupported, or stale proof cannot pass.
Tracked historical `last-proof/` captures are not current evidence.

## Environment and Cleanup

The local runtime requires macOS/Linux (or WSL), Bash, jq, curl, and lsof.
Owned POSIX process groups bound timeout cleanup, including CLI descendants.

Install root dependencies with `bun install --frozen-lockfile`, and standalone
E2E dependencies with `npm ci --prefix e2e`. Bun's default isolated linker does
not hoist `@hono/zod-openapi` to the repo root; `catalog` / `prove` then fail
to resolve that import from this skill directory. Reinstall with
`bun install --frozen-lockfile --linker=hoisted` when that happens. Install
Playwright Chromium, or set `ARCHON_PW_CHANNEL=chrome` for installed Google
Chrome. Check `e2e/README.md` for runtime settings. Browser proof rebuilds the
**target** web bundle first.

All runs use isolated SQLite, loopback ports, fake AI at the provider boundary,
and separate `ARCHON_HOME`. Never target the operator's instance or Mini
implicitly. The Playwright fixture and CLI runner own cleanup, including
failures. Evidence survives cleanup. Missing dependencies are setup failures.

Owned-run authorization needs an authenticated test environment; the solo
SQLite fixture explicitly reports unsupported setup for that obligation.
An old fake provider may also be unable to create the long-history fixture.
These remain failed required proofs, with the unmet prerequisite reported.

For independent local runtime diagnostics, `launch`, `doctor`, `cleanup`,
`cli`, `http`, `status`, and `evidence` remain available. Read `--help`.
