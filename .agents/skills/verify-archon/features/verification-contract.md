# Verification contract

The verification contract is the fail-closed gate around selection, proof
execution, and workflow aggregation. It is not a product user journey; it
proves that incomplete, stale, or substituted evidence cannot pass.

## Automated Coverage

`verification.contract` runs the verification-skill unit suite and the
workflow-gate tests. A PASS means those suites accepted only complete,
provenance-matching proof. It does not prove any product feature.

```bash
.agents/skills/verify-archon/bin/verify-archon prove verification-contract
```

## How it fails closed

- Selection rejects a dirty checkout, SHA or diff mismatch, empty change diffs
  (unless `--historical`), coverage gaps, unknown behavior IDs, and unmapped
  changed paths.
- Execution rejects missing, skipped, flaky, unsupported, or stale required
  scenarios. There is no default smoke; `prove` needs `--selection`,
  `--scenario`, or a feature ID.
- The workflow gate re-validates the same selection and `prove()` result before
  a PR can be authorized.

## Driving it with verify-archon

Preconditions:

- Clean product checkout (commit-bound proof).
- Root deps installed so `bun run test:verification-skills` can resolve
  `@hono/zod-openapi` (hoisted linker if catalog/prove fails to import it).

- **Prove the contract.** Run `verify-archon prove verification-contract`.
  Expect verdict `PASS` and evidence
  `verification-skill-tests.txt` / `verification-workflow-tests.txt`.

## Gotchas

- This feature has no Playwright or browser step.
- A product-feature FAIL elsewhere does not fail this recipe; only the
  verification suites do.
