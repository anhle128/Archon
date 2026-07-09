/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for inserting a
 * fail-closed `decision-needed-check` bash node at the quality route loop's PASS
 * seam (between `quality-route-loop` and `create-pull-request`): pass forward
 * cleanly when `decision_needed_count == 0`, block PR (non-zero exit) when
 * unresolved decision-needed items exist but cannot be tracked, and leave the
 * live Linear-create/reuse + cross-project sync path specified-but-unbuilt
 * because its inputs are cross-project and absent.
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive self-contained bash validation proofs — NO mock.module() needed, so this
 * file is safe to co-locate in the shared `bun test` batch. The GREEN-phase step
 * registers it alongside the other non-mock v2 contract tests in
 * packages/workflows/package.json (see TD-313, currently EXPECTED-RED because
 * registration has not happened yet).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-decision-needed-dag.test.ts (real bash + real executor, isolated invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * The YAML-structural assertions target the NOT-YET-IMPLEMENTED node and are
 * EXPECTED TO FAIL until the v2 YAML:
 *   1. adds a `decision-needed-check` bash node (JSON-only, no AI) with
 *      output_type: decision-needed-check, timeout: 60000, and depends_on
 *      [quality-route-loop, quality-gate-summary, resolve-story-input],
 *   2. reads the WHOLE summary output ($quality-gate-summary.output) and the
 *      resolved ref ($resolve-story-input.output.story_ref) via DNC_SUMMARY /
 *      DNC_RESOLVED + bun -e + JSON.parse (never grep/case/markdown),
 *   3. validates the summary envelope + story identity and fails closed BEFORE
 *      any contract reaches stdout,
 *   4. emits a full `status: "PASS"` no-op contract (never a `gate` field) when
 *      decision_needed_count == 0, and fails closed (non-zero exit) when it is
 *      > 0 and the tracking capability is unavailable,
 *   5. retargets quality-route-loop.routes.positive to decision-needed-check and
 *      create-pull-request.depends_on to [decision-needed-check], and
 *   6. leaves the v1 baseline byte-for-byte unchanged and source/bundle in sync.
 *
 * The self-contained validation proofs (technique proofs) run the EXACT
 * validate-and-emit pipeline the target node must adopt against crafted
 * summaries. They pass in the red phase (they prove the CHOSEN technique is
 * sound) and are each PAIRED with a static YAML assertion that the node adopts
 * that pipeline (which fails red until the node exists) — a green technique proof
 * is NOT node coverage on its own.
 *
 * Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-decision-needed-contract.test.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isRegisteredProvider, registerBuiltinProviders } from '@archon/providers';
import { parseWorkflow } from '../loader';
import type { WorkflowDefinition, DagNode } from '../schemas';
import { BUNDLED_WORKFLOWS } from './bundled-defaults';

const execFileAsync = promisify(execFile);

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.archon/workflows/defaults');

const V1_STEM = 'bmad-dev-story-with-tea-fix-loop';
const V2_STEM = 'bmad-dev-story-with-tea-fix-loop-v2';
const V1_FILE = join(WORKFLOWS_DIR, `${V1_STEM}.yml`);
const V2_FILE = join(WORKFLOWS_DIR, `${V2_STEM}.yml`);
const PACKAGE_JSON = join(REPO_ROOT, 'packages/workflows/package.json');

const NODE_ID = 'decision-needed-check';
const OUTPUT_TYPE = 'decision-needed-check';
const SUMMARY_ID = 'quality-gate-summary';
const READER_ID = 'verify-quality-summary';
const LOOP_ID = 'quality-route-loop';
const RESOLVE_ID = 'resolve-story-input';
const PR_ID = 'create-pull-request';
const ERROR_NODE_ID = 'review-loop-error';

// The node is the route loop's positive target (so it depends on quality-route-loop
// like create-pull-request did) AND reads two upstream contracts by substitution
// (so it depends on their producers to guarantee completion). Order-insensitive.
const EXPECTED_DEPS = [LOOP_ID, SUMMARY_ID, RESOLVE_ID];
const EXPECTED_TIMEOUT = 60000;

// Route wiring after the seam is retargeted.
const EXPECTED_POSITIVE = NODE_ID;
const EXPECTED_NEGATIVE = 'dev-story';
const EXPECTED_EXHAUSTED = ERROR_NODE_ID;
const EXPECTED_LOOP_FROM = READER_ID;
const EXPECTED_PR_DEPS = ['pr-handoff'];

