# Version Reality-Check — ARCHITECTURE-SPINE.md

**Spine:** `architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md`
**Reviewed:** 2026-09-05
**Method:** Each Stack table row cross-checked against (a) the actual workspace `package.json` files and (b) live npm/GitHub lookups where the spine made a web-verification claim.
**Sources checked:**

- `packages/web/package.json`
- `packages/git/package.json`
- `packages/server/package.json`
- root `package.json`
- npm registry: `https://www.npmjs.com/package/react-diff-view` (live fetch 2026-09-05)
- GitHub CHANGELOG: `https://github.com/otakustay/react-diff-view/blob/master/CHANGELOG.md`

---

## Verdict

**PASS with one installation caveat.** Every version number in the Stack table is consistent with the installed workspace packages. The one web-verified claim — `react-diff-view@3.3.3` published 2026-03-30 — is confirmed by live npm data. No invented versions were found. One caveat about peer-dep strictness is not flagged in the spine and should be noted before the implementation sprint.

---

## Stack Table — Row-by-Row Results

| Spine claim                                  | Source checked                                         | Actual value                    | Status       |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------- | ------------ |
| Bun `^1.3`                                   | root `package.json` → `engines.bun`                    | `^1.3.0`                        | ✅ matches   |
| TypeScript `^5.3`                            | root `devDependencies.typescript`                      | `^5.3.0`                        | ✅ matches   |
| Hono `^4.12`                                 | `packages/server/package.json`                         | `^4.12.16`                      | ✅ matches   |
| `@hono/zod-openapi` `^1.4`                   | `packages/server/package.json`                         | `^1.4.0`                        | ✅ matches   |
| React `^19`                                  | `packages/web/package.json`                            | `^19.0.0`                       | ✅ matches   |
| Vite `^6`                                    | `packages/web/devDependencies.vite`                    | `^6.0.0`                        | ✅ matches   |
| Tailwind v4                                  | `packages/web/devDependencies.tailwindcss`             | `^4.0.0`                        | ✅ matches   |
| `react-diff-view@3.3.3` (new)                | npm registry + GitHub CHANGELOG, live fetch 2026-09-05 | **3.3.3**, published 2026-03-30 | ✅ confirmed |
| `highlight.js@^11.11.1` (installed)          | `packages/web/package.json`                            | `^11.11.1`                      | ✅ matches   |
| `@tanstack/react-virtual@^3.0.0` (installed) | `packages/web/package.json`                            | `^3.0.0`                        | ✅ matches   |
| `react-resizable-panels@^4` (installed)      | `packages/web/package.json`                            | `^4`                            | ✅ matches   |
| `@tanstack/react-query@^5` (installed)       | `packages/web/package.json`                            | `^5.0.0`                        | ✅ matches   |

---

## Findings

### Finding 1 — react-diff-view@3.3.3 CONFIRMED (version claim passes) ✅

The spine states `react-diff-view@3.3.3 (npm, 2026-03-30)`. Live npm data (fetched 2026-09-05) confirms 3.3.3 is the latest published version, published at `2026-03-30T15:05:02Z`. The GitHub CHANGELOG entry for 3.3.3 matches. **The web-verification claim in the spine is accurate.**

> Source: https://www.npmjs.com/package/react-diff-view — "Updated: 2026-03-30T15:05:02.321Z"

### Finding 2 — react-diff-view peer dep is `react >=16.14.0`, NOT `^19` ⚠️

`react-diff-view@3.3.3` declares `peerDependencies: { react: ">=16.14.0" }`. This range technically satisfies React 19 (`19.x >= 16.14.0`), so it will install without errors under Bun's peer-dep resolver. However, strict npm installs (`npm install` without `--legacy-peer-deps`) will produce a peer-dep conflict warning because the package's dev-tested environment is React 18 (its own devDependencies pin `react: "^18.2.0"`).

**Risk:** Low for this project (Bun is the package manager and is lenient on peer deps). However, the spine does not mention this gap, and it is a material detail for anyone who audits the install or runs `npm install` for any reason. The spine should note `react >=16.14.0 peer dep; Bun resolves cleanly against React 19`.

> Source: https://www.npmjs.com/package/react-diff-view — Peer Dependencies section; GitHub master `package.json` devDependencies confirms React 18 test baseline.

### Finding 3 — react-diff-view bundles lodash (unremarked bundle-weight risk) ⚠️

`react-diff-view@3.3.3` has a **runtime** dependency on `lodash@^4.17.21`. Lodash (full build) adds ~71 KB gzip to the bundle. The spine's AD-5 rule mentions a `~2 MB first-paint` spike check against react-diff-view as a possible future exit criterion, but it does not flag that the lodash dep is a non-trivial bundler consideration (tree-shaking lodash requires explicit ES module imports; the react-diff-view CJS entrypoint may not tree-shake). This is not a blocker, but the spike assessment in `plans/architectures/archon-source-control.md` should account for it.

> Source: https://github.com/otakustay/react-diff-view/blob/master/package.json — `dependencies.lodash: "^4.17.21"`

### Finding 4 — All other Stack rows are workspace-confirmed, no invented versions ✅

Every other version in the Stack table (`Bun ^1.3`, `TypeScript ^5.3`, `Hono ^4.12`, `@hono/zod-openapi ^1.4`, `React ^19`, `Vite ^6`, `Tailwind v4`, `highlight.js ^11.11.1`, `@tanstack/react-virtual ^3.0.0`, `react-resizable-panels ^4`, `@tanstack/react-query ^5`) was cross-checked directly against the installed `package.json` files in the workspace. All match. No version was asserted from training data without a workspace or web anchor.

### Finding 5 — `@archon/git` has no version-pinned deps to audit ✅

`packages/git/package.json` declares only `@archon/paths: workspace:*` — no external deps. The spine's AD-2 claim that git-read helpers live in `@archon/git` over `execFileAsync` is architecturally consistent with the package's design (no git library dep, raw exec only).

---

## Not Flagged / Out of Scope

- **Hono version gap:** Spine says `^4.12`; server has `^4.12.16`. Both resolve to the same semantic range; no discrepancy.
- **shadcn version:** The spine's Stack row lists `React / Vite / Tailwind v4 / shadcn` without a discrete shadcn version. The installed devDep is `shadcn@^3.8.4`. The omission is acceptable since shadcn is a code-generation tool, not a runtime dep — but any future spine that pins shadcn separately should use `^3.8.4` as the baseline.
- **react-diff-view `^3.3.3` vs pinned `3.3.3`:** The spine pins exactly `3.3.3` rather than a caret range. This is intentional (explicit verification point) and is not a mistake; it just means the dependency install will pin exactly that version with no auto-upgrades. Acceptable.
