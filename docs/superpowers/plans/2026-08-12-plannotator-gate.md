# Plannotator Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Archon `plannotator_gate` node that pauses a durable workflow gate while supervising a live Plannotator annotate session (Ask AI + annotate + Approve), plus an opt-in Plannotator `--persist-session` flag so Close does not kill the shared live server for team review.

**Architecture:** Plannotator gains additive `--persist-session` (Close keeps process; Approve/Send Annotations still end session). Archon adds a new DAG node type `plannotator_gate` (does not modify `approval:`). On enter, the executor validates a path from `$prev.output`, pauses the run with `ApprovalContext.type = 'plannotator_gate'`, and blocks in a supervisor loop that spawns `plannotator annotate <path> --gate --json --persist-session`. Terminal decisions map to `approveWorkflow` or in-place rework agent; process death recovers via `review-open`.

**Tech Stack:** Bun, TypeScript, Zod (`@hono/zod-openapi`), Archon `@archon/workflows` + `@archon/core` + `@archon/cli` + `@archon/server`, Plannotator Bun HTTP annotate server + hook CLI.

**Spec:** `docs/superpowers/specs/2026-08-12-plannotator-gate-design.md`

## Global Constraints

- Do **not** change default Plannotator behavior when `--persist-session` is omitted.
- Do **not** fatten existing `approval:` YAML semantics.
- Document path contract B: entire previous node output = one path string (first non-empty line after trim).
- Archon is gate of record; Plannotator is surface only.
- Prefer small focused modules; avoid growing `dag-executor.ts` without extracting helpers.
- Comments must not reference plan IDs/phase numbers (project rule).
- Tests: use `bun test <file>` inside the package; never root `bun test` for Archon full suite pollution.
- Two repos: Plannotator (`/Users/dale/Desktop/workspace/opensources/plannotator`) then Archon (`archon` workspace).

## File map

### Plannotator (upstream)

| File | Role |
|------|------|
| `apps/hook/server/index.ts` | Parse `--persist-session`, pass into annotate server |
| `apps/hook/server/cli.ts` / help strings | Document flag |
| `packages/server/annotate.ts` | `persistSession` option; `/api/exit` keep-alive branch |
| `packages/server/annotate.test.ts` | Tests for keep-alive vs stock exit |
| `packages/ui` Close/exit callback (if client assumes process always dies) | Honor `keptAlive` response |
| `apps/marketing/src/content/docs/commands/annotate.md` | Docs |

### Archon

| File | Role |
|------|------|
| `packages/workflows/src/schemas/dag-node.ts` | `plannotatorGateConfigSchema`, node variant, mutual exclusivity, `isPlannotatorGateNode` |
| `packages/workflows/src/schemas/workflow-run.ts` | Extend `ApprovalContext.type` with `'plannotator_gate'`; optional document/phase fields |
| `packages/workflows/src/schemas/index.ts` | Re-exports |
| `packages/workflows/src/plannotator-gate.ts` | Pure helpers: path parse, decision parse, spawn args, types |
| `packages/workflows/src/plannotator-gate-supervisor.ts` | Supervisor loop (spawn/wait/poll/rework) |
| `packages/workflows/src/dag-executor.ts` | Dispatch `executePlannotatorGateNode` |
| `packages/workflows/src/loader.ts` | Treat gate like approval for message/ref sources if needed |
| `packages/workflows/src/include-expander.ts` | Substitute `document` / `message` / `rework.prompt` if include supports it |
| `packages/core/src/operations/workflow-operations.ts` | `approveWorkflow` accepts `type: 'plannotator_gate'` like standard approval |
| `packages/cli/src/cli.ts` + `packages/cli/src/commands/workflow.ts` | `workflow review-open` |
| `packages/server/src/routes/api.ts` + schemas | `POST .../review-open` |
| `.archon/workflows/defaults/archon-speckit-feature.yaml` | Wire clarify (+ red-team) gates |
| Docs under `packages/docs-web/` | Node reference |

