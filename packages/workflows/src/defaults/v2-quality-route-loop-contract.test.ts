/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for consolidating
 * the v2 quality routing into ONE bounded route_loop sourced from the summary:
 * add a `verify-quality-summary` reader that turns the summary JSON into a bare
 * PASS/FAIL, remove the old `code-review-gate` route_loop, add
 * `quality-route-loop` (FAIL -> dev-story, PASS -> create-pull-request,
 * exhausted -> review-loop-error), and keep ERROR fail-closed.
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive self-contained bash reader-validation proofs — NO mock.module() needed,
 * so this file is safe to co-locate in the shared `bun test` batch (the
 * GREEN-phase step registers it alongside v2-quality-summary-contract.test.ts in
 * packages/workflows/package.json).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-quality-route-loop-dag.test.ts (real bash + real executor, isolated
 * invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * The YAML-structural assertions target the NOT-YET-IMPLEMENTED consolidation
 * and are EXPECTED TO FAIL until the v2 YAML:
 *   1. carries the summary baseline (quality-gate-summary aggregator + the
 *      resolved TR path: tea-tr gated + tea-tr-skipped sibling),
 *   2. adds `verify-quality-summary` (bash reader over the WHOLE summary output,
 *      bun -e + JSON.parse, envelope + identity validation, bare PASS/FAIL),
 *   3. removes the `code-review-gate` route_loop and rewires
 *      gate-planner.depends_on onto verify-story-identity,
 *   4. adds exactly ONE route_loop `quality-route-loop`
 *      (from: verify-quality-summary, condition bare-output PASS, routes
 *      positive: create-pull-request / negative: dev-story / exhausted:
 *      review-loop-error, max_iterations 20),
 *   5. rewires create-pull-request.depends_on and review-loop-error.depends_on
 *      both onto [quality-route-loop], and
 *   6. leaves the v1 baseline byte-for-byte unchanged and the source/bundle
 *      in sync.
 *
 * The self-contained reader-validation proofs (TD-205, TD-207) validate that the
 * CHOSEN parser/validator pattern is sound; they pass in the red phase and are
 * paired with the static YAML assertions that the reader node must adopt it.
 *
 * Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts
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

const SUMMARY_ID = 'quality-gate-summary';
const READER_ID = 'verify-quality-summary';
const LOOP_ID = 'quality-route-loop';
const OLD_LOOP_ID = 'code-review-gate';
const IDENTITY_ID = 'verify-story-identity';

// The single quality loop is sourced from the reader; the reader is sourced from
// the summary + the resolved story input (for the same-story_ref re-check).
const EXPECTED_READER_DEPS = [SUMMARY_ID, 'resolve-story-input'];

// The route condition compares the reader's BARE output (bare-output form bypasses
// field-ref loader validation, which is why a bash reader node is required).
const EXPECTED_CONDITION = "$verify-quality-summary.output == 'PASS'";
const EXPECTED_MAX_ITERATIONS = 20;
const EXPECTED_ROUTES = {
  positive: 'decision-needed-check',
  negative: 'dev-story',
  exhausted: 'review-loop-error',
};

// The reader validates the full route envelope + story identity before emitting.
const REQUIRED_READER_VALIDATION_TOKENS = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'gate',
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

const readerBash = (wf: WorkflowDefinition): string =>
  (nodeById(wf, READER_ID) as { bash?: string } | undefined)?.bash ?? '';

const routeLoopBlock = (
  wf: WorkflowDefinition
): {
  from?: string;
  condition?: string;
  max_iterations?: number;
  routes?: Record<string, string>;
} =>
  (nodeById(wf, LOOP_ID) as { route_loop?: Record<string, unknown> } | undefined)?.route_loop ?? {};

// The exact reader-validation pipeline the target node adopts (story-mandated
// shape). Reused by the executable technique proofs so they prove the CHOSEN
// technique end-to-end in a real bash + bun subprocess.
const READER_VALIDATION_SCRIPT = `
  set -e
  SUMMARY="$1"
  RESOLVED_REF="$2"
  GATE=$(
    QRS_SUMMARY="$SUMMARY" QRS_RESOLVED="$RESOLVED_REF" \\
    bun -e '
      const s = JSON.parse(process.env.QRS_SUMMARY || "");
      if (s.contract_version !== "1.0") { console.error("ERROR: contract_version"); process.exit(1); }
      if (s.workflow !== "${V2_STEM}") { console.error("ERROR: workflow"); process.exit(1); }
      if (s.node !== "${SUMMARY_ID}") { console.error("ERROR: node"); process.exit(1); }
      if (!s.story_ref || s.story_ref !== process.env.QRS_RESOLVED) { console.error("ERROR: story_ref"); process.exit(1); }
      if (s.gate !== "PASS" && s.gate !== "FAIL") { console.error("ERROR: gate"); process.exit(1); }
      process.stdout.write(s.gate);
    '
  )
  printf '%s' "$GATE"
`;

// Neutral synthetic story reference — not a real plan, story, epic, or finding
// identifier. Uses x1- prefix to satisfy resolve-story-input's key pattern
// ([a-z][a-z0-9]*-[0-9]+-) without matching the naming-hygiene guard (a[0-9]).
const CANONICAL_REF = 'x1-0-synthetic-quality-ref';

interface ReaderResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runReaderValidation = async (
  summaryJson: string,
  resolvedRef: string
): Promise<ReaderResult> => {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [
      '-c',
      READER_VALIDATION_SCRIPT,
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
// TD-200 [P0] — the summary baseline (aggregator + resolved TR path) must exist
// before the route loop can read a summary contract. Precondition gate that
// prevents false failures from a stale checkout. (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Baseline precondition — summary aggregator + resolved TR path exist (TD-200)', () => {
  it('quality-gate-summary aggregator exists as a bash node the loop can read', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, SUMMARY_ID);
    expect(
      node,
      'quality-gate-summary must exist before the route loop can source it'
    ).toBeDefined();
    expect('bash' in (node as object), 'quality-gate-summary must be a bash node').toBe(true);
  });

  it('the resolved TR path (tea-tr gated + tea-tr-skipped sibling) is present', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const tr = nodeById(v2, 'tea-tr') as { when?: string } | undefined;
    expect(tr?.when, 'tea-tr must be gated so a skip sibling can resolve the TR join').toBe(
      '$gate-planner.output.run_tr == true'
    );
    expect(
      nodeById(v2, 'tea-tr-skipped'),
      'tea-tr-skipped must exist (summary baseline)'
    ).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-201 [P0] — exactly ONE route_loop node exists and it is quality-route-loop;
// code-review-gate is absent and no node references it (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('One routing authority — single quality-route-loop, old loop removed (TD-201)', () => {
  it('exactly one route_loop node exists and it is quality-route-loop', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routeLoopIds = v2.nodes.filter(n => 'route_loop' in (n as object)).map(n => n.id);
    expect(routeLoopIds, 'the v2 DAG must consolidate to exactly one route_loop').toEqual([
      LOOP_ID,
    ]);
  });

  it('code-review-gate is removed entirely', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeById(v2, OLD_LOOP_ID),
      'the code-review-gate route_loop must be deleted'
    ).toBeUndefined();
  });

  it('no surviving node lists code-review-gate in depends_on or a route target', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const n of v2.nodes) {
      expect(
        n.depends_on ?? [],
        `${n.id} must not depend on the removed code-review-gate`
      ).not.toContain(OLD_LOOP_ID);
      const routes = (n as { route_loop?: { routes?: Record<string, string> } }).route_loop?.routes;
      if (routes) {
        expect(
          Object.values(routes),
          `${n.id} route targets must not reference the removed code-review-gate`
        ).not.toContain(OLD_LOOP_ID);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-202 [P1] — gate-planner is rewired onto the retained identity barrier and
// carries no stale route reference (AC #1, #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Rewire — gate-planner depends on the retained identity barrier (TD-202)', () => {
  it('gate-planner.depends_on includes verify-story-identity and NOT code-review-gate', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, 'gate-planner')!.depends_on ?? [];
    expect(deps, 'gate-planner must source from the retained identity barrier').toContain(
      IDENTITY_ID
    );
    expect(deps, 'gate-planner must not source from the removed route loop').not.toContain(
      OLD_LOOP_ID
    );
  });

  it('verify-story-identity is retained as the fail-closed CR identity barrier', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, IDENTITY_ID);
    expect(
      node,
      'verify-story-identity must be retained (only gate-planner deps move)'
    ).toBeDefined();
    expect('bash' in (node as object), 'verify-story-identity stays a bash gate reader').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-203 [P0] — verify-quality-summary exists as a deterministic bash reader
