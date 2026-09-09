# verify-archon browser harness

Verification scaffolding. Not part of the Archon product runtime.

Uses Playwright against the **system Google Chrome** (`channel: 'chrome'`) so a cloud VM does not need Playwright's bundled Chromium download.

```bash
# from this directory, once
bun install

# driven by the helper — do not call this by hand unless debugging
ARCHON_VERIFY_WEB_URL=http://127.0.0.1:15173 \
ARCHON_VERIFY_EVIDENCE_DIR=/path/to/evidence/runs/<id> \
bun run drive-console
```

Viewport is 1440×900. The project rail is `hidden lg:block` (Tailwind `lg` = 1024px); a mobile viewport would hide every rail assertion.

Selectors are taken from `packages/web/src/experiments/console/` (see `drive-console.mjs`).
