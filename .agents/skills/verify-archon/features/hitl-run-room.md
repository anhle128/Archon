# Inspect and Answer HITL Runs

The [JSON contract](hitl-run-room.json) covers room layout, navigation, complete
execution history, Ask input, retained answers, ownership, and continuation on
Console and Legacy.

The critical Ask journey starts a real workflow and pauses at Ask. The browser
selects an answer and clicks Submit; the test observes the real POST, reads the
exact stored answer, resumes according to run origin, reloads, and asserts the
final UI. API seeding cannot replace the browser action being verified.

Actor/origin partitions matter: an identified owner, a genuinely unowned solo
CLI run, and a web-origin run exercise different paths. Keep authorization
checks separate; they require authenticated server setup.

```bash
.agents/skills/verify-archon/bin/verify-archon prove \
  --scenario hitl.console-ask-submit \
  --scenario hitl.console-unowned-ask \
  --scenario hitl.legacy-unowned-ask
```

These diagnostic scenarios are a subset. Use normalized selection for a
change-level claim or `prove hitl-run-room` to run the complete mapped suite.

Room proofs measure actual width and reclaimed space, exercise resizing and
mobile Back, and verify selected-execution history. Their entry locators
support historical room markup so a negative control fails on the behavior,
not a newly introduced DOM id. Long-history proof first establishes that the
fixture produced more than 100 tool calls.

Scenario implementations live in `e2e/ui/workflow-run-hitl*.spec.ts`.
There is no separate UI driver in this skill.
