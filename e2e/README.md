# E2E UI tests

Run the Playwright specs in `e2e/ui/` locally:

```bash
cd e2e
npm ci
npx playwright install chromium
npm run test:ui
```

The suite is a standalone npm package, not a Bun workspace member.
Root `bun --filter '*'` scripts do not download browsers.

## UI verification gate

The single automated UI gate for PRs into `develop` and `dev` is **PR E2E Verify**.
Its owner is [the existing Actions workflow](../.github/workflows/pr-e2e-verify.yml).
Do not add a second Playwright-only Actions workflow.
The job keeps the same check name and skips successfully for drafts and PRs without UI path changes.
The path filter includes the web app, this suite, the workflow, its helper and its contract tests.
The full filter is in the Actions file; the Astro docs site has a separate build.

For an eligible PR, the caller reads the typed GitHub `closingIssuesReferences` field.
Exactly one closing issue is required.
Zero or multiple linked issues fail with a clear error.
For manual `workflow_dispatch`, select a reviewed, trusted branch and supply `pr_number` and a full `issue_url`.
The caller resolves the full PR URL and sends both named inputs to Archon.
The same command works locally with existing provider authentication:

```bash
bun run cli workflow run pr-e2e-verify \
  --input pr=https://github.com/OWNER/REPO/pull/NUMBER \
  --input issue=https://github.com/OWNER/REPO/issues/NUMBER
```

The [Archon workflow guide](../docs/ui-verification-workflow.md) describes the pinned source contract, frozen acceptance, independent review, repair limit and publication rules.
The DAG can enter repair at most five times, through its own `route_loop.max_iterations` setting.
The caller adds no repair counter or retry loop.
Success requires a terminal completed run, a completed `publish` node, and `published.json` that matches this run's current candidate and passing gate.
The caller also checks the live PR head and its exact verified tree and parent.
It uploads this run's artifacts and command log, not the newest evidence from another run.

## Trusted source and initial rollout

Automatic runs check out the immutable PR base SHA for the CLI, workflow and helper.
The managed worktree starts from that trusted checkout.
The helper preserves its controller before it fetches the PR candidate.
Only open, same-repository PRs can execute with write credentials; fork heads fail before provider use.
This gate uses `pull_request`, never `pull_request_target`.

If the trusted base does not contain the upgraded helper and required `pr` and `issue` contract, the job fails before provider use.
It does not load a PR-head workflow or fall back to the old contract.
For the first upgrade, run the reviewed workflow locally or explicitly dispatch a reviewed branch.
Automatic base execution becomes available after a maintainer merges the upgrade.
GitHub can require approval for follow-up PR workflow runs caused by a `GITHUB_TOKEN` push; publication does not prove those later checks passed.
See [GitHub's token event rules](https://docs.github.com/en/actions/concepts/security/github_token).

## Actions requirements

The existing runner is `ubuntu-latest`, with Bun, Node, Codex CLI and Chromium dependencies.
Archon worktree isolation stays enabled.

| Credential          | Use                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Claude Sonnet 5 `repair` node                                                                         |
| `OPENAI_API_KEY`    | Codex `plan-tests`, `audit-contract`, `verify` and `diagnose` nodes; also supplied as `CODEX_API_KEY` |
| `GITHUB_TOKEN`      | Actions-supplied issue reads, PR comment and verified commit push                                     |

Both provider secrets are required before the workflow starts, including runs that need no repair.
Missing secrets fail the job; the caller does not create credentials or configure repository settings.
Grok, XAI credentials and AXI-specific screenshot obligations are not part of this contract.
The workflow still requires real browser and image evidence for its frozen acceptance criteria.

To require this gate, a maintainer must add the exact **PR E2E Verify** check name to the target branch ruleset.
Keep that job name stable.
Code changes alone do not activate secrets, required checks or follow-up approvals.
