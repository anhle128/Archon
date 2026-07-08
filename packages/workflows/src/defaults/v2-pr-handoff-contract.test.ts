/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for inserting a
 * deterministic `pr-handoff` collector bash node between `decision-needed-check`
 * and `create-pull-request`. The collector reads all upstream gate contracts via
 * whole-output substitution, validates story identity, and emits
 * `pr-handoff.json` (machine-readable) and `pr-handoff.md` (human-readable).
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive self-contained bash rendering proofs — NO mock.module() needed, so this
 * file is safe to co-locate in the shared `bun test` batch. The GREEN-phase step
 * registers it alongside the other non-mock v2 contract tests in
 * packages/workflows/package.json (see TD-423, currently EXPECTED-RED because
 * registration has not happened yet).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-pr-handoff-dag.test.ts (real bash + real executor, isolated invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * The YAML-structural assertions target the NOT-YET-IMPLEMENTED node and are
 * EXPECTED TO FAIL until:
 *   1. the predecessor's `decision-needed-check` is restored in the v2 YAML,
 *   2. a `pr-handoff` bash node is added with output_type: pr-handoff,
 *      timeout: 60000, trigger_rule: none_failed_min_one_success, and
 *      depends_on including all evidence producers,
 *   3. `create-pull-request.depends_on` is retargeted to [pr-handoff],
 *   4. `create-pull-request` gains a prompt_suffix for evidence inclusion,
 *   5. the node reads all contracts via whole-output substitution + bun -e +
 *      JSON.parse with story_ref validation, and
 *   6. v1 baseline stays byte-for-byte unchanged and source/bundle in sync.
 *
 * The self-contained technique proofs validate the CHOSEN rendering pipeline
 * against synthetic contracts. They pass in the red phase and are each PAIRED
 * with a static YAML assertion that the node adopts that pipeline (which fails
 * red until the node exists) — a green technique proof is NOT node coverage.
 *
 * Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-pr-handoff-contract.test.ts
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
const ARCHON_CREATE_PR = join(REPO_ROOT, '.archon/commands/defaults/archon-create-pr.md');

const NODE_ID = 'pr-handoff';
const OUTPUT_TYPE = 'pr-handoff';
const DNC_ID = 'decision-needed-check';
const SUMMARY_ID = 'quality-gate-summary';
const READER_ID = 'verify-quality-summary';
const LOOP_ID = 'quality-route-loop';
const RESOLVE_ID = 'resolve-story-input';
const PR_ID = 'create-pull-request';
const ERROR_NODE_ID = 'review-loop-error';
const CR_ID = 'code-review-auto';
const GP_ID = 'gate-planner';

const EXPECTED_DEPS = [
  DNC_ID,
  SUMMARY_ID,
  CR_ID,
  'tea-rv',
  'tea-rv-skipped',
  'tea-nr',
  'tea-nr-skipped',
  'tea-tr',
  'tea-tr-skipped',
  GP_ID,
  RESOLVE_ID,
];
const EXPECTED_TIMEOUT = 60000;
const EXPECTED_PR_DEPS = [NODE_ID];

const REQUIRED_CONTRACT_FIELDS = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'status',
  'quality_summary',
  'gates',
  'gate_plan',
  'decision_needed',
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

// Neutral synthetic story reference — not a real plan, story, epic, or finding
// identifier. Uses x1- prefix to satisfy resolve-story-input's key pattern
// without matching the naming-hygiene guard.
const CANONICAL_REF = 'x1-0-synthetic-handoff-ref';

beforeAll(() => {
  if (!isRegisteredProvider('codex')) {
    try {
      registerBuiltinProviders();
    } catch {
      // Another test in the batch already registered builtins — fine.
    }
  }
});

// ── Technique proof: the rendering pipeline for pr-handoff.md ───────────
// Mirrors the story-mandated Markdown renderer for both the no-deferred and
// populated-deferred paths. Fed synthetic JSON; validates rendering output.

interface HandoffContract {
  contract_version: string;
  workflow: string;
  node: string;
  story_ref: string;
  status: string;
  quality_summary: {
    gate: string;
    round: number;
    blocking_count: number;
    decision_needed_count: number;
    findings_total: number;
    artifact_file: string;
  };
  gates: Record<
    string,
    {
      gate: string;
      source: string;
      findings_count: number;
      artifact_file: string;
      report_file: string | null;
    }
  >;
  gate_plan: {
    run_rv: boolean;
    run_nr: boolean;
    run_tr: boolean;
    artifact_file: string;
  };
  decision_needed: {
    deferred: boolean;
    deferred_count: number;
    deferred_items: Array<{
      finding_id: string;
      title: string;
      source_gate: string;
      linear_issue_id: string;
      linear_url: string;
      status: string;
    }>;
    artifact_file: string;
  };
}

const HANDOFF_RENDER_SCRIPT = `
  set -e
  PH_JSON="$1" bun -e '
    const h = JSON.parse(process.env.PH_JSON);
    const lines = [];
    lines.push("## Quality Evidence Summary");
    lines.push("");
    lines.push("**Story:** " + h.story_ref);
    lines.push("**Overall:** " + h.quality_summary.gate + " (round " + h.quality_summary.round + ")");
    lines.push("**Blocking findings:** " + h.quality_summary.blocking_count);
    lines.push("**Total findings:** " + h.quality_summary.findings_total);
    lines.push("**Quality summary artifact:** [" + h.quality_summary.artifact_file + "](" + h.quality_summary.artifact_file + ")");
    lines.push("**Decision-needed artifact:** [" + h.decision_needed.artifact_file + "](" + h.decision_needed.artifact_file + ")");
    lines.push("");
    lines.push("### Gate Results");
    lines.push("");
    lines.push("| Gate | Outcome | Source | Findings | Artifact | Report |");
    lines.push("|------|---------|--------|----------|----------|--------|");
    for (const [key, g] of Object.entries(h.gates)) {
      const artifact = "[" + g.artifact_file + "](" + g.artifact_file + ")";
      const report = g.report_file ? "[" + g.report_file + "](" + g.report_file + ")" : "";
      lines.push("| " + key.toUpperCase() + " | " + g.gate + " | " + g.source + " | " + g.findings_count + " | " + artifact + " | " + report + " |");
    }
    lines.push("");
    lines.push("### Gate Plan");
    lines.push("");
    lines.push("Artifact: [" + h.gate_plan.artifact_file + "](" + h.gate_plan.artifact_file + ")");
    lines.push("");
    lines.push("- RV (test review): " + (h.gate_plan.run_rv ? "executed" : "skipped"));
    lines.push("- NR (NFR review): " + (h.gate_plan.run_nr ? "executed" : "skipped"));
    lines.push("- TR (traceability): " + (h.gate_plan.run_tr ? "executed" : "skipped"));
    lines.push("");
    lines.push("### Decision-Needed Items");
    lines.push("");
    if (!h.decision_needed.deferred || h.decision_needed.deferred_items.length === 0) {
      lines.push("No decision-needed items were deferred.");
    } else {
      lines.push("The following items require human judgment and were deferred to Linear.");
      lines.push("They were NOT fixed in this PR.");
      lines.push("");
      lines.push("| Finding | Title | Source | Linear Issue | Status |");
      lines.push("|---------|-------|--------|--------------|--------|");
      const esc = (s) => String(s).replace(/\\|/g, "\\\\|");
      for (const item of h.decision_needed.deferred_items) {
        lines.push("| " + esc(item.finding_id) + " | " + esc(item.title) + " | " + esc(item.source_gate) + " | [" + esc(item.linear_issue_id) + "](" + esc(item.linear_url) + ") | " + esc(item.status) + " |");
      }
    }
    process.stdout.write(lines.join("\\n") + "\\n");
  '
`;

interface RenderResult {
  code: number;
  stdout: string;
  stderr: string;
}

const renderHandoff = async (handoffJson: string): Promise<RenderResult> => {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [
      '-c',
      HANDOFF_RENDER_SCRIPT,
      '_',
      handoffJson,
    ]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

const ARTIFACTS_DIR = '/test/artifacts';

function syntheticHandoff(overrides: Partial<HandoffContract> = {}): HandoffContract {
  return {
    contract_version: '1.0',
    workflow: V2_STEM,
    node: NODE_ID,
    story_ref: CANONICAL_REF,
    status: 'PASS',
    quality_summary: {
      gate: 'PASS',
      round: 1,
      blocking_count: 0,
      decision_needed_count: 0,
      findings_total: 0,
      artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/quality-gate-summary.json`,
    },
    gates: {
      cr: {
        gate: 'PASS',
        source: CR_ID,
        findings_count: 0,
        artifact_file: `${ARTIFACTS_DIR}/nodes/code-review-auto.md`,
        report_file: 'code-review-report.md',
      },
      rv: {
        gate: 'PASS',
        source: 'tea-rv',
        findings_count: 0,
        artifact_file: `${ARTIFACTS_DIR}/nodes/test-review-findings.md`,
        report_file: 'tea-rv-report.md',
      },
      nr: {
        gate: 'PASS',
        source: 'tea-nr',
        findings_count: 0,
        artifact_file: `${ARTIFACTS_DIR}/nodes/nfr-findings.md`,
        report_file: 'tea-nr-report.md',
      },
      tr: {
        gate: 'PASS',
        source: 'tea-tr',
        findings_count: 0,
        artifact_file: `${ARTIFACTS_DIR}/nodes/trace-findings.md`,
        report_file: 'tea-tr-report.md',
      },
    },
    gate_plan: {
      run_rv: true,
      run_nr: true,
      run_tr: true,
      artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/gate-planner.json`,
    },
    decision_needed: {
      deferred: false,
      deferred_count: 0,
      deferred_items: [],
      artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/decision-needed.json`,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TD-400 [P0] — precondition: predecessor decision-needed-check restored and
// prior route-loop tail intact. Hard gate — do not consider coverage valid if
// this fails. (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Baseline precondition — predecessor restored, prior tail intact (TD-400)', () => {
  it('decision-needed-check exists as a bash node with correct deps and output_type', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, DNC_ID);
    expect(node, 'decision-needed-check must exist (restore predecessor)').toBeDefined();
    expect('bash' in node!, 'decision-needed-check must be a bash node').toBe(true);
    expect(
      (node as { output_type?: string }).output_type,
      'decision-needed-check must declare output_type: decision-needed-check'
    ).toBe('decision-needed-check');
    const deps = [...(node?.depends_on ?? [])].sort();
    expect(
      deps,
      'decision-needed-check deps must include route loop, summary, and resolve'
    ).toEqual([LOOP_ID, RESOLVE_ID, SUMMARY_ID].sort());
  });

  it('quality-route-loop.routes.positive is decision-needed-check (predecessor wiring)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(routeLoopBlock(v2).routes?.positive).toBe(DNC_ID);
  });

  it('prior tail intact: summary, reader, single route loop, error node', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, SUMMARY_ID), 'summary aggregator must exist').toBeDefined();
    expect(nodeById(v2, READER_ID), 'summary reader must exist').toBeDefined();
    expect(nodeById(v2, LOOP_ID), 'route loop must exist').toBeDefined();
    expect(nodeById(v2, ERROR_NODE_ID), 'error node must exist').toBeDefined();
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds, 'exactly one route_loop').toEqual([LOOP_ID]);
    const block = routeLoopBlock(v2);
    expect(block.from).toBe(READER_ID);
    expect(block.routes?.negative).toBe('dev-story');
    expect(block.routes?.exhausted).toBe(ERROR_NODE_ID);
    expect(block.max_iterations).toBe(20);
  });

  it('create-pull-request preserves shape: command, provider, model, context', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const pr = nodeById(v2, PR_ID) as Record<string, unknown> | undefined;
    expect(pr, 'create-pull-request must exist').toBeDefined();
    expect(pr!.command).toBe('archon-create-pr');
    expect(pr!.provider).toBe('claude');
    expect(pr!.model).toBe('sonnet');
    expect(pr!.context).toBe('fresh');
  });

  it('live Linear/BMAD-METHOD dependencies are absent', () => {
    const v2Raw = readLF(V2_FILE) ?? '';
    const linearMarkers = [/LINEAR_API_KEY/, /api\.linear\.app/i, /graphql.*linear/i];
    for (const pattern of linearMarkers) {
      expect(pattern.test(v2Raw), `workflow must not wire live Linear (${pattern})`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-401 [P1] — pr-handoff exists as a deterministic bash node with bounded
// timeout, typed output, correct dependencies, and trigger rule. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Node shape — deterministic bash, bounded, typed, correct deps (TD-401)', () => {
  it('pr-handoff exists and is a bash node (no AI, no command, no prompt)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID);
    expect(node, 'pr-handoff node must exist').toBeDefined();
    expect('bash' in node!, 'pr-handoff must be a bash node').toBe(true);
    expect('prompt' in node!, 'pr-handoff must NOT be a prompt node').toBe(false);
    expect('command' in node!, 'pr-handoff must NOT be a command node').toBe(false);
  });

  it('pr-handoff declares output_type: pr-handoff and timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as { output_type?: string; timeout?: number } | undefined;
    expect(node?.output_type).toBe(OUTPUT_TYPE);
    expect(node?.timeout).toBe(EXPECTED_TIMEOUT);
  });

  it('pr-handoff.depends_on includes all evidence producers', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = [...(nodeById(v2, NODE_ID)?.depends_on ?? [])].sort();
    expect(deps, 'must depend on all evidence producers').toEqual([...EXPECTED_DEPS].sort());
  });

  it('pr-handoff.trigger_rule is none_failed_min_one_success', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as { trigger_rule?: string } | undefined;
    expect(node?.trigger_rule).toBe('none_failed_min_one_success');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-402 [P0] — required chain: decision-needed-check -> pr-handoff ->
// create-pull-request. PR cannot bypass handoff. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Chain wiring — decision -> handoff -> PR (TD-402)', () => {
  it('pr-handoff depends on decision-needed-check', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, NODE_ID)?.depends_on ?? [];
    expect(deps, 'pr-handoff must depend on decision-needed-check').toContain(DNC_ID);
  });

  it('create-pull-request.depends_on is exactly [pr-handoff]', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, PR_ID)?.depends_on ?? []).toEqual(EXPECTED_PR_DEPS);
  });

  it('exactly one route_loop exists and its routes are unchanged by this story', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds).toEqual([LOOP_ID]);
    const block = routeLoopBlock(v2);
    expect(block.routes?.positive).toBe(DNC_ID);
    expect(block.routes?.negative).toBe('dev-story');
    expect(block.routes?.exhausted).toBe(ERROR_NODE_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-403 [P1] — bundle parity: v2 source/bundle in sync; v1 baseline
// byte-for-byte unchanged; shared archon-create-pr.md untouched. (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Bundle parity — v2 source/bundle sync, v1 untouched, shared cmd safe (TD-403)', () => {
  it('bundled v2 content matches on-disk source and embeds pr-handoff', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, 'bundled v2 workflow must be present').toBeDefined();
    expect(content, 'the regenerated bundle must embed pr-handoff').toContain(NODE_ID);
    expect(content?.replace(/\r\n/g, '\n')).toBe(readLF(V2_FILE));
  });

  it('v1 baseline gains no pr-handoff node (byte-for-byte unchanged)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, NODE_ID), 'v1 must not gain pr-handoff').toBeUndefined();
    expect(nodeById(v1, DNC_ID), 'v1 must not gain decision-needed-check').toBeUndefined();
    const v1Raw = readLF(V1_FILE) ?? '';
    expect(/pr-handoff/.test(v1Raw), 'v1 must not reference pr-handoff at all').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-429 [P2] — shared archon-create-pr.md remains untouched or guarded.
// (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Shared command compatibility — archon-create-pr.md untouched (TD-429)', () => {
  it('archon-create-pr.md does not contain pr-handoff or BMAD-specific evidence logic', () => {
    const content = readLF(ARCHON_CREATE_PR) ?? '';
    expect(content.length, 'archon-create-pr.md must exist and have content').toBeGreaterThan(0);
    expect(
      /pr-handoff/.test(content),
      'shared command must not hard-code pr-handoff references'
    ).toBe(false);
    expect(
      /quality.evidence/i.test(content),
      'shared command must not hard-code BMAD quality evidence section'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-404 [P0] — reader safety: whole-output substitutions, bun -e +
// JSON.parse, env-export into bun -e, no grep/case/markdown/field-level.
// (AC #1, #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader safety — whole-output JSON parse, no field-ref / grep / prose (TD-404)', () => {
  it('reads ALL required whole-output substitutions', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    const requiredRefs = [
      '$resolve-story-input.output.story_ref',
      '$quality-gate-summary.output',
      '$decision-needed-check.output',
      '$code-review-auto.output',
      '$gate-planner.output',
      '$tea-rv.output',
      '$tea-rv-skipped.output',
      '$tea-nr.output',
      '$tea-nr-skipped.output',
      '$tea-tr.output',
      '$tea-tr-skipped.output',
    ];
    for (const ref of requiredRefs) {
      expect(bash, `must read ${ref}`).toContain(ref);
    }
  });

  it('uses bun -e + JSON.parse and never grep/case on raw JSON', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must use bun -e').toContain('bun -e');
    expect(bash, 'must use JSON.parse').toContain('JSON.parse');
    expect(/\bgrep\b[^\n]*story_ref/.test(bash), 'must not grep raw JSON for story_ref').toBe(
      false
    );
    expect(/\bcase\b[^\n]*\$/.test(bash), 'must not case-match raw contract data').toBe(false);
  });

  it('never reads markdown/prose as a route API', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const prose of ['decision-log.md', 'open-findings.md']) {
      expect(bash, `must not parse prose (${prose})`).not.toContain(prose);
    }
  });

  it('exports env vars into bun -e using the prefix-env pattern', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must export env vars into bun -e invocations').toMatch(/PH_\w+="?\$.*bun -e/s);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-405 [P1] — real-vs-skipped source selection by non-empty output for
// RV, NR, TR, recording source node id. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Real-vs-skipped selection — source by output presence (TD-405)', () => {
  it('the node body resolves real-or-skipped for RV, NR, TR with fallback pattern', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const gate of ['RV', 'NR', 'TR']) {
      expect(bash, `must resolve ${gate} from real or skipped output`).toMatch(
        new RegExp(`${gate}.*REAL.*${gate}.*SKIP|\\$\\{.*REAL:-.*SKIP\\}`, 'i')
      );
    }
  });

  it('the node body determines source node id from which output is non-empty', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const prefix of ['RV', 'NR', 'TR']) {
      expect(bash, `must determine ${prefix}_SOURCE`).toContain(`${prefix}_SOURCE`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-406 [P1] — artifact path map: run-dir JSON for summary/planner/
// decision-needed/skipped gates; node sidecar Markdown for real gates;
// report_file included when present. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Artifact path mapping — run-dir and node sidecars (TD-406)', () => {
  it('the node body maps correct artifact paths for each gate type', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must reference code-review-auto.md node sidecar').toContain(
      'code-review-auto.md'
    );
    expect(bash, 'must reference test-review-findings.md for real RV').toContain(
      'test-review-findings.md'
    );
    expect(bash, 'must reference nfr-findings.md for real NR').toContain('nfr-findings.md');
    expect(bash, 'must reference trace-findings.md for real TR').toContain('trace-findings.md');
    expect(bash, 'must reference tea-rv-skipped.gate.json for skipped RV').toContain(
      'tea-rv-skipped.gate.json'
    );
    expect(bash, 'must reference quality-gate-summary.json').toContain('quality-gate-summary.json');
    expect(bash, 'must reference gate-planner.json').toContain('gate-planner.json');
    expect(bash, 'must reference decision-needed.json').toContain('decision-needed.json');
  });

  it('the node body includes report_file from gate contracts', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must reference report_file field from gate contracts').toContain('report_file');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-407 [P1] — pr-handoff.json carries full collector envelope with status
// (not gate) and all evidence sections. (AC #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Contract shape — collector envelope with status, not gate (TD-407)', () => {
  it('the node body emits every required contract field', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const field of REQUIRED_CONTRACT_FIELDS) {
      expect(bash, `the contract must include ${field}`).toContain(field);
    }
  });

  it('the node body uses status (not gate) for the collector', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must emit status field').toContain('status');
    expect(bash, 'must set status to PASS').toMatch(/status:\s*['"]PASS['"]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-409 [P1] — no-deferred path renders "No decision-needed items were
// deferred." with no misleading fixed/resolved language. (AC #3)
// (Technique proof — static assertion that the node body contains the
// rendering logic is paired with this.)
// ═══════════════════════════════════════════════════════════════════════════

describe('No-deferred rendering — explicit statement (TD-409 technique)', () => {
  it('no-deferred handoff renders "No decision-needed items were deferred."', async () => {
    const handoff = syntheticHandoff();
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code, 'rendering should succeed').toBe(0);
    expect(r.stdout, 'must contain the no-deferred statement').toContain(
      'No decision-needed items were deferred.'
    );
    expect(
      /were (fixed|resolved) in this PR/i.test(r.stdout),
      'must not use fixed/resolved language for no-deferred case'
    ).toBe(false);
  });

  it('the node body contains no-deferred rendering logic', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must contain the no-deferred statement in the render pipeline').toContain(
      'No decision-needed items were deferred'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-410 [P0] — populated deferred items render each item with all fields;
// Markdown says deferred to Linear and NOT fixed in this PR. (AC #2)
// (Technique proof — rendering tested against synthetic contracts.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Populated deferred rendering — items + warning language (TD-410 technique)', () => {
  const populatedHandoff = syntheticHandoff({
    decision_needed: {
      deferred: true,
      deferred_count: 2,
      deferred_items: [
        {
          finding_id: 'TD-F001',
          title: 'Auth flow edge case',
          source_gate: 'CR',
          linear_issue_id: 'TDX-123',
          linear_url: 'https://linear.app/team/issue/TDX-123',
          status: 'deferred',
        },
        {
          finding_id: 'TD-F002',
          title: 'Rate limit boundary',
          source_gate: 'NR',
          linear_issue_id: 'TDX-456',
          linear_url: 'https://linear.app/team/issue/TDX-456',
          status: 'deferred',
        },
      ],
      artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/decision-needed.json`,
    },
  });

  it('populated deferred items render each field: finding id, title, source gate, Linear id, URL, status', async () => {
    const r = await renderHandoff(JSON.stringify(populatedHandoff));
    expect(r.code, 'rendering should succeed').toBe(0);
    expect(r.stdout).toContain('TD-F001');
    expect(r.stdout).toContain('Auth flow edge case');
    expect(r.stdout).toContain('CR');
    expect(r.stdout).toContain('TDX-123');
    expect(r.stdout).toContain('https://linear.app/team/issue/TDX-123');
    expect(r.stdout).toContain('deferred');
    expect(r.stdout).toContain('TD-F002');
    expect(r.stdout).toContain('Rate limit boundary');
    expect(r.stdout).toContain('NR');
    expect(r.stdout).toContain('TDX-456');
  });

  it('populated deferred says "deferred to Linear" and "NOT fixed in this PR"', async () => {
    const r = await renderHandoff(JSON.stringify(populatedHandoff));
    expect(r.code).toBe(0);
    expect(r.stdout, 'must say deferred to Linear').toContain('deferred to Linear');
    expect(r.stdout, 'must say NOT fixed in this PR').toContain('NOT fixed in this PR');
  });

  it('populated deferred does not contain positive/resolved wording without NOT qualifier', async () => {
    const r = await renderHandoff(JSON.stringify(populatedHandoff));
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n');
    for (const line of lines) {
      if (/were fixed in this PR/i.test(line)) {
        expect(line, 'any "fixed in this PR" must be qualified with NOT').toMatch(
          /NOT fixed in this PR/i
        );
      }
    }
  });

  it('the node body contains populated deferred rendering logic', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must contain deferred-to-Linear language').toContain('deferred to Linear');
    expect(bash, 'must contain NOT-fixed language').toContain('NOT fixed in this PR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-411 [P1] — boundary rendering: deferred items with special characters
// (pipes, newlines, brackets, empty optional values) do not break Markdown.
// ═══════════════════════════════════════════════════════════════════════════

describe('Boundary rendering — special chars in deferred items (TD-411 technique)', () => {
  it('pipes, brackets, and long titles render without breaking the table', async () => {
    const handoff = syntheticHandoff({
      decision_needed: {
        deferred: true,
        deferred_count: 1,
        deferred_items: [
          {
            finding_id: 'TD-F003',
            title:
              'Edge | case with [brackets] and a very long title that exceeds normal expectations for a finding title field',
            source_gate: 'TR',
            linear_issue_id: 'TDX-789',
            linear_url: 'https://linear.app/team/issue/TDX-789',
            status: 'deferred',
          },
        ],
        artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/decision-needed.json`,
      },
    });
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code, 'rendering should succeed with special chars').toBe(0);
    expect(r.stdout).toContain('TD-F003');
    expect(r.stdout).toContain('TDX-789');

    const dataRow = r.stdout
      .split('\n')
      .find(line => line.includes('TD-F003') && line.startsWith('|'));
    expect(dataRow, 'must find the deferred-item data row').toBeDefined();
    const cells = dataRow!
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map(c => c.trim());
    expect(cells, 'row must have exactly 5 cells matching the 5 header columns').toHaveLength(5);
    expect(cells[0]).toContain('TD-F003');
    expect(cells[1]).toContain('Edge');
    expect(cells[1]).toContain('case');
    expect(cells[1], 'pipe in title must be escaped, not create extra cells').toContain('\\|');
    expect(cells[2]).toContain('TR');
    expect(cells[3]).toContain('TDX-789');
    expect(cells[4]).toContain('deferred');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-415b [P1] — technique proof: skipped-TR (and skipped-RV) rendering.
// The DAG test (TD-415) cannot produce a skipped TR because gate-planner
// always sets run_tr=true. This technique proof feeds synthetic contracts
// with skipped sources through the rendering pipeline and asserts the
// Markdown shows correct source node ids and artifact paths. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Skipped-TR rendering — technique proof (TD-415b)', () => {
  it('RV skipped + NR real + TR skipped → handoff.md shows correct skipped sources and artifact paths', async () => {
    const handoff = syntheticHandoff({
      gates: {
        cr: {
          gate: 'PASS',
          source: 'code-review-auto',
          findings_count: 0,
          artifact_file: `${ARTIFACTS_DIR}/nodes/code-review-auto.md`,
          report_file: 'code-review-report.md',
        },
        rv: {
          gate: 'SKIPPED',
          source: 'tea-rv-skipped',
          findings_count: 0,
          artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/tea-rv-skipped.gate.json`,
          report_file: null,
        },
        nr: {
          gate: 'PASS',
          source: 'tea-nr',
          findings_count: 0,
          artifact_file: `${ARTIFACTS_DIR}/nodes/nfr-findings.md`,
          report_file: 'tea-nr-report.md',
        },
        tr: {
          gate: 'SKIPPED',
          source: 'tea-tr-skipped',
          findings_count: 0,
          artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/tea-tr-skipped.gate.json`,
          report_file: null,
        },
      },
    });
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code, 'rendering should succeed').toBe(0);

    const lines = r.stdout.split('\n');
    const rvRow = lines.find(l => l.startsWith('|') && l.includes('RV'));
    const trRow = lines.find(l => l.startsWith('|') && l.includes('TR'));
    expect(rvRow, 'must have an RV row').toBeDefined();
    expect(trRow, 'must have a TR row').toBeDefined();
    expect(rvRow!, 'RV row must show tea-rv-skipped source').toContain('tea-rv-skipped');
    expect(rvRow!, 'RV row must link to skipped gate JSON').toContain('tea-rv-skipped.gate.json');
    expect(trRow!, 'TR row must show tea-tr-skipped source').toContain('tea-tr-skipped');
    expect(trRow!, 'TR row must link to skipped gate JSON').toContain('tea-tr-skipped.gate.json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-412 [P0] — story_ref validation: mismatched story_ref on any consumed
// contract fails closed. (AC #4)
// Static half: the node body must contain the validation logic.
// Technique proof: the parse+validate pipeline exits non-zero with no stdout
// when a consumed contract carries a mismatched story_ref.
// The DAG half is skipped because upstream validation eats the bad ref
// before pr-handoff ever runs — see the DAG sibling skip scaffold.
// ═══════════════════════════════════════════════════════════════════════════

describe('Story-ref validation — static + technique proof (TD-412)', () => {
  it('the node body validates story_ref on every consumed contract', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must validate story_ref').toContain('story_ref');
    expect(bash, 'must compare story_ref against resolved ref').toMatch(
      /story_ref.*!==.*ref|story_ref.*mismatch/i
    );
  });

  it('the node body fails closed on story_ref mismatch (exit 1 / throw before stdout)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must throw or exit on mismatch').toMatch(/throw|exit 1|process\.exit\(1\)/);
  });
});

// ── Technique proof: the parse+validate pipeline the pr-handoff node must
// adopt for story_ref checking. Mirrors the parse() function from the target
// node shape: JSON.parse + story_ref comparison + throw on mismatch. Run as
// real bash + bun subprocess to prove the technique is sound.
const STORY_REF_VALIDATION_SCRIPT = `
  set -e
  CONTRACT="$1"
  RESOLVED_REF="$2"
  RESULT=$(
    PH_CONTRACT="$CONTRACT" PH_REF="$RESOLVED_REF" \\
    bun -e '
      const raw = process.env.PH_CONTRACT;
      const ref = process.env.PH_REF;
      let c;
      try { c = JSON.parse(raw); } catch { throw new Error("not valid JSON"); }
      if (!c.story_ref || c.story_ref !== ref) throw new Error("story_ref mismatch: " + c.story_ref + " !== " + ref);
      process.stdout.write(JSON.stringify({ validated: true, story_ref: c.story_ref }));
    '
  )
  printf '%s' "$RESULT"
`;

interface ValidationResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runStoryRefCheck = async (
  contractJson: string,
  resolvedRef: string
): Promise<ValidationResult> => {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [
      '-c',
      STORY_REF_VALIDATION_SCRIPT,
      '_',
      contractJson,
      resolvedRef,
    ]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

describe('Story-ref fail-closed technique proof (TD-412 technique)', () => {
  it('a matching story_ref passes and emits output', async () => {
    const contract = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'test-producer',
      story_ref: CANONICAL_REF,
      gate: 'PASS',
      findings_count: 0,
    });
    const r = await runStoryRefCheck(contract, CANONICAL_REF);
    expect(r.code, 'matching story_ref must exit 0').toBe(0);
    expect(r.stdout.length, 'must emit output').toBeGreaterThan(0);
  });

  it('a mismatched story_ref fails closed with no stdout', async () => {
    const contract = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'test-producer',
      story_ref: 'stale-wrong-ref',
      gate: 'PASS',
      findings_count: 0,
    });
    const r = await runStoryRefCheck(contract, CANONICAL_REF);
    expect(r.code, 'mismatched story_ref must exit non-zero').not.toBe(0);
    expect(r.stdout, 'must emit no output on mismatch').toBe('');
  });

  it('an empty story_ref fails closed with no stdout', async () => {
    const contract = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'test-producer',
      story_ref: '',
      gate: 'PASS',
      findings_count: 0,
    });
    const r = await runStoryRefCheck(contract, CANONICAL_REF);
    expect(r.code, 'empty story_ref must exit non-zero').not.toBe(0);
    expect(r.stdout, 'must emit no output on empty ref').toBe('');
  });

  it('a missing story_ref field fails closed with no stdout', async () => {
    const contract = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'test-producer',
      gate: 'PASS',
      findings_count: 0,
    });
    const r = await runStoryRefCheck(contract, CANONICAL_REF);
    expect(r.code, 'missing story_ref must exit non-zero').not.toBe(0);
    expect(r.stdout, 'must emit no output on missing ref').toBe('');
  });

  it('malformed JSON fails closed with no stdout', async () => {
    const r = await runStoryRefCheck('not-json{oops', CANONICAL_REF);
    expect(r.code, 'malformed JSON must exit non-zero').not.toBe(0);
    expect(r.stdout, 'must emit no output on malformed JSON').toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-413 [P0] — malformed input: empty or invalid JSON fails closed. (AC #4)
// (Static half; runtime proven in DAG sibling.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Malformed input — static fail-closed assertion (TD-413)', () => {
  it('the node body guards against empty required inputs', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must check for empty RESOLVED_REF').toContain('-z "$RESOLVED_REF"');
    expect(bash, 'must check for empty SUMMARY').toMatch(/-z "\$SUMMARY"|if \[ -z "\$SUMMARY"/);
  });

  it('the node uses set -e for fail-fast behavior', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash.trimStart(), 'must start with or contain set -e').toMatch(/^set -e|set -e/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-416 [P1] — gate outcome rendering covers PASS, CONCERNS, SKIPPED.
// (Technique proof.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Gate outcome rendering — PASS/CONCERNS/SKIPPED values (TD-416 technique)', () => {
  it('renders PASS gate outcomes correctly', async () => {
    const handoff = syntheticHandoff();
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('PASS');
  });

  it('renders SKIPPED gate outcomes for skipped branches', async () => {
    const handoff = syntheticHandoff({
      gates: {
        ...syntheticHandoff().gates,
        rv: {
          gate: 'SKIPPED',
          source: 'tea-rv-skipped',
          findings_count: 0,
          artifact_file: `${ARTIFACTS_DIR}/bmad-dev-story-with-tea-fix-loop/tea-rv-skipped.gate.json`,
          report_file: null,
        },
      },
    });
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('SKIPPED');
    expect(r.stdout).toContain('tea-rv-skipped');
  });

  it('renders CONCERNS gate outcomes', async () => {
    const handoff = syntheticHandoff({
      gates: {
        ...syntheticHandoff().gates,
        nr: {
          gate: 'CONCERNS',
          source: 'tea-nr',
          findings_count: 2,
          artifact_file: `${ARTIFACTS_DIR}/nodes/nfr-findings.md`,
          report_file: 'tea-nr-report.md',
        },
      },
    });
    const r = await renderHandoff(JSON.stringify(handoff));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('CONCERNS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-420 [P1] — timeout and external-work guard: node declares bounded
// timeout, local shell + bun -e only, no network calls. (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('Timeout guard — bounded, local-only work (TD-420)', () => {
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
      expect(bash, `must not invoke '${forbidden.trim()}'`).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-421 [P1] — create-pull-request.prompt_suffix instructs the agent to
// read pr-handoff.md, include it as Quality Evidence, skip if absent, and
// never imply deferred items were fixed. (AC #1, #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Prompt suffix — evidence inclusion instructions (TD-421)', () => {
  it('create-pull-request has a prompt_suffix referencing pr-handoff.md', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const pr = nodeById(v2, PR_ID) as { prompt_suffix?: string } | undefined;
    expect(pr?.prompt_suffix, 'create-pull-request must have a prompt_suffix').toBeDefined();
    expect(pr!.prompt_suffix!, 'prompt_suffix must reference pr-handoff.md').toContain(
      'pr-handoff.md'
    );
  });

  it('prompt_suffix includes graceful degradation (skip if absent)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const suffix =
      (nodeById(v2, PR_ID) as { prompt_suffix?: string } | undefined)?.prompt_suffix ?? '';
    expect(suffix, 'must instruct to skip if file does not exist').toMatch(
      /does not exist|if.*exist|not.*found|skip|absent/i
    );
  });

  it('prompt_suffix includes never-imply-fixed instruction', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const suffix =
      (nodeById(v2, PR_ID) as { prompt_suffix?: string } | undefined)?.prompt_suffix ?? '';
    expect(suffix, 'must instruct never to imply deferred items were fixed').toMatch(
      /NEVER.*imply.*deferred.*fixed|NOT.*imply.*fixed/i
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-422 [P1] — create-pull-request preserves its identity: command, provider,
// model, context, depends only on pr-handoff. (AC #1, #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('PR node identity — shape preserved, depends only on pr-handoff (TD-422)', () => {
  it('create-pull-request preserves command, provider, model, context unchanged', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const pr = nodeById(v2, PR_ID) as Record<string, unknown> | undefined;
    expect(pr!.command).toBe('archon-create-pr');
    expect(pr!.provider).toBe('claude');
    expect(pr!.model).toBe('sonnet');
    expect(pr!.context).toBe('fresh');
  });

  it('create-pull-request depends only on pr-handoff', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, PR_ID)?.depends_on).toEqual([NODE_ID]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-423 [P1] — test registration: contract test in non-mock batch; DAG test
// as its own isolated segment. EXPECTED-RED until package.json is updated.
// (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test registration — mock isolation preserved (TD-423, expected-red until wired)', () => {
  it('the pr-handoff contract test is registered in a shared (non-mock) batch segment', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the contract test must be registered').toContain(
      'v2-pr-handoff-contract.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-pr-handoff-contract.test.ts'));
    expect(owning.length, 'exactly one segment must own the contract test').toBe(1);
    expect(
      owning[0]?.includes('v2-pr-handoff-dag.test.ts'),
      'the contract test must NOT share a segment with the mock.module DAG test'
    ).toBe(false);
  });

  it('the pr-handoff DAG test is registered as its OWN standalone bun invocation', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the DAG test must be registered').toContain('v2-pr-handoff-dag.test.ts');
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-pr-handoff-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the DAG test').toBe(1);
    expect(owning[0], 'the DAG test must run alone (mock.module is process-global)').toBe(
      'bun test src/defaults/v2-pr-handoff-dag.test.ts'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-424 [P3] — naming hygiene: new test files contain no real plan/story/
// finding identifiers; synthetic story keys stay neutral. (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — no plan references in test files (TD-424)', () => {
  it('the new node id and output type are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const label of [NODE_ID, OUTPUT_TYPE]) {
      expect(kebab.test(label), `${label} must be kebab-case`).toBe(true);
    }
  });

  it('the generated pr-handoff test files contain no plan/story/epic/finding identifiers', () => {
    const files = ['v2-pr-handoff-dag.test.ts', 'v2-pr-handoff-contract.test.ts'];
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
// TD-427 [P0] — security scope: diff introduces no auth, adapter, credential,
// Linear API, MCP, fetch, GraphQL, or network behavior. (AC #1)
// (Green now — guards scope; must stay green.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Security scope — no credential/network/auth broadening (TD-427)', () => {
  it('the pr-handoff node body invokes no network/credential/auth path', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    for (const forbidden of [
      'LINEAR_API_KEY',
      'graphql',
      'fetch(',
      'curl ',
      'wget ',
      'api.linear.app',
      'ANTHROPIC_API_KEY',
      'TOKEN_ENCRYPTION_KEY',
    ]) {
      expect(
        bash.toLowerCase().includes(forbidden.toLowerCase()),
        `must not reference live path (${forbidden})`
      ).toBe(false);
    }
  });

  it('the pr-handoff node declares no mcp: config', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as object | undefined;
    if (node) {
      expect('mcp' in node, 'the node must not wire an mcp: live path').toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-428 [P2] — unset ARTIFACTS_DIR degrades gracefully: stdout contract
// still emitted, best-effort file writes skipped without failing.
// (Static assertion; runtime proof in DAG sibling.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Artifacts-dir degradation — guarded best-effort writes (TD-428)', () => {
  it('the node body guards file writes with ARTIFACTS_DIR presence check', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must guard artifact writes on ARTIFACTS_DIR presence').toMatch(
      /if \[ -n "\$\{ARTIFACTS_DIR:-\}"/
    );
  });

  it('best-effort writes use || true to avoid failing the node', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = nodeBash(v2, NODE_ID);
    expect(bash, 'must use || true for best-effort file operations').toContain('|| true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-426 [P1] — route-loop regression: the prior quality loop behavior
// remains intact after adding pr-handoff. (Static half; runtime in DAG.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Route-loop regression — no structural change to loop (TD-426)', () => {
  it('pr-handoff carries no route_loop and no when: bypass', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, NODE_ID) as object | undefined;
    if (node) {
      expect('route_loop' in node, 'pr-handoff must not be a route_loop').toBe(false);
      expect('when' in node, 'pr-handoff must not carry a when: bypass').toBe(false);
    }
  });

  it('no second route_loop exists and the loop internals are unchanged', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds).toEqual([LOOP_ID]);
    expect(routeLoopBlock(v2).max_iterations).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-425 [P2] — validation commands documented. (AC #5)
// Not a code test — just records the required commands.
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation commands — documented (TD-425)', () => {
  it('required commands are documented in the test run instructions', () => {
    // This test exists to document the required validation commands.
    // They are: focused contract test, isolated DAG test, check:bundled, validate.
    expect(true).toBe(true);
  });
});
