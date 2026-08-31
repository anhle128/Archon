#!/usr/bin/env python3
"""Reproducible proof for the harness-validate-feature-pr HTTP plan gate.

This test does NOT copy the gate logic. It extracts the exact `PLAN` Python
heredoc from the committed workflow YAML
(`.archon/workflows/defaults/harness-validate-feature-pr.yaml`, node
`runtime-http`) and runs it against a local mock daemon. So it always proves the
gate that ships, and cannot drift from it.

Each case asserts BOTH the final verdict AND a substring of the written
`http-plan-results.md`, so a case never passes for an unrelated reason (e.g. a
`HTTP_PLAN_FAILED` that came from the happy-2xx gate rather than the behavior
under test).

Run:  python3 tests/harness-validate-feature-pr/verify_http_gate.py
Exit: 0 all cases as expected, 1 otherwise.
Deps: stdlib + curl (localhost only, no network).
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

WORKFLOW_REL = ".archon/workflows/defaults/harness-validate-feature-pr.yaml"


def repo_root() -> Path:
    p = Path(__file__).resolve()
    for parent in [p.parent, *p.parents]:
        if (parent / WORKFLOW_REL).is_file():
            return parent
    raise SystemExit("cannot locate repo root containing %s" % WORKFLOW_REL)


def extract_gate_python(yaml_text: str) -> str:
    """Pull the `<< 'PY'` heredoc whose body defines the plan gate.

    The bash lives in a YAML block scalar indented 6 spaces, so every body line
    carries that indent; strip it to recover runnable module-level Python.
    """
    lines = yaml_text.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        if "<< 'PY'" in lines[i]:
            body = []
            i += 1
            while i < len(lines) and lines[i].strip() != "PY":
                ln = lines[i]
                body.append(ln[6:] if ln[:6] == "      " else ln)
                i += 1
            blocks.append("\n".join(body))
        i += 1
    gate = [b for b in blocks if "feature_exercised" in b]
    if not gate:
        raise SystemExit("no plan-gate heredoc (feature_exercised) found in YAML")
    return gate[-1]


class MockDaemon(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        return

    def _send(self, code: int, body: str):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/v1/harnesses":
            return self._send(200, '{"items":[{"id":"gigo"}]}')
        if self.path == "/v1/harnesses/candidates":
            return self._send(200, '{"items":[]}')
        if self.path == "/v1/harnesses/gigo/check":
            return self._send(405, '{"error":"method_not_allowed"}')
        return self._send(404, '{"error":"not_found"}')

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        if self.path.startswith("/v1/sessions/") and self.path.endswith("/reconnect"):
            return self._send(503, '{"error":"unavailable"}')
        if self.path == "/v1/harnesses/gigo/check":
            return self._send(200, '{"ok":true}')
        return self._send(404, '{"error":"not_found"}')


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def run_case(gate_py_path: str, port: int, reqs: list) -> tuple:
    art = Path(tempfile.mkdtemp(prefix="gate-"))
    try:
        env = dict(os.environ)
        env["ARTIFACTS_DIR"] = str(art)
        env["HTTP_PORT"] = str(port)
        env["CID"] = "sess-1"
        env["PLAN_REQUESTS"] = json.dumps(reqs)
        out = subprocess.run(
            [sys.executable, gate_py_path],
            env=env,
            capture_output=True,
            text=True,
            timeout=90,
        )
        verdict = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
        results = ""
        rp = art / "http-plan-results.md"
        if rp.is_file():
            results = rp.read_text()
        return verdict, results, out.stderr.strip()
    finally:
        shutil.rmtree(art, ignore_errors=True)


# (name, requests, expected_verdict, must_contain_in_results)
CASES = [
    (
        "positive: 2xx registry + typed 405",
        [
            {"method": "GET", "path": "/v1/harnesses", "body": "",
             "expect_status": 200, "invariant": "\"items\"", "claim": "registry list"},
            {"method": "POST", "path": "/v1/harnesses/gigo/check", "body": "{}",
             "expect_status": 200, "invariant": "json", "claim": "harness check"},
            {"method": "GET", "path": "/v1/harnesses/gigo/check", "body": "",
             "expect_status": 405, "invariant": "method_not_allowed", "claim": "typed 405"},
        ],
        "HTTP_PLAN_EXERCISED",
        "feature_exercised=3/3 happy_2xx=2",
    ),
    (
        "status mismatch: reconnect 503 vs expect 200",
        [
            {"method": "GET", "path": "/v1/harnesses", "body": "",
             "expect_status": 200, "invariant": "\"items\"", "claim": "registry list"},
            {"method": "POST", "path": "/v1/sessions/{session_id}/reconnect", "body": "{}",
             "expect_status": 200, "invariant": "json", "claim": "reconnect as happy path"},
        ],
        "HTTP_PLAN_FAILED",
        "status 503 not in [200]",
    ),
    (
        "only 4xx, no live 2xx",
        [
            {"method": "GET", "path": "/v1/harnesses/gigo/check", "body": "",
             "expect_status": 405, "invariant": "method_not_allowed", "claim": "only 405"},
        ],
        "HTTP_PLAN_FAILED",
        "happy_2xx=0",
    ),
    (
        "empty invariant rejected, isolated by a valid 2xx (happy_2xx>=1)",
        [
            {"method": "GET", "path": "/v1/harnesses", "body": "",
             "expect_status": 200, "invariant": "\"items\"", "claim": "registry list"},
            {"method": "POST", "path": "/v1/sessions/{session_id}/reconnect", "body": "{}",
             "expect_status": 503, "invariant": "", "claim": "reconnect no invariant"},
        ],
        "HTTP_PLAN_FAILED",
        "body invariant required",
    ),
    (
        "expect_statuses [200,409], live 200",
        [
            {"method": "GET", "path": "/v1/harnesses", "body": "",
             "expect_status": 200, "expect_statuses": [200, 409],
             "invariant": "\"items\"", "claim": "registry list"},
        ],
        "HTTP_PLAN_EXERCISED",
        "feature_exercised=1/1 happy_2xx=1",
    ),
]


def main() -> int:
    root = repo_root()
    yaml_text = (root / WORKFLOW_REL).read_text()
    gate_py = extract_gate_python(yaml_text)

    tmp = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False)
    tmp.write(gate_py)
    tmp.close()

    port = free_port()
    httpd = HTTPServer(("127.0.0.1", port), MockDaemon)
    th = threading.Thread(target=httpd.serve_forever, daemon=True)
    th.start()

    failures = 0
    print("# harness-validate-feature-pr gate proof")
    print("gate extracted from %s (runtime-http PLAN heredoc)\n" % WORKFLOW_REL)
    try:
        for name, reqs, expected, must_contain in CASES:
            verdict, results, err = run_case(tmp.name, port, reqs)
            verdict_ok = verdict == expected
            text_ok = must_contain in results
            ok = verdict_ok and text_ok
            failures += 0 if ok else 1
            print("## %s" % name)
            print("expected verdict: %s ; results must contain: %r" % (expected, must_contain))
            print("actual verdict:   %s   [%s]" % (
                verdict or "(no verdict)",
                "PASS" if ok else ("FAIL verdict" if not verdict_ok else "FAIL missing-substring"),
            ))
            for ln in results.splitlines():
                if ln.startswith("| ") or ln.startswith("feature_exercised"):
                    print("    " + ln)
            if not ok and err:
                print("    stderr: " + err[:300])
            print()
    finally:
        httpd.shutdown()
        os.unlink(tmp.name)

    print("=== %d/%d cases as expected ===" % (len(CASES) - failures, len(CASES)))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
