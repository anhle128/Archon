#!/usr/bin/env python3
"""Drift-proof checks for harness-validate-feature-pr-runtime-tui.md.

Live tui-test still runs against a pager binary. This file only guards the
recipes that PR 177 failed on: macOS bash 3.2 has no coproc, wrap needles must
be typed, OpenDashboard is kitty CSI-u, and tui-test may live in Homebrew.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CMD = (
    ROOT
    / ".archon"
    / "commands"
    / "defaults"
    / "harness-validate-feature-pr-runtime-tui.md"
)

REQUIRED = (
    "no `coproc`",
    "Never write `coproc`",
    "WRAPHEAD",
    "ENDK",
    "ZWRAPHEAD",
    "ENDKQ",
    "session_kind",
    'expect text "clone worktree" --not',
    "clone worktree",
    "92;5u",
    "--no-leader --trust",
    "/opt/homebrew/bin",
    "HELPER_PID=$!",
)


def main() -> int:
    text = CMD.read_text()
    missing = [needle for needle in REQUIRED if needle not in text]
    if "coproc" in text and "Never write `coproc`" not in text:
        missing.append("explicit coproc ban")
    if missing:
        print("FAIL: runtime-tui.md missing required TUI recipes:")
        for item in missing:
            print(f"  - {item}")
        return 1
    print(f"PASS: {CMD.relative_to(ROOT)} contains bash-3.2 / wrap / CSI-u recipes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