// The full route-facing envelope the no-op success contract must carry. `status`
// (not `gate`) — this node is never a quality gate.
const REQUIRED_CONTRACT_FIELDS = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'status',
  'decision_needed_count',
  'deferred',
  'deferred_count',
  'created_count',
  'reused_count',
  'synced_count',
  'deferred_items',
];

const readLF = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf-8').replace(/\r\n/g, '\n') : null;

const parseFromDisk = (path: string, stem: string): WorkflowDefinition => {
  const content = readLF(path);
  expect(content, `expected workflow file to exist on disk: ${path}`).not.toBeNull();
  const result = parseWorkflow(content as string, `${stem}.yml`);
  expect(result.error, `parseWorkflow reported: ${result.error?.error ?? 'none'}`).toBeNull();
  return result.workflow as WorkflowDefinition;
};

const nodeById = (wf: WorkflowDefinition, id: string): DagNode | undefined =>
  wf.nodes.find(n => n.id === id);

const nodeBash = (wf: WorkflowDefinition, id: string): string =>
  (nodeById(wf, id) as { bash?: string } | undefined)?.bash ?? '';

const routeLoopBlock = (
  wf: WorkflowDefinition
): {
  from?: string;
  condition?: string;
  max_iterations?: number;
  routes?: Record<string, string>;
} =>
  (nodeById(wf, LOOP_ID) as { route_loop?: Record<string, unknown> } | undefined)?.route_loop ?? {};

// ── Technique proof: the exact validate-and-emit pipeline the node must adopt ──
// Mirrors the story-mandated node body. $1 = whole summary output, $2 = resolved
// story ref. Fails closed (non-zero, nothing on stdout) on any malformed / stale /
// wrong-identity / invalid-count summary and on decision_needed_count > 0 (today's
// capability-unavailable state); emits the full status:"PASS" contract only when
// decision_needed_count == 0. Reused by the executable proofs so they exercise the
// CHOSEN technique end-to-end in a real bash + bun subprocess.
const DNC_VALIDATION_SCRIPT = `
  set -e
  SUMMARY="$1"
  RESOLVED_REF="$2"

  if [ -z "$RESOLVED_REF" ]; then
    echo "ERROR: resolved story_ref is empty." >&2
    exit 1
  fi
  if [ -z "$SUMMARY" ]; then
    echo "ERROR: quality-gate-summary output is empty." >&2
    exit 1
  fi

  CONTRACT=$(
    DNC_SUMMARY="$SUMMARY" DNC_RESOLVED="$RESOLVED_REF" \\
    bun -e '
      const s = JSON.parse(process.env.DNC_SUMMARY || "");
      const resolved = process.env.DNC_RESOLVED;
      if (s.contract_version !== "1.0") { console.error("ERROR: contract_version"); process.exit(1); }
      if (s.workflow !== "${V2_STEM}") { console.error("ERROR: workflow"); process.exit(1); }
      if (s.node !== "${SUMMARY_ID}") { console.error("ERROR: node"); process.exit(1); }
      if (!s.story_ref || s.story_ref !== resolved) { console.error("ERROR: story_ref"); process.exit(1); }
      const count = s.decision_needed_count;
      // Require a genuine non-negative integer. A bare Number() coercion would
      // silently turn null/false/"" into 0 (a false no-op PASS); reject the type.
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) { console.error("ERROR: decision_needed_count"); process.exit(1); }
      if (count > 0) {
        console.error("ERROR: " + count + " unresolved decision-needed finding(s) require Linear follow-up + BMAD-METHOD sync, which is unavailable. Blocking PR (fail closed).");
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({
        contract_version: "1.0",
        workflow: "${V2_STEM}",
        node: "${NODE_ID}",
        story_ref: resolved,
        status: "PASS",
        decision_needed_count: count,
        deferred: false,
        deferred_count: 0,
        created_count: 0,
        reused_count: 0,
        synced_count: 0,
        deferred_items: []
      }));
    '
  )

  printf '%s' "$CONTRACT"
`;

// Neutral synthetic story reference — not a real plan, story, epic, or finding
// identifier. Uses x1- prefix to satisfy resolve-story-input's key pattern
// ([a-z][a-z0-9]*-[0-9]+-) without matching the naming-hygiene guard.
const CANONICAL_REF = 'x1-0-synthetic-decision-ref';