---

### Task 1: Plannotator `--persist-session` (server + CLI)

**Repos:**
- Modify: `packages/server/annotate.ts` (`AnnotateServerOptions`, `/api/exit`)
- Modify: `apps/hook/server/index.ts` (flag parse near existing `--gate`)
- Modify: `apps/hook/server/cli.ts` help text for annotate
- Test: `packages/server/annotate.test.ts`

**Interfaces:**
- Produces: `AnnotateServerOptions.persistSession?: boolean`
- Produces: CLI flag `--persist-session` → `gate` still independent; flag only affects exit
- Produces: `POST /api/exit` with persist → `{ ok: true, keptAlive: true }` and does **not** call `resolveDecision`

- [ ] **Step 1: Write failing test** — close/exit with `persistSession: true` does not resolve `waitForDecision`

In `packages/server/annotate.test.ts`, add a test patterned on existing `/api/approve` tests:

```typescript
test("persistSession: POST /api/exit does not resolve waitForDecision", async () => {
  const server = await startAnnotateServer({
    markdown: "# hi",
    filePath: "doc.md",
    htmlContent: "<html></html>",
    gate: true,
    persistSession: true,
  });
  try {
    let settled = false;
    const decision = server.waitForDecision().then((r) => {
      settled = true;
      return r;
    });
    const res = await fetch(`${server.url}/api/exit`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, keptAlive: true });
    await Bun.sleep(50);
    expect(settled).toBe(false);
    // Approve still ends session
    await fetch(`${server.url}/api/approve`, { method: "POST" });
    await expect(decision).resolves.toMatchObject({ approved: true });
  } finally {
    server.stop();
  }
});
```

- [ ] **Step 2: Run test — expect FAIL** (option missing / exit still resolves)

```bash
cd /Users/dale/Desktop/workspace/opensources/plannotator
bun test packages/server/annotate.test.ts
```

- [ ] **Step 3: Implement server option**

In `AnnotateServerOptions` add `persistSession?: boolean` (default false).

In `/api/exit` handler (~line 698):

```typescript
if (url.pathname === "/api/exit" && req.method === "POST") {
  if (persistSession) {
    return Response.json({ ok: true, keptAlive: true });
  }
  deleteDraft(draftKey, readDraftGenerationFromUrl(req));
  resolveDecision({ feedback: "", annotations: [], exit: true });
  return Response.json({ ok: true });
}
```

Pass `persistSession` from options into the request handler closure.

- [ ] **Step 4: CLI flag**

In `apps/hook/server/index.ts`, next to `--gate` parsing:

```typescript
const persistIdx = args.indexOf("--persist-session");
const persistSession = persistIdx !== -1;
if (persistSession) args.splice(persistIdx, 1);
```

Pass `persistSession` into `startAnnotateServer({ ..., gate: gateFlag, persistSession })`.

Update annotate usage/help strings to list `--persist-session`.

- [ ] **Step 5: Stock regression test** — without flag, `/api/exit` still resolves with `exit: true` (existing or new assert).

- [ ] **Step 6: Run tests — expect PASS**

```bash
bun test packages/server/annotate.test.ts
```

- [ ] **Step 7: Commit in plannotator repo**

```bash
git add packages/server/annotate.ts packages/server/annotate.test.ts apps/hook/server/index.ts apps/hook/server/cli.ts
git commit -m "feat(annotate): add --persist-session so Close does not end the server"
```

---

### Task 2: Plannotator UI + docs for keep-alive exit

**Files:**
- Modify: UI exit/Close handler that POSTs `/api/exit` (search `api/exit` under `packages/ui`)
- Modify: `apps/marketing/src/content/docs/commands/annotate.md`
- Test: existing UI unit tests if any; else manual note

**Interfaces:**
- Consumes: `{ ok: true, keptAlive?: boolean }` from `/api/exit`
- Produces: when `keptAlive`, do not show “session ended / Annotations Sent” completion that implies process death; allow user to close tab or show “left session; server still running”

