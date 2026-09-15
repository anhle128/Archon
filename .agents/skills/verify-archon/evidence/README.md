# Local Verification Evidence

New proofs live under ignored `runs/<verification-run-id>/`. They contain the
normalized selection (or explicitly diagnostic scenario request), deterministic
`result.json`, process logs, and scenario-keyed results/attachments. Cleanup
stops owned processes and preserves these artifacts.

The tracked `last-proof/` files predate the behavior/scenario contract. Keep
them as historical captures only; no current verdict reads or reuses them.
Selection artifacts under `last-select/` are local working files, not proofs.
