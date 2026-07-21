---
name: validate-story
description: Validate an existing BMAD story for implementation readiness. Use when the user asks to validate or revalidate a story before development; delegates to the independent `bmad-create-story validate` mode.
---

# Validate Story

Require exactly one existing story-file path, then invoke:

```text
$bmad-create-story validate <story-file>
```

Follow the `bmad-create-story` Validate Mode contract completely. Never invoke Create Mode, select a backlog story, rewrite substantive story content, or execute the legacy `_bmad/.../workflow.md` as an implied Validate Mode.
