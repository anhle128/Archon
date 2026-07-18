#!/usr/bin/env python3
"""Validate a single envelope JSON file against the workflow command envelope schema.

Uses the existing validate_contracts.py schema_errors() function — the same
interpreter that validates static contract fixtures — rather than a partial
local reimplementation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: validate_runtime_envelope.py <envelope.json>', file=sys.stderr)
        return 2

    envelope_path = Path(sys.argv[1])
    repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
    contracts_root = (
        repo_root
        / '_bmad-output'
        / 'planning-artifacts'
        / 'contracts'
        / 'workflow-commander'
    )
    schema_path = contracts_root / 'schemas' / 'workflow-command-envelope.schema.json'
    validator_dir = contracts_root

    sys.path.insert(0, str(validator_dir))
    from validate_contracts import schema_errors  # type: ignore[import-not-found]

    envelope = json.loads(envelope_path.read_text(encoding='utf-8'))
    schema = json.loads(schema_path.read_text(encoding='utf-8'))

    errors = schema_errors(envelope, schema, schema, [])
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
