# Architecture Diagrams

Diagrams for the node-centric run view and the HITL lifecycle. Prose lives in `SPEC.md` and `hitl-contract.md`; this file holds the visuals only. Target surface is the legacy `WorkflowExecution.tsx`.

## Run view layout (CAP-1, CAP-2, CAP-3)

All three surfaces are retained (Graph / Logs / Chat). The **Graph** is now also a per-node log-history entry point (click a node → its agent log); the **Logs** tab is kept as-is; the **Chat** surface becomes a user-turns + node-status timeline. The selected-node panel **adapts to node type** — not every node is an agent session.

```mermaid
flowchart LR
  subgraph View["Workflow Run View (legacy WorkflowExecution.tsx)"]
    direction LR
    subgraph Left["Graph (per-node log entry) + Logs tab + Chat timeline"]
      G["DAG graph (per-node log history) — mixed node types<br/>status: pending/running/awaiting/done/failed"]
      L["Logs tab (retained): merged run stream"]
      C["Chat timeline<br/>user messages + node-status entries"]
    end
    subgraph Right["Selected-node panel (adapts to type)"]
      A["agent node (command/prompt/loop):<br/>agent room = text + tool calls + status<br/>+ inline HITL card when awaiting"]
      B["bash/script: captured stdout + status"]
      D["route_loop: routing decision<br/>loop_group: body sub-graph"]
      E["approval/plannotator_gate: the gate<br/>workflow: link to child sub-run"]
    end
  end
  G -- "click node" --> A
  G -- "click node" --> B
  G -- "click node" --> D
  G -- "click node" --> E
  C -- "click node entry" --> A
```

## HITL lifecycle (CAP-4, CAP-5) — durable target

Structured, agent-signaled block → inline card → typed response → only that node's turn resumes. Mechanism and verification status (same-process vs durable; Pi vs Claude): `hitl-contract.md` (Mechanism).

```mermaid
sequenceDiagram
  participant Agent as Agent node (command/prompt/loop)
  participant Engine as Run engine
  participant Room as Node room (UI)
  participant User as Human

  Agent->>Engine: AskHuman tool call (Ask) / permission path (Permission)
  Note over Agent,Engine: never prose; NL is not a wire format.<br/>NOT a declared approval gate (that is a separate node)
  Engine->>Engine: node -> awaiting; persist pending interaction (sessionId, tool_use_id)
  Engine->>Room: normalize -> pending_interaction envelope (ask | permission)
  Room-->>User: inline card in the node room
  User->>Room: respond (typed per form)
  alt Ask
    Room->>Engine: answer(request_id, answers[] | decline)
  else Permission
    Room->>Engine: confirm(call_id, intent)
  end
  Engine->>Agent: re-drive turn — Pi: continue() (answer as tool_result) | Claude: resume as a new user message
  Agent->>Engine: node resumes -> completion
  Note over Room: card stays in history as a record
```

## Provider production paths (CAP-7)

One provider-agnostic contract; production mechanism differs per provider; unsupported fails loud.

```mermaid
flowchart TD
  E["Provider-agnostic HITL contract<br/>(ask + permission forms)"]
  E --> P1{"Provider capability"}
  P1 -- "Claude (native MCP tool)" --> N1["AskHuman in-process tool<br/>same-process VERIFIED · durable = new user message on resume<br/>VERIFIED Sonnet+Opus (no re-issue; synthetic result no interference)"]
  P1 -- "Pi (tool + continue())" --> N2["AskHuman tool<br/>durable VERIFIED via continue() (cross-process restart)"]
  P1 -- "Codex / Grok / OpenCode / Copilot<br/>(no in-process native-tool path)" --> O["v1: explicit 'unsupported' (fail loud)<br/>ACP/approval-gate fallback deferred"]
  P1 -- "no viable mechanism" --> F["Explicit 'unsupported' (fail loud, never hang)"]
  N1 --> R["Render: one pending_interaction envelope<br/>(Permission form dormant under auto-approve)"]
  N2 --> R
  O --> R
```