- [ ] **Step 1: Find Close/exit client path**

```bash
rg -n "api/exit|/exit" packages/ui --glob '**/*.{ts,tsx}'
```

- [ ] **Step 2: Adjust client** so `keptAlive: true` skips terminal completion overlay / does not set submitted state that blocks further use if the user reloads the same URL.

- [ ] **Step 3: Document flag** in annotate.md Flags section:

```markdown
### `--persist-session`

When set, **Close** does not end the annotate server process (no decision is emitted).
**Approve** and **Send Annotations** still end the session as usual.
Use for team review on a shared live URL: teammates can leave without killing the owner's session.
```

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(annotate): document --persist-session and handle keptAlive exit UI"
```

---

### Task 3: Archon schema — `plannotator_gate` node

**Files:**
- Modify: `packages/workflows/src/schemas/dag-node.ts`
- Modify: `packages/workflows/src/schemas/index.ts`
- Modify: `packages/workflows/src/schemas/workflow-run.ts` (`ApprovalContext.type`)
- Test: `packages/workflows/src/schemas.test.ts` and/or `loader.test.ts`

**Interfaces:**
- Produces:

```typescript
// YAML
// plannotator_gate:
//   document: string  // required, often "$prev.output"
//   message?: string
//   capture_response?: boolean
//   rework: { prompt: string; provider?: string; model?: string; effort?: string }

