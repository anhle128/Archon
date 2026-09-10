# Console Navigation

The [JSON contract](web-console.json) links Console navigation and Settings to
`console.shell` and `console.settings` in `e2e/ui/console-shell.spec.ts`.

The shell scenario exercises the project rail, empty runs, and All filter.
Settings is opened through its navigation link and survives reload. Proof
runs collect browser screenshots as supporting evidence.

```bash
.agents/skills/verify-archon/bin/verify-archon prove web-console
```

A green Console shell does not prove run detail, Ask submission, persistence,
or continuation. Select the corresponding HITL behaviors for those claims.