interface CheckResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runDecisionCheck = async (summaryJson: string, resolvedRef: string): Promise<CheckResult> => {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [
      '-c',
      DNC_VALIDATION_SCRIPT,
      '_',
      summaryJson,
      resolvedRef,
    ]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

const validSummary = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    contract_version: '1.0',
    workflow: V2_STEM,
    node: SUMMARY_ID,
    story_ref: CANONICAL_REF,
    gate: 'PASS',
    round: 1,
    blocking_count: 0,
    decision_needed_count: 0,
    ...overrides,
  });

beforeAll(() => {
  if (!isRegisteredProvider('codex')) {
    try {
      registerBuiltinProviders();
    } catch {
      // Another test in the batch already registered builtins — fine.
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-300 [P0] — buildable-now baseline precondition: the prior quality tail
// (summary aggregator + reader + single route loop + terminal error node) exists,
// and the live cross-project dependencies (per-finding decision-needed.json, a
// sync command/skill, any Linear integration) are ABSENT — so the node is
// constrained to buildable-now + fail-closed behavior. (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Baseline precondition — prior quality tail present, live deps absent (TD-300)', () => {
  it('the quality-gate-summary aggregator, reader, single route loop, and error node all exist', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, SUMMARY_ID), 'summary aggregator must exist').toBeDefined();
    expect(nodeById(v2, READER_ID), 'summary reader must exist').toBeDefined();
    expect(nodeById(v2, LOOP_ID), 'single quality route loop must exist').toBeDefined();
    expect(nodeById(v2, ERROR_NODE_ID), 'terminal error node must exist').toBeDefined();
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds, 'exactly one route_loop remains (the seam this story extends)').toEqual([
      LOOP_ID,
    ]);
  });

  it('no live tracking capability exists in source-controlled files — no Linear MCP config, client, or sync command', () => {
    // The node must be built fail-closed because these inputs do not exist in any
    // source-controlled file. If any of these appears, the buildable-now/fail-closed
    // boundary has been crossed and the plan (and this red scaffold) must be revisited.
    // NOTE: we scan source-controlled content (v2 YAML + bundled defaults) rather
    // than checking for local untracked files like .archon/mcp/linear.json, which
    // is gitignored and may legitimately exist in a developer checkout.
    const v2Raw = readLF(V2_FILE) ?? '';
    const bundledV2 = BUNDLED_WORKFLOWS[V2_STEM] ?? '';
    const combined = v2Raw + '\n' + bundledV2;
    const linearMarkers = [
      /mcp:.*linear/i,
      /api\.linear\.app/i,
      /LINEAR_API_KEY/,
      /graphql.*linear/i,
    ];
    for (const pattern of linearMarkers) {
      expect(
        pattern.test(combined),
        `source-controlled workflow files must not wire a live Linear integration (${pattern})`
      ).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-301 [P1] — decision-needed-check exists as a deterministic bash node with a
// bounded timeout, its typed output, and exactly the three required dependencies
// (route-loop positive target + the two upstream contracts it reads). (AC #1, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Node shape — deterministic bash node, bounded, typed, correct deps (TD-301)', () => {
  it('decision-needed-check exists and is a bash node (no AI, no command, no prompt)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID);
    expect(node, 'decision-needed-check node must exist').toBeDefined();
    expect('bash' in node!, 'the node must be a bash node (JSON-only routing decision)').toBe(true);
    expect('prompt' in node!, 'the node must NOT be a prompt (prose) node').toBe(false);
    expect('command' in node!, 'the node must NOT be a command node').toBe(false);
  });

  it('decision-needed-check declares output_type: decision-needed-check and timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as { output_type?: string; timeout?: number } | undefined;
    expect(node?.output_type, 'the node must declare its typed output sidecar').toBe(OUTPUT_TYPE);
    expect(node?.timeout, 'the node must declare the bounded timeout').toBe(EXPECTED_TIMEOUT);
  });

  it('decision-needed-check.depends_on is exactly [quality-route-loop, quality-gate-summary, resolve-story-input]', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = [...(nodeById(v2, NODE_ID)?.depends_on ?? [])].sort();
    expect(deps, 'the node joins the route loop + the two producers it reads').toEqual(
      [...EXPECTED_DEPS].sort()
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-302 [P0] — the PASS seam is retargeted: quality-route-loop.routes.positive
// becomes decision-needed-check, create-pull-request.depends_on becomes
// [decision-needed-check], negative/exhausted/from stay unchanged, and exactly one
// route_loop still exists. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Seam wiring — positive retargeted, PR depends on the new node (TD-302)', () => {
  it('quality-route-loop.routes.positive is decision-needed-check (was create-pull-request)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(routeLoopBlock(v2).routes?.positive, 'PASS must route into the decision node').toBe(
      EXPECTED_POSITIVE
    );
  });

  it('the route loop negative/exhausted/from are unchanged by this story', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const block = routeLoopBlock(v2);
    expect(block.routes?.negative, 'FAIL still routes back to the dev-story fix loop').toBe(
      EXPECTED_NEGATIVE
    );
    expect(block.routes?.exhausted, 'exhaustion still routes to the terminal error node').toBe(
      EXPECTED_EXHAUSTED
    );
    expect(block.from, 'the loop is still sourced from the summary reader').toBe(
      EXPECTED_LOOP_FROM
    );
  });

  it('create-pull-request.depends_on is exactly [pr-handoff] (pr-handoff inserted after decision-needed-check)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeById(v2, PR_ID)?.depends_on ?? [],
      'PR preparation must gate on the pr-handoff collector which sits after the decision node'
    ).toEqual(EXPECTED_PR_DEPS);
  });

  it('exactly one route_loop still exists and the loop internals are otherwise untouched', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds, 'no second route_loop may be introduced').toEqual([LOOP_ID]);
    expect(routeLoopBlock(v2).max_iterations, 'the loop budget is untouched').toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-303 [P0] — the node reads the WHOLE summary output + the resolved ref
