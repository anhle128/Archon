# HITL contract (Ask + Permission envelope)

Wire shapes both surfaces and the engine must share. HOW (tables, pause port, projectors) is AD-1 / AD-7 in the architecture spine. This file is the payload catalog.

## Envelope

One `pending_interaction` for Ask and Permission.

| Field                 | Rule                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `kind`                | `ask` \| `permission`                                            |
| `status`              | `pending` \| `answered` \| `purged`                              |
| `tool_use_id`         | Unique per run. **Is** Ask `request_id` and Permission `call_id` |
| `node_id`             | DAG node                                                         |
| `provider_session_id` | Resume session; written at ask time                              |
| `envelope`            | Form/prompt only — never the answer                              |
| `answer`              | Nullable; set on resolve                                         |

Cards are this row (embedded on `GET /api/workflows/runs/:runId` as `pending_interactions`). They are not transcript `status` rows and not SSE payloads. SSE `node_awaiting` / `interaction_resolved` are refetch triggers.

## Ask (`kind: ask`) — CAP-4

**Tool input / `envelope.questions[]`** (ordered):

| Field        | Rule                                                    |
| ------------ | ------------------------------------------------------- |
| `id`         | Stable per question; becomes `questionId` in the answer |
| `prompt`     | Question text                                           |
| `selection`  | `single` \| `multi`                                     |
| `options`    | Display strings                                         |
| `allowOther` | If true, Other is a first-class option                  |

Other selected ⇒ `value` must be non-empty. Client Submit stays disabled until every question is valid. One POST answers the whole card.

**POST** ` /api/workflows/runs/:runId/ask/:requestId/answer`

- `{ answers: { questionId, value }[] }`
- or `{ decline: true }` — agent receives `"declined"` and decides the node outcome

`requestId` = `tool_use_id`. First answer wins; already resolved → 409. Only `workflow_runs.user_id` may mutate.

## Permission (`kind: permission`) — envelope only

**POST** `/api/workflows/runs/:runId/permissions/:callId/confirm`

- `{ intent: string }`
- `callId` = `tool_use_id`

No variant cards in v1.

## Reads

| GET                                                 | Returns                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `/api/workflows/runs/:runId`                        | `pending_interactions[]`, `nodeStates[].status` including `awaiting`       |
| `/api/workflows/runs/:runId/nodes/:nodeId/messages` | Agent-room transcript (`text` / `tool` / `status` notes), ordered by `seq` |

Unified render = these shapes, states, validity, and copy on both surfaces — not one React module.