// depending on the summary + resolved story input, bounded, typed (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader seam — verify-quality-summary bash reader exists and is bounded (TD-203)', () => {
  it('verify-quality-summary exists and is a bash node (no AI, no command, no prompt)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, READER_ID);
    expect(node, 'verify-quality-summary reader node must exist').toBeDefined();
    expect('bash' in node!, 'the reader must be a bash node').toBe(true);
    expect('prompt' in node!, 'the reader must NOT be a prompt (prose) node').toBe(false);
    expect('command' in node!, 'the reader must NOT be a command node').toBe(false);
  });

  it('verify-quality-summary depends on quality-gate-summary + resolve-story-input', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = [...(nodeById(v2, READER_ID)!.depends_on ?? [])].sort();
    expect(deps, 'the reader joins the summary + the resolved story input').toEqual(
      [...EXPECTED_READER_DEPS].sort()
    );
  });

  it('verify-quality-summary declares output_type: quality-summary-verified and a bounded timeout', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, READER_ID) as { output_type?: string; timeout?: number };
    expect(node.output_type, 'the reader must declare its typed output').toBe(
      'quality-summary-verified'
    );
    expect(typeof node.timeout, 'the reader must declare a bounded timeout').toBe('number');
    expect(node.timeout as number, 'the reader timeout must be positive').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-204 [P0] — the reader reads the WHOLE summary output, validates envelope +