export const plannotatorGateConfigSchema = z.object({
  document: z.string().min(1),
  message: z.string().optional(),
  capture_response: z.boolean().optional(),
  rework: z.object({
    prompt: z.string().min(1),
    provider: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
});

export type PlannotatorGateNode = z.infer<typeof plannotatorGateNodeSchema> & {
  // never: other mode fields like ApprovalNode
};

export function isPlannotatorGateNode(node: DagNode): node is PlannotatorGateNode;
```

- Extend `ApprovalContext.type` union: `'plannotator_gate'`
- Optional metadata fields on context (documented in comments): `document?: string`, `phase?: 'opening' | 'waiting_decision' | 'reworking' | 'idle'`

- [ ] **Step 1: Failing loader/schema tests**

```typescript
it('parses plannotator_gate node', () => {
  const raw = {
    id: 'clarify-gate',
    plannotator_gate: {
      document: '$explain.output',
      rework: { prompt: 'fix $REVIEW_ANNOTATIONS' },
    },
  };
  const parsed = dagNodeSchema.safeParse(raw);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(isPlannotatorGateNode(parsed.data)).toBe(true);
  }
});

it('rejects plannotator_gate without rework.prompt', () => {
  const parsed = dagNodeSchema.safeParse({
    id: 'g',
    plannotator_gate: { document: '/tmp/a.html' },
  });
  expect(parsed.success).toBe(false);
});

it('rejects plannotator_gate combined with approval', () => {
  const parsed = dagNodeSchema.safeParse({
    id: 'g',
    approval: { message: 'x' },
    plannotator_gate: { document: 'p', rework: { prompt: 'y' } },
  });
  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 2: Run — FAIL**

```bash
cd /Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon
bun test packages/workflows/src/schemas.test.ts
# or loader.test.ts batch that owns dag parsing
```

- [ ] **Step 3: Implement schema**

1. Add `plannotator_gate: plannotatorGateConfigSchema.optional()` to `dagNodeFlatSchema` shape.
2. Add `hasPlannotatorGate` to `modeCount` mutual-exclusivity list and error message.
3. Transform branch: if `data.plannotator_gate` defined → return `PlannotatorGateNode`.
4. Add `isPlannotatorGateNode` type guard.
5. Export from `schemas/index.ts`.
6. Update `ApprovalContext.type` in `workflow-run.ts` and any switch that exhaustiveness-checks types (approve path should treat `plannotator_gate` like standard approval for `node_completed` writing — see Task 6).

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workflows): add plannotator_gate DAG node schema"
```

---

### Task 4: Pure helpers — path + decision parse + spawn argv

**Files:**
- Create: `packages/workflows/src/plannotator-gate.ts`
- Create: `packages/workflows/src/plannotator-gate.test.ts`
- Modify: `packages/workflows/package.json` test script to include the new test file in an appropriate batch

**Interfaces:**

```typescript
export function parseDocumentPathFromNodeOutput(output: string): string;
// trim, first non-empty line; throw if empty

export type PlannotatorGateDecision =
  | { kind: 'approved'; feedback: string }
  | { kind: 'annotated'; feedback: string }
  | { kind: 'dismissed' };

export function parsePlannotatorGateDecisionJson(stdout: string): PlannotatorGateDecision;
// parse last non-empty line as JSON; decision field required

export function buildAnnotateArgv(documentPath: string): string[];
// ['annotate', documentPath, '--gate', '--json', '--persist-session']

export function resolvePlannotatorBinary(): string;
// process.env.PLANNOTATOR_BIN ?? 'plannotator' (Bun.which check in supervisor)
```

- [ ] **Step 1: Write unit tests** for path (trim, multi-line), JSON decisions, argv.

- [ ] **Step 2: Implement helpers**

- [ ] **Step 3: Run**

```bash
bun test packages/workflows/src/plannotator-gate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(workflows): add plannotator gate path/decision helpers"
```

---

### Task 5: Supervisor loop module

**Files:**
- Create: `packages/workflows/src/plannotator-gate-supervisor.ts`
- Create: `packages/workflows/src/plannotator-gate-supervisor.test.ts` (mock spawn)

**Interfaces:**

```typescript
export interface PlannotatorGateSupervisorDeps {
  runId: string;
  nodeId: string;
  cwd: string;
  initialDocumentPath: string;
  captureResponse: boolean;
  reworkPromptTemplate: string;
  message: string;
  store: IWorkflowStore;
  /** Spawn rework AI; must return path string (contract B) on success */
  runReworkAgent: (args: {
    prompt: string;
    documentPath: string;
    annotations: string;
  }) => Promise<string>;
  /** Injectable for tests */
  spawnAnnotate?: (documentPath: string) => Promise<{
    wait: () => Promise<{ exitCode: number; stdout: string }>;
    kill: () => void;
  }>;
  pollIntervalMs?: number;
}

export async function runPlannotatorGateSupervisor(
  deps: PlannotatorGateSupervisorDeps
): Promise<{ output: string }>;
// Returns when gate completed (approved); throws/fails node on hard errors
```

**Loop algorithm (must match spec):**

1. `pauseWorkflowRun` / `pauseGateRespectingExternalTransition` with  
   `{ type: 'plannotator_gate', nodeId, message, captureResponse, document: path, phase: 'waiting_decision', resolved: null }`.
2. Loop:
   - Refresh run from store. If `status` cancelled → abort. If `approval.resolved === 'approved'` → return output from node_completed / capture.
   - If no child: spawn annotate (`buildAnnotateArgv`), set phase opening/waiting.
   - Race: child exit vs poll store (external approve/reject/abandon).
   - On child exit: parse decision:
     - `approved` → call same resolution as standard approval (`approveWorkflow` or store CAS) if not already resolved; then **resume run to `running`** so outer DAG continues (critical — see notes); return `{ output }`.
     - `annotated` → rework agent → validate new path → update metadata.document → kill nothing else → spawn again.
     - `dismissed` (stock only) → phase idle; wait for review-open flag or external approve (poll).
   - Close with persist-session: child does not exit → keep waiting.
3. On external approve while child alive: kill child, return completed.

**Resume-after-approve note:**  
Standard `approveWorkflow` leaves status `paused`. Between-layer DAG stops if status ≠ `running`. After recording approval from supervisor, call the same resume CAS used by CLI (`resumeWorkflowRun`) **before** returning from the node so `runLayers` continues, **or** return and let a dedicated in-process auto-resume path run (mirror CLI approve). Document the chosen approach in code comments without plan IDs.

- [ ] **Step 1: Unit-test supervisor with fake spawn**

Cases: approve JSON; annotated then approve; external resolve kills child; invalid rework path stays paused / throws controlled error.

- [ ] **Step 2: Implement supervisor**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(workflows): add plannotator gate supervisor loop"
```

---

### Task 6: Wire executor + approve path + loader

**Files:**
- Modify: `packages/workflows/src/dag-executor.ts` (dispatch near `isApprovalNode` ~7419)
- Modify: `packages/core/src/operations/workflow-operations.ts` (`approveWorkflow` type branch)
- Modify: `packages/workflows/src/loader.ts` / `include-expander.ts` as needed for substitution of `document`/`message`/`rework.prompt`
- Modify: `packages/workflows/src/executor.ts` if `usesApproval` should include plannotator gates for interactive web

**Interfaces:**
- Consumes: `isPlannotatorGateNode`, `runPlannotatorGateSupervisor`
- `approveWorkflow`: treat `type === 'plannotator_gate'` like standard approval (write `node_completed` with optional capture response), **not** interactive_loop

- [ ] **Step 1: Integration-style test** in `dag-executor.test.ts` or a dedicated file with mocked store + mocked spawn: workflow with bash producing path → plannotator_gate → bash echo; mock annotate exits approved.

- [ ] **Step 2: Implement `executePlannotatorGateNode`**

```typescript
async function executePlannotatorGateNode(...): Promise<NodeOutput> {
  // 1. Resolve document: substituteNodeOutputRefs(node.plannotator_gate.document, nodeOutputs)
  //    then parseDocumentPathFromNodeOutput; validate fs.exists
  // 2. Preflight: resolvePlannotatorBinary / Bun.which
  // 3. runPlannotatorGateSupervisor({ runReworkAgent: ... use executeNodeInternal synthetic prompt or deps AI })
  // 4. return { state: 'completed', output }
}
```

Rework agent: simplest MVP — build prompt with `$REVIEW_DOCUMENT` / `$REVIEW_ANNOTATIONS` replaced, call existing AI sendQuery path (same provider resolution as a prompt node), parse path from final text output via `parseDocumentPathFromNodeOutput`.

- [ ] **Step 3: Dispatch**

```typescript
if (isPlannotatorGateNode(node)) {
  const output = await executePlannotatorGateNode(...);
  // same persistence pattern as other nodes
}
```

Also update any `isApprovalNode` checks that mean “human gate for interactive UI” to `isApprovalNode || isPlannotatorGateNode` where appropriate (web interactive, usesApproval).

- [ ] **Step 4: approveWorkflow** — ensure `plannotator_gate` is not mistaken for `child_workflow` / interactive_loop; standard gate branch writes `node_completed`.

- [ ] **Step 5: Run targeted tests**

```bash
bun test packages/workflows/src/plannotator-gate.test.ts
bun test packages/workflows/src/plannotator-gate-supervisor.test.ts
# plus the new executor tests file
bun test packages/core/src/operations/workflow-operations.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(workflows): execute plannotator_gate nodes with supervised annotate"
```

---

### Task 7: `review-open` CLI + API

**Files:**
- Modify: `packages/cli/src/cli.ts` (subcommand dispatch)
- Modify: `packages/cli/src/commands/workflow.ts` (handler)
- Modify: `packages/server/src/routes/api.ts` + `packages/server/src/routes/schemas/workflow.schemas.ts`
- Test: CLI unit test + API route test patterns existing for approve

**Interfaces:**

```text
archon workflow review-open <run-id>
POST /api/workflows/runs/{runId}/review-open
→ 200 { success: true, document: string } or 400 if not paused plannotator_gate
```

Behavior:

1. Load run; must be `paused`.
2. `metadata.approval.type === 'plannotator_gate'`.
3. Set phase to re-open / clear idle; **re-enter execution** the same way approve auto-resumes (call into workflow run continuation that re-hits the gate node without `node_completed`).

Practical MVP: if supervisor process is dead and phase idle, `review-open` triggers `resumeWorkflowRun` + execute path that re-enters the gate node (no node_completed yet). If child still alive, return current document + message “session already open”.

- [ ] **Step 1: Tests for 404/400 cases**

- [ ] **Step 2: Implement CLI + API**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(cli,server): add workflow review-open for plannotator gates"
```

---

### Task 8: Wire `archon-speckit-feature` workflow

**Files:**
- Modify: `.archon/workflows/defaults/archon-speckit-feature.yaml`
- Possibly mirror red-team-gate
- Run: `bun run generate:bundled` if defaults are bundled (per Agents.md)

**clarify-explain** prompt changes:

- After visual explainer, write HTML under `$ARTIFACTS_DIR`.
- Final assistant output: **only** absolute path to HTML (contract B).
- Do not rely on annotate session inside the explain node as the human gate.

**clarify-gate** replace `approval:` with:

```yaml
- id: clarify-gate
  depends_on: [clarify-explain]
  plannotator_gate:
    document: "$clarify-explain.output"
    message: |
      Review the clarification explainer in Plannotator (live URL).
      Use Ask AI / annotations. Only the run owner should Approve or Send Annotations.
      Teammates may Close without ending the session when --persist-session is active.
      Next: `$speckit-clarifybatch --apply`.
    capture_response: true
    rework:
      prompt: |
        Human annotations on the clarification explainer follow.

        HTML path: $REVIEW_DOCUMENT
        Annotations:
        $REVIEW_ANNOTATIONS

        Update clarification-questions.md as needed.
        Regenerate the explainer HTML under $ARTIFACTS_DIR.
        Print ONLY the absolute path to the HTML file for the next review.
```

Same pattern for `red-team-gate` if included in this change.

- [ ] **Step 1: Edit YAML**

- [ ] **Step 2: Validate**

```bash
bun run cli validate workflows archon-speckit-feature
# and generate:bundled if required
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(workflows): use plannotator_gate for speckit clarify review"
```

---

### Task 9: Docs + final validation

**Files:**
- Docs site workflow node reference (search existing approval node docs under `packages/docs-web`)
- Optional: short note in Archon skill / manage-run if gates are listed

- [ ] **Step 1: Document `plannotator_gate` fields, spawn flags, team live-URL vs Share snapshot**

- [ ] **Step 2: Run Archon package checks**

```bash
bun --filter @archon/workflows test
bun --filter @archon/core test   # if operations tests touched
bun run type-check
```

- [ ] **Step 3: Commit docs**

```bash
git commit -m "docs: document plannotator_gate node and team review flow"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `--persist-session` Close keep-alive | 1–2 |
| Default Plannotator unchanged | 1 |
| `plannotator_gate` node schema | 3 |
| Path contract B | 4, 6 |
| Supervisor loop + rework | 5–6 |
| Approve → approveWorkflow | 5–6 |
| Annotations → rework → re-spawn | 5–6 |
| Close+persist no dismiss | 1, 5 |
| External approve kills child | 5 |
| review-open | 7 |
| Speckit YAML | 8 |
| Team live vs Share | 2, 9 |
| Do not fatten `approval:` | 3 |

## Execution notes

- **Order:** Tasks 1–2 (Plannotator) can ship/merge first; Archon Tasks 3–9 depend on the CLI flag existing on PATH (or mock spawn in tests).
- **TDD:** Prefer failing tests before implementation on each task.
- **Risk:** Resume-after-approve interaction with `status === 'paused'` between layers — handle explicitly in Task 5–6.
- **Binary:** CI without `plannotator` should still pass unit tests via mocked spawn; integration smoke is manual/local.

---

## Self-review (plan author)

- No TBD placeholders in task steps.
- Types/names consistent: `plannotator_gate`, `persistSession` / `--persist-session`, `parseDocumentPathFromNodeOutput`.
- Spec multi-repo split reflected.
- `Send Annotations` keep-alive explicitly out of scope (decision A).
