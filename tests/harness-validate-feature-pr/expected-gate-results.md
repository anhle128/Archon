# harness-validate-feature-pr — captured gate proof

Output of `python3 tests/harness-validate-feature-pr/verify_http_gate.py` (stdlib + curl, localhost only).
The test extracts the gate Python from the committed workflow YAML, so this is the actual shipped gate, not a copy.
Each case asserts the verdict AND a substring of the written `http-plan-results.md`.
Re-run to regenerate.

```text
# harness-validate-feature-pr gate proof
gate extracted from .archon/workflows/defaults/harness-validate-feature-pr.yaml (runtime-http PLAN heredoc)

## positive: 2xx registry + typed 405
expected verdict: HTTP_PLAN_EXERCISED ; results must contain: 'feature_exercised=3/3 happy_2xx=2'
actual verdict:   HTTP_PLAN_EXERCISED   [PASS]
    | 1 | GET | /v1/harnesses | 200 | pass (registry list) |
    | 2 | POST | /v1/harnesses/gigo/check | 200 | pass (harness check) |
    | 3 | GET | /v1/harnesses/gigo/check | 405 | pass (typed 405) |
    feature_exercised=3/3 happy_2xx=2

## status mismatch: reconnect 503 vs expect 200
expected verdict: HTTP_PLAN_FAILED ; results must contain: 'status 503 not in [200]'
actual verdict:   HTTP_PLAN_FAILED   [PASS]
    | 1 | GET | /v1/harnesses | 200 | pass (registry list) |
    | 2 | POST | /v1/sessions/sess-1/reconnect | 503 | fail status 503 not in [200] (reconnect as happy path) |
    feature_exercised=1/2 happy_2xx=1

## only 4xx, no live 2xx
expected verdict: HTTP_PLAN_FAILED ; results must contain: 'happy_2xx=0'
actual verdict:   HTTP_PLAN_FAILED   [PASS]
    | 1 | GET | /v1/harnesses/gigo/check | 405 | pass (only 405) |
    feature_exercised=1/1 happy_2xx=0

## empty invariant rejected, isolated by a valid 2xx (happy_2xx>=1)
expected verdict: HTTP_PLAN_FAILED ; results must contain: 'body invariant required'
actual verdict:   HTTP_PLAN_FAILED   [PASS]
    | 1 | GET | /v1/harnesses | 200 | pass (registry list) |
    | 2 | POST | /v1/sessions/sess-1/reconnect |  | rejected: body invariant required (reconnect no invariant) |
    feature_exercised=1/1 happy_2xx=1

## expect_statuses [200,409], live 200
expected verdict: HTTP_PLAN_EXERCISED ; results must contain: 'feature_exercised=1/1 happy_2xx=1'
actual verdict:   HTTP_PLAN_EXERCISED   [PASS]
    | 1 | GET | /v1/harnesses | 200 | pass (registry list) |
    feature_exercised=1/1 happy_2xx=1

=== 5/5 cases as expected ===
```

Interpretation:

Case 2 is the exact false positive the gate now blocks: a 503 declared `expect_status: 200` is `fail status 503 not in [200]`, so the plan is `HTTP_PLAN_FAILED` even though one request passed.
Case 3 shows a 4xx alone cannot pass the plan (`happy_2xx=0`).
Case 4 isolates invariant rejection: a valid 2xx satisfies the happy-2xx gate, so the only reason for `HTTP_PLAN_FAILED` is the empty invariant being rejected (`body invariant required`).