// identity with bun -e + JSON.parse, and never uses field-level access, grep, or
// case on raw JSON (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader safety — whole-output read, JSON.parse validation, no field-ref (TD-204)', () => {
  it('the reader selects the WHOLE summary output ($quality-gate-summary.output)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(readerBash(v2), 'the reader must read the whole summary output').toContain(
      '$quality-gate-summary.output'
    );
  });

  it('the reader NEVER uses field-level $quality-gate-summary.output.gate (loader-forbidden route path)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      readerBash(v2),
      'field access on a schemaless bash node is rejected at load time — forbidden'
    ).not.toContain('$quality-gate-summary.output.gate');
  });

  it('the reader parses with bun -e + JSON.parse, never grep/case on raw JSON', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = readerBash(v2);
    expect(bash, 'the reader must parse with bun -e').toContain('bun -e');
    expect(bash, 'the reader must parse with JSON.parse').toContain('JSON.parse');
    expect(
      /\bgrep\b[^\n]*\b(PASS|FAIL)\b/.test(bash),
      'the reader must not grep raw JSON for a gate substring'
    ).toBe(false);
    expect(
      /\bcase\b[^\n]*\$(quality-gate-summary)/.test(bash),
      'the reader must not case-match the raw summary for a gate value'
    ).toBe(false);
  });

  it('the reader validates the full envelope + re-checks story identity against resolve-story-input', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = readerBash(v2);
    for (const token of REQUIRED_READER_VALIDATION_TOKENS) {
      expect(bash, `the reader must validate ${token} before emitting`).toContain(token);
    }
    expect(bash, 'the reader must re-check story_ref against the resolved story input').toContain(
      '$resolve-story-input.output.story_ref'
    );
  });

  it('the reader emits a bare gate via printf (nothing else on stdout)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = readerBash(v2);
    expect(
      bash,
      'the reader must printf the bare gate value the route condition compares'
    ).toContain('printf');
    expect(
      /echo\s+["']?\{/.test(bash),
      'the reader must not echo a JSON blob (the route compares a bare PASS/FAIL)'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-205 [P1] — technique proof (real bash + bun): a valid summary yields exactly
// "PASS" or "FAIL" on stdout, with no extra prose. Paired with the static
// assertion (TD-204) that the reader adopts this pipeline. (AC #1, #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader stdout — exact bare PASS/FAIL, no prose (TD-205)', () => {
  it('a valid PASS summary yields exactly the byte string "PASS"', async () => {
    const r = await runReaderValidation(validSummary({ gate: 'PASS' }), CANONICAL_REF);
    expect(r.code, 'a clean PASS summary must exit 0').toBe(0);
    expect(r.stdout, 'stdout must be exactly PASS with no trailing newline or prose').toBe('PASS');
  });

  it('a valid FAIL summary yields exactly the byte string "FAIL"', async () => {
    const r = await runReaderValidation(validSummary({ gate: 'FAIL' }), CANONICAL_REF);
    expect(r.code, 'a clean FAIL summary must exit 0').toBe(0);
    expect(r.stdout, 'stdout must be exactly FAIL with no trailing newline or prose').toBe('FAIL');
  });

  it('a report-file substring that spells "gate":"FAIL" cannot flip a PASS summary', async () => {
    const r = await runReaderValidation(
      validSummary({ gate: 'PASS', report_file: 'leftover-"gate":"FAIL"-note.md' }),
      CANONICAL_REF
    );
    expect(r.stdout, 'the parsed gate field wins over any substring noise').toBe('PASS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-207 [P0] — technique proof (real bash + bun): every malformed, stale,
// wrong-workflow, wrong-node, wrong-story, empty, or invalid-gate summary makes
// the reader fail closed with NO PASS/FAIL on stdout. Executable half of the
// malformed/stale coverage; the mid-DAG injection half is a skipped scaffold in
// the DAG sibling (no fault-injection seam). (AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Reader fail-closed — malformed/stale/invalid summary yields no route value (TD-207)', () => {
  const expectFailClosed = (r: ReaderResult, why: string): void => {
    expect(r.code, `${why}: must exit non-zero`).not.toBe(0);
    expect(r.stdout, `${why}: must not emit PASS`).not.toBe('PASS');
    expect(r.stdout, `${why}: must not emit FAIL`).not.toBe('FAIL');
  };

  it('malformed (non-JSON) summary fails closed', async () => {
    expectFailClosed(await runReaderValidation('not-json{oops', CANONICAL_REF), 'malformed JSON');
  });

  it('empty summary output fails closed', async () => {
    expectFailClosed(await runReaderValidation('', CANONICAL_REF), 'empty summary');
  });

  it('wrong contract_version fails closed', async () => {
    expectFailClosed(
      await runReaderValidation(validSummary({ contract_version: '0.9' }), CANONICAL_REF),
      'wrong contract_version'
    );
  });

  it('wrong workflow identity fails closed', async () => {
    expectFailClosed(
      await runReaderValidation(validSummary({ workflow: 'some-other-workflow' }), CANONICAL_REF),
      'wrong workflow'
    );
  });

  it('wrong producer node identity fails closed', async () => {
    expectFailClosed(
      await runReaderValidation(validSummary({ node: 'code-review-auto' }), CANONICAL_REF),
      'wrong node'
    );
  });

  it('a stale (mismatched) story_ref fails closed', async () => {
    expectFailClosed(
      await runReaderValidation(validSummary({ story_ref: 'stale-story-ref' }), CANONICAL_REF),
      'stale story_ref'
    );
  });

  it('an empty story_ref fails closed', async () => {
    expectFailClosed(
      await runReaderValidation(validSummary({ story_ref: '' }), CANONICAL_REF),
      'empty story_ref'
    );
  });

  it('an invalid gate (neither PASS nor FAIL, e.g. CONCERNS/ERROR/SKIPPED) fails closed', async () => {
    for (const bad of ['CONCERNS', 'ERROR', 'SKIPPED', 'MAYBE', 'pass', '']) {
      expectFailClosed(
        await runReaderValidation(validSummary({ gate: bad }), CANONICAL_REF),
        `invalid gate '${bad}'`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-208 [P1] — quality-route-loop shape: depends only on the reader; from the
// reader; bare-output condition; positive/negative/exhausted routes; bounded
// budget (AC #1, #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Route-loop shape — sourced from the reader, correct routes (TD-208)', () => {
  it('quality-route-loop depends only on [verify-quality-summary] (its from node)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeById(v2, LOOP_ID)!.depends_on ?? [],
      'the loop must depend solely on its from node'
    ).toEqual([READER_ID]);
  });

  it('route_loop.from is verify-quality-summary and condition is the bare-output PASS comparison', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const block = routeLoopBlock(v2);
    expect(block.from, 'the loop must be sourced from the reader').toBe(READER_ID);
    expect(block.condition, 'the condition must compare the reader bare output to PASS').toBe(
      EXPECTED_CONDITION
    );
  });

  it('route_loop.routes are positive: decision-needed-check, negative: dev-story, exhausted: review-loop-error', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routes = routeLoopBlock(v2).routes ?? {};
    expect(routes.positive, 'PASS routes forward to the decision-needed-check seam').toBe(
      EXPECTED_ROUTES.positive
    );
    expect(routes.negative, 'FAIL routes back to the dev-story fix loop').toBe(
      EXPECTED_ROUTES.negative
    );
    expect(routes.exhausted, 'budget exhaustion routes to the terminal error node').toBe(
      EXPECTED_ROUTES.exhausted
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-209 [P1] — route_loop schema/loader compatibility: no when/trigger_rule/
// retry; the edited DAG passes parseWorkflow (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Schema + loader — route_loop constraints honored, DAG validates (TD-209)', () => {
  it('quality-route-loop carries no when, trigger_rule, or retry (schema-forbidden on a route_loop)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, LOOP_ID) as object;
    expect('when' in node, 'route_loop must not carry when').toBe(false);
    expect('trigger_rule' in node, 'route_loop must not carry trigger_rule').toBe(false);
    expect('retry' in node, 'route_loop must not carry retry').toBe(false);
  });

  it('the edited v2 workflow passes schema + DAG validation via parseWorkflow', () => {
    const content = readLF(V2_FILE);
    const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
    expect(result.error, `parseWorkflow reported: ${result.error?.error ?? 'none'}`).toBeNull();
    expect((result.workflow as WorkflowDefinition).nodes.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-218 [P1] — tail wiring: create-pull-request and review-loop-error both
// depend on quality-route-loop (no stale dependencies) (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tail wiring — PR depends on decision-needed-check, error target depends on the route loop (TD-218)', () => {
  it('create-pull-request.depends_on is exactly [decision-needed-check]', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeById(v2, 'create-pull-request')!.depends_on ?? [],
      'the PR tail depends on the decision-needed-check seam inserted at the PASS exit'
    ).toEqual(['decision-needed-check']);
  });

  it('review-loop-error.depends_on is exactly [quality-route-loop]', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      nodeById(v2, 'review-loop-error')!.depends_on ?? [],
      'the error node is the loop exhausted target and must depend on the loop'
    ).toEqual([LOOP_ID]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-235 [P0] — review-loop-error is a terminal error node: nothing routes on it
// and it emits no route-facing gate/status contract (the behavioral exit-non-zero
// half is proven in the DAG sibling TD-222) (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal error node — review-loop-error emits no routable contract (TD-235)', () => {
  it('no node depends on review-loop-error and no route targets it (it is terminal)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const n of v2.nodes) {
      if (n.id === 'review-loop-error') continue;
      expect(
        n.depends_on ?? [],
        `${n.id} must not depend on the terminal error node`
      ).not.toContain('review-loop-error');
      const routes = (n as { route_loop?: { routes?: Record<string, string> } }).route_loop?.routes;
      if (routes && n.id !== LOOP_ID) {
        expect(
          Object.values(routes),
          `${n.id} must not route onto the terminal error node`
        ).not.toContain('review-loop-error');
      }
    }
    // The only reference to review-loop-error is the quality loop's exhausted route.
    const exhausted = routeLoopBlock(v2).routes?.exhausted;
    expect(exhausted, 'the error node is reachable only as the loop exhausted target').toBe(
      'review-loop-error'
    );
  });

  it('review-loop-error declares no route-facing gate/status output_type', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'review-loop-error') as { output_type?: string } | undefined;
    // A terminal error node must not masquerade as a routable quality contract.
    for (const routable of ['quality-gate-summary', 'quality-summary-verified', 'gate-summary']) {
      expect(
        node?.output_type,
        `review-loop-error must not emit the routable ${routable} contract`
      ).not.toBe(routable);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-233 [P1] — the loop budget is asserted and documented as 20 (the value of
// the loop being replaced) unless the owner changes the story decision (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Loop budget — max_iterations pinned to the documented value (TD-233)', () => {
  it('quality-route-loop.max_iterations is 20 (continuity with the replaced loop)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    // SEAM: the workflow description says "up to three rounds" and state.json sets
    // maxRounds: 3; this story preserves 20 for continuity. If the maintainer
    // changes the budget to 3, update this constant and the exhaustion DAG proof.
    expect(routeLoopBlock(v2).max_iterations, 'budget must match the documented decision').toBe(
      EXPECTED_MAX_ITERATIONS
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-234 [P1] — the PASS route targets create-pull-request in this story and does
// NOT target the not-yet-existing decision-needed-check (the later seam) (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('Forward target — PASS routes to decision-needed-check at the PASS seam (TD-234)', () => {
  it('the positive route target exists as a real node in the DAG', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const positive = routeLoopBlock(v2).routes?.positive;
    expect(positive, 'the positive route must reference an existing node').toBe(
      EXPECTED_ROUTES.positive
    );
    expect(nodeById(v2, positive as string), 'the positive target node must exist').toBeDefined();
  });

  it('decision-needed-check exists as the positive route target at the PASS seam', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(routeLoopBlock(v2).routes?.positive, 'PASS routes to decision-needed-check').toBe(
      'decision-needed-check'
    );
    const node = nodeById(v2, 'decision-needed-check');
    expect(node, 'decision-needed-check must exist at the PASS seam').toBeDefined();
    expect('bash' in node!, 'decision-needed-check must be a bash node').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-230 [P1] — the reader and the error node declare bounded timeouts and run no
// unbounded external command beyond local bun -e JSON parsing (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Timeout guard — reader + error node bounded, no unbounded external work (TD-230)', () => {
  it('verify-quality-summary and review-loop-error both declare bounded timeouts', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const id of [READER_ID, 'review-loop-error']) {
      const t = (nodeById(v2, id) as { timeout?: number } | undefined)?.timeout;
      expect(typeof t, `${id} must declare a numeric timeout`).toBe('number');
      expect(t as number, `${id} timeout must be positive`).toBeGreaterThan(0);
    }
  });

  it('neither the reader nor the error node invokes an unbounded network/watch command', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bodies = [READER_ID, 'review-loop-error']
      .map(id => (nodeById(v2, id) as { bash?: string } | undefined)?.bash ?? '')
      .join('\n');
    for (const forbidden of ['curl ', 'wget ', 'nc ', 'tail -f', 'sleep ']) {
      expect(bodies, `nodes must not invoke an unbounded '${forbidden.trim()}'`).not.toContain(
        forbidden
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-210 [P1] — edited v2 source + BUNDLED_WORKFLOWS match; v1 baseline is
// byte-for-byte unchanged (rollback safety). Pair with `bun run check:bundled`.
// (AC #5, #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Bundle parity — v2 source/bundle in sync, v1 untouched (TD-210)', () => {
  it('bundled v2 content matches the on-disk source and embeds the route loop', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, 'bundled v2 workflow must be present').toBeDefined();
    expect(content, 'the regenerated bundle must embed quality-route-loop').toContain(LOOP_ID);
    expect(content, 'the regenerated bundle must embed verify-quality-summary').toContain(
      READER_ID
    );
    expect(content?.replace(/\r\n/g, '\n')).toBe(readLF(V2_FILE));
  });

  it('the bundled v2 no longer embeds the removed code-review-gate route loop', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM] ?? '';
    // A single route_loop id remains; the old id must be gone from source + bundle.
    expect(
      /id:\s*code-review-gate\b/.test(content),
      'code-review-gate must be gone from the bundle'
    ).toBe(false);
  });

  it('the v1 baseline gains no reader/route-loop node (proves it was not edited)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, READER_ID), 'v1 must not gain verify-quality-summary').toBeUndefined();
    expect(nodeById(v1, LOOP_ID), 'v1 must not gain quality-route-loop').toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-211 [P1] — CI registration: contract test in the shared (non-mock) batch,
// DAG test as its OWN bun invocation (mock.module isolation) (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test registration — mock isolation preserved (TD-211)', () => {
  it('the route-loop contract test is registered in a shared (non-mock) batch segment', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the contract test must be registered').toContain(
      'v2-quality-route-loop-contract.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-quality-route-loop-contract.test.ts'));
    expect(owning.length, 'exactly one segment must own the contract test').toBe(1);
    expect(
      owning[0].includes('v2-quality-route-loop-dag.test.ts'),
      'the contract test must NOT share a segment with the mock.module DAG test'
    ).toBe(false);
  });

  it('the route-loop DAG test is registered as its OWN standalone bun invocation', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the DAG fixture must be registered').toContain(
      'v2-quality-route-loop-dag.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-quality-route-loop-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the DAG fixture').toBe(1);
    expect(owning[0], 'the DAG fixture must run alone (mock.module is process-global)').toBe(
      'bun test src/defaults/v2-quality-route-loop-dag.test.ts'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-212 [P3] — kebab-case ids/output types; the generated route-loop test files
// carry no plan/story/epic/finding identifiers (only TD-nnn / AC# allowed) (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — kebab-case ids, no plan references (TD-212)', () => {
  it('the new node ids and output type are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const label of [READER_ID, LOOP_ID, 'quality-summary-verified']) {
      expect(kebab.test(label), `${label} must be kebab-case`).toBe(true);
    }
  });

  it('the generated route-loop test files contain no plan/story/epic/finding identifiers', () => {
    const files = ['v2-quality-route-loop-dag.test.ts', 'v2-quality-route-loop-contract.test.ts'];
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
