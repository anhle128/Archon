# Feature Verification Catalog

Each JSON manifest is the canonical feature contract. Markdown files explain
the user journey; the helper discovers manifests without a feature allowlist.

```bash
.agents/skills/verify-archon/bin/verify-archon catalog --json
```

A manifest defines unique behavior IDs, P0/P1/P2 priority, candidate impact
paths, required scenario links, runner descriptors, and proof obligations.
A behavior may require several scenarios; one scenario may prove several
behaviors. Every catalog scenario must have a behavior and runnable code.

Impact paths only broaden an agent's behavior selection. They do not infer
intent or make unmapped changes safe. Add coverage for an unmapped path before
claiming its behavior was verified. An empty selection is rejected; this
manual version has no automatic no-behavior-change approval path.

Playwright descriptors point into the existing `e2e/` package and select
stable `[V:<scenario-id>]` tags. Existing priority tags remain. CLI/API
descriptors call the shared isolated recipes. Test locators, shell assertions,
and request bodies belong in executable scenarios.

Adding a feature means adding its JSON manifest and executable scenarios, then
running catalog validation and its proof. No selector/helper allowlist changes
are needed. Workflow adoption follows successful direct skill verification.
