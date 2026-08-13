# Lessons

- Pi and OMP share the same JSON event stream, model, thinking, and stdin contracts, but Pi uses `--approve` while OMP uses `--auto-approve`.
- Preserve nonzero agent CLI exits and surface structured provider errors so Ralph stops instead of retrying a permanent failure for every iteration.
- Grok accepts Ralph's prompt through `--prompt-file`, auto-approves with `--yolo`, and its `streaming-messages-json` output reuses the Claude-style `system`/`assistant`/`user`/`result` envelope.
- Grok model IDs and reasoning-effort menus are runtime-specific, so configure both for the selected Grok model instead of reusing Codex defaults.
