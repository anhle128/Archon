---
name: archon-http
description: >-
  Operate the private Archon HTTP API on the OceanLabs Mac mini through Tailscale.
  Use only for trusted internal agents that must inspect Archon, start or monitor workflows, read run artifacts, or perform an explicitly authorized workflow action without local CLI access.
  Never use this skill for customer agents, public access, or non-Tailscale connections.
---

# Archon HTTP

Use `curl` or another HTTP client to call the private Archon server.
`archon-http` is the skill name, not a command or package.

## Connect

Use the Tailscale MagicDNS name because the Tailscale IP can change.

```bash
export ARCHON_HTTP_BASE_URL='http://minis-mac-mini:3090'
tailscale status
curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/health" | jq
```

Stop if `minis-mac-mini` is not visible in `tailscale status` or the health check fails.
Do not expose Archon on a public address or create a public proxy as a workaround.

## Discover the Live API

Treat the live OpenAPI document as the source of truth.
Read it before you use an unfamiliar route.

```bash
curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/openapi.json" \
  | jq -r '.paths | to_entries[] | .key as $path | .value | keys[] | "\(. | ascii_upcase) \($path)"'
```

Inspect one operation when you need its parameters, request schema, or response schema.

```bash
curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/openapi.json" \
  | jq '.paths["/api/workflows/runs/{runId}"].get'
```

`POST /api/workflows/{name}/run` accepts JSON with `conversationId` and `message`.
Its OpenAPI operation omits the body because the same route also accepts multipart uploads.

## Protect the Internal Service

- Treat Tailscale membership as the network access boundary.
- Do not publish the host name, tailnet name, responses, or OpenAPI document outside OceanLabs.
- Do not send secrets in URLs, shell history, logs, or agent responses.
- Do not invent an `X-Archon-User` value.
- Use that header only when the caller supplies a verified internal Archon user ID and needs user-specific credentials.
- Inspect state before every write.
- Start workflows only when the task asks for execution or delegation.
- Approve, reject, resume, retry, cancel, abandon, delete, or change configuration only when the user explicitly asks for that action.

## Run a Workflow

List the server's registered codebases and workflows first.
Any `cwd` or local path in a request refers to the Mac mini, not to the calling machine.

```bash
curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/codebases" | jq

curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/workflows" | jq
```

Create one web conversation for the run.
Use a codebase ID from the server response.

```bash
export ARCHON_CODEBASE_ID='replace-with-codebase-id'

ARCHON_CONVERSATION_ID=$(
  jq -n --arg codebaseId "$ARCHON_CODEBASE_ID" '{codebaseId: $codebaseId}' \
  | curl --fail-with-body --silent --show-error \
      -X POST "$ARCHON_HTTP_BASE_URL/api/conversations" \
      -H 'Content-Type: application/json' \
      --data-binary @- \
  | jq -er '.conversationId'
)
export ARCHON_CONVERSATION_ID
```

Start the workflow and keep the dispatch response.
An accepted dispatch is not a completed run.

```bash
export ARCHON_WORKFLOW_NAME='replace-with-workflow-name'
export ARCHON_WORKFLOW_MESSAGE='replace-with-task'

jq -n \
  --arg conversationId "$ARCHON_CONVERSATION_ID" \
  --arg message "$ARCHON_WORKFLOW_MESSAGE" \
  '{conversationId: $conversationId, message: $message}' \
| curl --fail-with-body --silent --show-error \
    -X POST "$ARCHON_HTTP_BASE_URL/api/workflows/$ARCHON_WORKFLOW_NAME/run" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
| jq
```

Find the created run by its conversation ID.

```bash
curl --fail-with-body --silent --show-error --get \
  "$ARCHON_HTTP_BASE_URL/api/workflows/runs" \
  --data-urlencode "conversationId=$ARCHON_CONVERSATION_ID" \
  --data-urlencode 'limit=10' \
| jq
```

## Monitor and Act

Read the run detail until `run.status` is terminal or the run pauses.
Use a moderate polling interval, or use the SSE stream for live events.

```bash
export ARCHON_RUN_ID='replace-with-run-id'

curl --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/workflows/runs/$ARCHON_RUN_ID" | jq

curl --no-buffer --fail-with-body --silent --show-error \
  "$ARCHON_HTTP_BASE_URL/api/stream/$ARCHON_CONVERSATION_ID"
```

Inspect `run`, `events`, and `nodeStates` before you report the result.
When a run pauses on a child workflow, act on the child run ID from the parent detail.
After any authorized action, fetch the run detail again and verify the new state.

```bash
# Approve only after the user gives approval.
jq -n --arg comment 'replace-with-user-comment' '{comment: $comment}' \
| curl --fail-with-body --silent --show-error \
    -X POST "$ARCHON_HTTP_BASE_URL/api/workflows/runs/$ARCHON_RUN_ID/approve" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
| jq

# Resume only when the inspected run is resumable and the user asked to continue.
curl --fail-with-body --silent --show-error \
  -X POST "$ARCHON_HTTP_BASE_URL/api/workflows/runs/$ARCHON_RUN_ID/resume" | jq
```

Report the HTTP status, Archon error body, and route when a request fails.
Do not bypass an error by changing the target host, disabling safeguards, or using the public internet.
