# Discover Story Inputs

Load only files that can affect the selected story, but follow every referenced authority and runtime boundary completely.

1. Load BMad config and resolve planning, implementation, and test artifact directories.
2. Load the selected epic/story definition, relevant PRD sections, architecture, UX, constitution, and every project-context file.
3. Look for `{planning_artifacts}/story-decisions/{story_key}/technical-decisions.md`.
   - Absence is valid and must be reported as `not present`.
   - When present, load it completely and validate its identity/gate before using it.
4. Load the nearest previous story and recent git history only for applicable implementation evidence and lessons.
5. Search the current repository from each named command, API, schema, operation, state, event, or public type. Read the defining files and relevant callers completely.
6. Trace ingress, operations, persistence, process boundaries, first-party consumers, shared legacy callers, generated artifacts, and owning tests.
7. Record every loaded path and every expected source that was absent. Do not silently substitute historical evidence for a missing canonical source.

For sharded documents, read the index and all shards referenced by the selected story. When relevance is uncertain at a contract boundary, load the candidate and classify it rather than omitting it.