// UNQUOTED, exports DNC_SUMMARY / DNC_RESOLVED into bun -e, parses with JSON.parse,
// and never uses field-level access, grep, case, or markdown/prose reads. (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader safety — whole-output JSON parse, no field-ref / grep / prose (TD-303)', () => {
  it('reads the WHOLE summary output ($quality-gate-summary.output) and the resolved ref', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'the node must read the whole summary output').toContain(
      '$quality-gate-summary.output'
    );
    expect(bash, 'the node must read the resolved canonical story ref').toContain(
      '$resolve-story-input.output.story_ref'
    );
  });

  it('NEVER uses field-level $quality-gate-summary.output.decision_needed_count (loader-forbidden path)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeBash(v2, NODE_ID),
      'field access on a schemaless bash node is rejected at load time — forbidden'
    ).not.toContain('$quality-gate-summary.output.decision_needed_count');
  });

  it('exports DNC_SUMMARY / DNC_RESOLVED and parses with bun -e + JSON.parse, never grep/case', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'the summary must be exported into the bun -e invocation').toContain(
      'DNC_SUMMARY'
    );
    expect(bash, 'the resolved ref must be exported into the bun -e invocation').toContain(
      'DNC_RESOLVED'
    );
    expect(bash, 'the node must parse with bun -e').toContain('bun -e');
    expect(bash, 'the node must parse with JSON.parse').toContain('JSON.parse');
    expect(
      /\bgrep\b[^\n]*decision_needed/.test(bash),
      'the node must not grep raw JSON for the count'
    ).toBe(false);
    expect(
      /\bcase\b[^\n]*\$(quality-gate-summary)/.test(bash),
      'the node must not case-match the raw summary'
    ).toBe(false);
  });

  it('never reads decision-log.md, open-findings.md, or any markdown/prose as a route/sync API', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const prose of ['decision-log.md', 'open-findings.md']) {
      expect(bash, `the node must not parse prose (${prose})`).not.toContain(prose);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-304 [P1] — the success contract carries the full route envelope with
// status:"PASS" and echoed count + zeroed count fields + empty deferred_items,
// and NEVER emits a `gate` field. Static half; the emitted-value half is the
// technique proof below. (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Success contract shape — full envelope, status not gate (TD-304, static)', () => {
  it('the node body emits every required contract field', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const field of REQUIRED_CONTRACT_FIELDS) {
      expect(bash, `the success contract must include ${field}`).toContain(field);
    }
  });

  it('the node body emits status: "PASS" and NEVER a gate field', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(/status:\s*['"]PASS['"]/.test(bash), 'success uses status: "PASS"').toBe(true);
    expect(
      /\bgate\b\s*:\s*['"]/.test(bash),
      'this node is not a quality gate — it must not emit a gate field'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-310 [P1] — the fail-closed decision adds NO new routing: no second
// route_loop, no when: bypass, no new error node, and no reroute to dev-story.
// Blocking is purely structural (node fails → dependent PR never runs). Static
// half; the runtime halting half lives in the DAG sibling. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('No new routing — structural blocking only, no dev-story reroute (TD-310, static)', () => {
  it('decision-needed-check carries no route_loop and no when: bypass', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as object | undefined;
    expect(node, 'the node must exist to assert its shape').toBeDefined();
    expect('route_loop' in (node as object), 'the node must not be a second route_loop').toBe(
      false
    );
    expect('when' in (node as object), 'the node must not carry a when: bypass').toBe(false);
  });

  it('the node body never reroutes to dev-story and adds no new error node', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    // The workflow name "bmad-dev-story-with-tea-fix-loop-v2" contains "dev-story",
    // so check for actual routing references (e.g., "negative: dev-story" or
    // "routes: ... dev-story") rather than the string appearing anywhere.
    expect(
      /(?:negative|routes|positive|exhausted):\s*dev-story/.test(bash),
      'the node must not route the decision back into the dev-story fix loop'
    ).toBe(false);
    // Only the pre-existing terminal error node may exist; no decision-specific one.
    expect(
      nodeById(v2, 'decision-needed-error'),
      'no bespoke decision error node may be added — blocking is structural'
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-314 [P0] — no speculative live integration: the node (and the v2 file) must
// introduce no Linear client, fetch/GraphQL call, MCP config, or invented
// LINEAR_API_KEY gate. YAGNI + no-silent-network-broadening guard. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('No speculative live integration — no network/credential broadening (TD-314)', () => {
  it('the decision-needed-check body invokes no live Linear/network/GraphQL/credential path', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    // The fail-closed diagnostic intentionally mentions "Linear" to name the
    // unavailable capability — that is not a live integration. Check for actual
    // API calls, credential references, and network operations.
    for (const forbidden of [
      'LINEAR_API_KEY',
      'graphql',
      'fetch(',
      'curl ',
      'wget ',
      'api.linear.app',
    ]) {
      expect(
        bash.toLowerCase().includes(forbidden.toLowerCase()),
        `the fail-closed node must not reference a live path (${forbidden})`
      ).toBe(false);
    }
  });

  it('the decision-needed-check node declares no mcp: config (no AI-driven live path)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as object | undefined;
    expect('mcp' in (node ?? {}), 'the node must not wire an mcp: live path').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-319 [P1] — bounded timeout + local-only work: the node declares a bounded
// timeout and runs only local shell + bun -e JSON work (no unbounded external
// command). (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Timeout guard — bounded, local-only work (TD-319)', () => {
  it('the node declares a positive bounded timeout', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const t = (nodeById(v2, NODE_ID) as { timeout?: number } | undefined)?.timeout;
    expect(typeof t, 'the node must declare a numeric timeout').toBe('number');
    expect(t as number, 'the timeout must be positive').toBeGreaterThan(0);
  });

  it('the node invokes no unbounded network/watch command', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const forbidden of ['curl ', 'wget ', 'nc ', 'tail -f', 'sleep ']) {
      expect(bash, `the node must not invoke an unbounded '${forbidden.trim()}'`).not.toContain(
        forbidden
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-312 [P1] — edited v2 source + BUNDLED_WORKFLOWS match and embed the new node;
// v1 baseline is byte-for-byte unchanged (rollback safety). Pair with
// `bun run check:bundled`. (AC #7)
// ═══════════════════════════════════════════════════════════════════════════

describe('Bundle parity — v2 source/bundle in sync, v1 untouched (TD-312)', () => {
  it('bundled v2 content matches the on-disk source and embeds decision-needed-check', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, 'bundled v2 workflow must be present').toBeDefined();
    expect(content, 'the regenerated bundle must embed the new node').toContain(NODE_ID);
    expect(content?.replace(/\r\n/g, '\n')).toBe(readLF(V2_FILE));
  });

  it('the v1 baseline gains no decision-needed-check node (proves it was not edited)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, NODE_ID), 'v1 must not gain decision-needed-check').toBeUndefined();
    const v1Raw = readLF(V1_FILE) ?? '';
    expect(/decision-needed/.test(v1Raw), 'v1 must not reference decision-needed at all').toBe(
      false
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-313 [P1] — CI registration: the contract test belongs in a shared (non-mock)
// batch segment; the DAG test runs as its OWN bun invocation (mock.module
// isolation). EXPECTED-RED: registration is a GREEN-phase step, so both
// assertions fail until packages/workflows/package.json is updated. (AC #7)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test registration — mock isolation preserved (TD-313, expected-red until wired)', () => {
  it('the decision-needed contract test is registered in a shared (non-mock) batch segment', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the contract test must be registered').toContain(
      'v2-decision-needed-contract.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-decision-needed-contract.test.ts'));
    expect(owning.length, 'exactly one segment must own the contract test').toBe(1);
    expect(
      owning[0]?.includes('v2-decision-needed-dag.test.ts'),
      'the contract test must NOT share a segment with the mock.module DAG test'
    ).toBe(false);
  });

  it('the decision-needed DAG test is registered as its OWN standalone bun invocation', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the DAG fixture must be registered').toContain(
      'v2-decision-needed-dag.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-decision-needed-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the DAG fixture').toBe(1);
    expect(owning[0], 'the DAG fixture must run alone (mock.module is process-global)').toBe(
      'bun test src/defaults/v2-decision-needed-dag.test.ts'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-321 [P3] — kebab-case ids/output types; the generated decision-needed test
// files carry no plan/story/epic/finding identifiers (only TD-nnn / AC# allowed).
// (AC #7)
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — kebab-case ids, no plan references (TD-321)', () => {
  it('the new node id and output type are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const label of [NODE_ID, OUTPUT_TYPE]) {
      expect(kebab.test(label), `${label} must be kebab-case`).toBe(true);
    }
  });

  it('the generated decision-needed test files contain no plan/story/epic/finding identifiers', () => {
    const files = ['v2-decision-needed-dag.test.ts', 'v2-decision-needed-contract.test.ts'];
    // Forbidden: epic/story codes, architecture decision/req codes, risk/waiver/
    // concern codes, and predecessor finding codes. Allowed: TD-nnn / AC#.
    const planRef =
      /\b(A[0-9]\.[0-9]|A-FR-[0-9]|A-AD-[0-9]|R-0[0-9][0-9]|W-00[0-9]|C-0[0-9][0-9]|R[0-9]-F[0-9]|a[0-9][-.][0-9])\b/;
    for (const f of files) {
      const body = readLF(join(import.meta.dir, f));
      expect(body, `${f} must exist`).not.toBeNull();
      const offending = (body as string).split('\n').filter(line => planRef.test(line));
      expect(offending, `${f} must not embed plan identifiers: ${offending[0] ?? ''}`).toHaveLength(
        0
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-304 / TD-324 [P1] — technique proof: a clean count==0 summary emits the FULL
// no-op contract — status:"PASS", no gate, echoed count 0, zeroed created/reused/
// synced/deferred counts, empty deferred_items, and story_ref exactly equal to the
// resolved key. Paired with the TD-304 static assertion above. (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Success emission — count==0 yields the full status:"PASS" contract (TD-304/TD-324 technique)', () => {
  it('a clean count==0 summary exits 0 and emits the complete envelope', async () => {
    const r = await runDecisionCheck(validSummary({ decision_needed_count: 0 }), CANONICAL_REF);
    expect(r.code, 'a clean no-op summary must exit 0').toBe(0);
    const contract = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(contract.contract_version).toBe('1.0');
    expect(contract.workflow).toBe(V2_STEM);
    expect(contract.node).toBe(NODE_ID);
    expect(contract.status, 'the node reports status, never a gate').toBe('PASS');
    expect('gate' in contract, 'the no-op contract must not carry a gate field').toBe(false);
    expect(contract.decision_needed_count, 'the count is echoed from the summary').toBe(0);
    expect(contract.deferred).toBe(false);
    expect(contract.deferred_count).toBe(0);
    expect(contract.created_count).toBe(0);
    expect(contract.reused_count).toBe(0);
    expect(contract.synced_count).toBe(0);
    expect(contract.deferred_items, 'no deferred items today').toEqual([]);
  });

  it('the emitted story_ref exactly equals the resolved canonical key (same-story identity)', async () => {
    const r = await runDecisionCheck(validSummary({ decision_needed_count: 0 }), CANONICAL_REF);
    const contract = JSON.parse(r.stdout) as { story_ref?: string };
    expect(contract.story_ref, 'success must carry the resolved story_ref unchanged').toBe(
      CANONICAL_REF
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-306 [P0] — technique proof: a summary with a mismatched or empty envelope
// field (contract_version / workflow / node / story_ref) fails closed with NO
// contract on stdout, BEFORE any emission. The mid-DAG injection half is a skipped
// scaffold in the DAG sibling (no fault-injection seam). (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Envelope fail-closed — mismatched identity yields no contract (TD-306 technique)', () => {
  const expectFailClosed = (r: CheckResult, why: string): void => {
    expect(r.code, `${why}: must exit non-zero`).not.toBe(0);
    expect(r.stdout, `${why}: must emit no contract on stdout`).toBe('');
  };

  it('wrong contract_version fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck(validSummary({ contract_version: '0.9' }), CANONICAL_REF),
      'wrong contract_version'
    );
  });

  it('wrong workflow identity fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck(validSummary({ workflow: 'some-other-workflow' }), CANONICAL_REF),
      'wrong workflow'
    );
  });

  it('wrong producer node identity fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck(validSummary({ node: READER_ID }), CANONICAL_REF),
      'wrong producer node'
    );
  });

  it('a stale (mismatched) story_ref fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck(validSummary({ story_ref: 'stale-story-ref' }), CANONICAL_REF),
      'stale story_ref'
    );
  });

  it('an empty story_ref fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck(validSummary({ story_ref: '' }), CANONICAL_REF),
      'empty story_ref'
    );
  });

  it('an empty resolved ref fails closed before any parsing', async () => {
    expectFailClosed(await runDecisionCheck(validSummary(), ''), 'empty resolved ref');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-307 [P0] — technique proof: empty summary output and malformed (non-JSON)
// summary fail closed with no contract on stdout. The mid-DAG injection half is a
// skipped scaffold in the DAG sibling (no fault-injection seam). (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Malformed fail-closed — empty / non-JSON summary yields no contract (TD-307 technique)', () => {
  const expectFailClosed = (r: CheckResult, why: string): void => {
    expect(r.code, `${why}: must exit non-zero`).not.toBe(0);
    expect(r.stdout, `${why}: must emit no contract on stdout`).toBe('');
  };

  it('empty summary output fails closed', async () => {
    expectFailClosed(await runDecisionCheck('', CANONICAL_REF), 'empty summary');
  });

  it('malformed (non-JSON) summary fails closed', async () => {
    expectFailClosed(await runDecisionCheck('not-json{oops', CANONICAL_REF), 'malformed JSON');
  });

  it('a truncated JSON summary fails closed', async () => {
    expectFailClosed(
      await runDecisionCheck('{"contract_version":"1.0",', CANONICAL_REF),
      'truncated JSON'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-308 [P0] — technique proof: decision_needed_count boundaries. `0` emits the
// no-op contract; missing, negative, fractional, and non-numeric values fail
// closed as malformed; any positive integer (boundary 1, role-gate max 4, and
// oversized) fails closed as capability-unavailable. The integer {0, >=1} half is
// ALSO proven end-to-end in the DAG sibling; the malformed subset is technique-only
// (the real summary only ever emits an integer concernsCount >= 0). (AC #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Count boundary — 0 passes, malformed + positive fail closed (TD-308 technique)', () => {
  it('the real YAML node body uses the non-coercing typeof guard and never Number() coercion', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(
      bash,
      'the real node body must assign without coercion (const count = s.decision_needed_count)'
    ).toContain('const count = s.decision_needed_count');
    expect(bash, 'the real node body must reject non-number types with typeof guard').toContain(
      'typeof count !== "number"'
    );
    expect(
      bash,
      'the real node body must NOT use Number(s.decision_needed_count) — that coerces null/false to 0'
    ).not.toContain('Number(s.decision_needed_count)');
  });

  it('decision_needed_count == 0 passes and emits the contract', async () => {
    const r = await runDecisionCheck(validSummary({ decision_needed_count: 0 }), CANONICAL_REF);
    expect(r.code, 'zero decision-needed items is the no-op success path').toBe(0);
    expect((JSON.parse(r.stdout) as { status?: string }).status).toBe('PASS');
  });

  it('a missing decision_needed_count fails closed as malformed (no contract)', async () => {
    const summary = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: SUMMARY_ID,
      story_ref: CANONICAL_REF,
      gate: 'PASS',
    });
    const r = await runDecisionCheck(summary, CANONICAL_REF);
    expect(r.code, 'a missing count is malformed').not.toBe(0);
    expect(r.stdout, 'no contract on a malformed count').toBe('');
  });

  it('negative, fractional, and non-numeric counts fail closed as malformed (no contract)', async () => {
    for (const bad of [-1, 1.5, 'two', null, true]) {
      const r = await runDecisionCheck(
        validSummary({ decision_needed_count: bad as unknown }),
        CANONICAL_REF
      );
      expect(r.code, `count ${JSON.stringify(bad)} must fail closed`).not.toBe(0);
      expect(r.stdout, `count ${JSON.stringify(bad)} must emit no contract`).toBe('');
    }
  });

  it('every positive integer count (boundary 1, role-gate max 4, oversized) fails closed', async () => {
    for (const n of [1, 4, 99]) {
      const r = await runDecisionCheck(validSummary({ decision_needed_count: n }), CANONICAL_REF);
      expect(r.code, `count ${n} must fail closed while capability is unavailable`).not.toBe(0);
      expect(r.stdout, `count ${n} must emit no contract`).toBe('');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-309 [P0] — technique proof: decision_needed_count > 0 with no live capability
// fails closed with a CLEAR diagnostic naming the unavailable capability. (The
// DAG sibling proves node-failed + no-PR; the diagnostic text is only observable
// here because the DAG harness discards node stderr.) (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fail-closed diagnostic — count>0 names the unavailable capability (TD-309 technique)', () => {
  it('a positive count fails closed with a diagnostic naming Linear/sync/fail-closed', async () => {
    const r = await runDecisionCheck(validSummary({ decision_needed_count: 2 }), CANONICAL_REF);
    expect(r.code, 'unresolved decision-needed items must block (non-zero exit)').not.toBe(0);
    expect(r.stdout, 'no contract may be emitted on the fail-closed path').toBe('');
    expect(
      /linear|sync|fail closed|unavailable/i.test(r.stderr),
      `the diagnostic must name the unavailable capability, got: ${r.stderr}`
    ).toBe(true);
    expect(r.stderr, 'the diagnostic should include the offending count').toContain('2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-311 [P0] — technique proof: EVERY validation and fail-closed error path emits
// NO partial contract to stdout — validation completes (or the count>0 guard
// fires) BEFORE any bytes are written. Because the emit is inside CONTRACT=$(...)
// under `set -e`, a non-zero bun -e aborts the assignment before printf runs.
// (AC #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('No partial contract — error paths write nothing to stdout (TD-311 technique)', () => {
  const cases: Array<[string, string]> = [
    ['malformed JSON', 'not-json'],
    ['wrong workflow', validSummary({ workflow: 'x' })],
    ['stale story_ref', validSummary({ story_ref: 'stale' })],
    ['fractional count', validSummary({ decision_needed_count: 2.5 })],
    ['positive count (fail closed)', validSummary({ decision_needed_count: 3 })],
  ];

  for (const [label, summary] of cases) {
    it(`emits no partial JSON on stdout: ${label}`, async () => {
      const r = await runDecisionCheck(summary, CANONICAL_REF);
      expect(r.code, `${label}: must exit non-zero`).not.toBe(0);
      expect(r.stdout, `${label}: stdout must be empty (no partial contract)`).toBe('');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-315 [P1] — DEFERRED (blocked): the live AC5 create/reuse + sync target shape
// is documented but NOT implemented. Skipped scaffold so the future requirement is
// not lost. See the deferred-live-path waiver in the ATDD checklist. (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Deferred live create/reuse + sync shape (TD-315 — waived, see ATDD checklist)', () => {
  // WHY SKIPPED: the live path requires a per-finding decision-needed source
  // contract, a cross-project BMAD-METHOD sync request/response contract, and a
  // Linear integration — NONE of which exist in this repository. Building them
  // here would fabricate cross-project contracts (forbidden). ACTIVATE only when
  // the per-finding contract, the sync contract, and an explicit default-off
  // capability marker all exist inside the allowed project boundary; then assert:
  // one issue created-or-reused per unresolved finding, each carrying finding id,
  // title/source gate, issue id, issue URL, and story_ref; a successful sync;
  // and an emitted contract with deferred:true and created/reused/synced counts.
  it.skip('creates or reuses one issue per finding and emits deferred:true after sync success', () => {
    expect(true).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-316 [P1] — DEFERRED (blocked): the real sync-returning-ERROR path is NOT
// covered by today's unavailable-capability fail-closed path. Skipped scaffold so
// this is not counted as covered by implication. See the deferred-sync waiver. (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Deferred real sync ERROR path (TD-316 — waived, see ATDD checklist)', () => {
  // WHY SKIPPED: today's node never performs a real sync call — it fails closed
  // because the capability is unavailable (proven by TD-309). A future node that
  // performs the real call could mishandle a sync ERROR response; that path cannot
  // be exercised until the sync request/response contract exists. ACTIVATE when the
  // sync contract lands; then assert: a real sync call returning ERROR makes the
  // node exit non-zero (ERROR, not a routable FAIL) and PR preparation does not run.
  it.skip('a real sync call that returns ERROR fails the node closed and blocks PR', () => {
    expect(true).toBe(false);
  });
});
