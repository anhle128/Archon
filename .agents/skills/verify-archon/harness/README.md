# verify-archon browser harness

Verification scaffolding. Not part of the Archon product runtime.

Uses Playwright against the **system Google Chrome** (`channel: 'chrome'`) so a cloud VM does not need Playwright's bundled Chromium download. Video recording needs Playwright's ffmpeg (`bunx playwright install ffmpeg`); screenshots still pass without it.

```bash
# from this directory, once
bun install

# driven by the helper — do not call this by hand unless debugging
ARCHON_VERIFY_WEB_URL=http://127.0.0.1:15173 \
ARCHON_VERIFY_EVIDENCE_DIR=/path/to/evidence/runs/<id> \
bun run drive-console

ARCHON_VERIFY_WEB_URL=http://127.0.0.1:15173 \
ARCHON_VERIFY_API_URL=http://127.0.0.1:13090 \
ARCHON_VERIFY_EVIDENCE_DIR=/path/to/evidence/runs/<id> \
ARCHON_VERIFY_RUN_ID=<run-id> \
bun run drive-hitl-run-room
```

`drive-console` viewport is 1440×900. The project rail is `hidden lg:block` (Tailwind `lg` = 1024px); a mobile viewport would hide every rail assertion.

`drive-hitl-run-room` viewport is 1440×1000 (e2e split viewport) so the room uses the percentage split, not single-pane Back.

Selectors are taken from `packages/web/src/experiments/console/` (see `drive-console.mjs` and `drive-hitl-run-room.mjs`).
