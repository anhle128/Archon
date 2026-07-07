/**
 * RED-PHASE ACCEPTANCE SCAFFOLD — "Add Gate Planner Flags".
 *
 * Structural / contract assertions against the v2 workflow YAML on disk plus the
 * regenerated bundled defaults. Written BEFORE the delta is implemented. These
 * are EXECUTABLE red tests (not test.skip()) because the boundary already exists:
 * the v2 YAML is parseable today via `parseWorkflow`, and the bundle is importable.
 * They MUST fail now (no `gate-planner` node; `tea-automate` has no `output_format`;
 * `code-review-gate.positive` still points at `tea-rv`; `tea-rv.depends_on` is still
 * `[code-review-gate]`) and pass once the dev adds the node, the TA structured
 * signal, re-parents the DAG, and regenerates the bundle.
 *
 * This file deliberately does NOT use mock.module(). It only parses YAML from disk,
 * imports the generated bundle, and drives the pure condition-evaluator — so it
 * belongs in the same no-mock bun-test batch as v2-cr-auto-contract.test.ts /
 * v2-workflow-baseline.test.ts. Do not co-locate it with a mock.module() file.
 *
 * Behavioral flag/fail-closed proof (INT-001..025) lives in the sibling DAG-harness
 * file v2-gate-planner-dag.test.ts (real bash execution), which DOES use mock.module
 * and runs in its own isolated invocation.
 *
 * Covers (executable red / regression):
 *   A3.1-VAL-001 (loader accepts node + re-parented route ≙ `cli validate workflows`),
 *   A3.1-VAL-002 (v1 baseline has no gate-planner — additivity proxy),
 *   A3.1-VAL-004 (bundle regenerated: contains node + TA output_format),
 *   A3.1-VAL-007 (scope: TEA gates unconditional, flags emitted-but-unconsumed),
 *   A3.1-INT-023 (field-strictness structural half: TA declares every field gate-planner reads),
 *   RC9 comment-policy (no plan-artifact refs leak into shipped YAML),
 *   AC5 first-party consumer boundary (a3.2's `when: $gate-planner.output.run_rv == true`
 *        resolves through the REAL condition-evaluator with JSON-boolean fields).
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isRegisteredProvider, registerBuiltinProviders } from '@archon/providers';
import { parseWorkflow } from '../loader';
import { evaluateCondition } from '../condition-evaluator';
import type { NodeOutput } from '../schemas';
import type { WorkflowDefinition, DagNode } from '../schemas';
import { BUNDLED_WORKFLOWS } from './bundled-defaults';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.archon/workflows/defaults');

const V1_STEM = 'bmad-dev-story-with-tea-fix-loop';
const V2_STEM = 'bmad-dev-story-with-tea-fix-loop-v2';
const V1_FILE = join(WORKFLOWS_DIR, `${V1_STEM}.yml`);
const V2_FILE = join(WORKFLOWS_DIR, `${V2_STEM}.yml`);

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

interface OutputFormat {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
}

// The fields gate-planner reads off $tea-automate.output — every one MUST be
// declared in tea-automate.output_format.properties or the ref throws OutputRefError.
const TA_FIELDS_READ_BY_GATE_PLANNER = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'test_files_changed',
  'nfr_relevant',
];

describe('Gate-planner — v2 YAML structural + bundle + consumer boundary (red)', () => {
  // parseWorkflow validates `provider:` against the registry; v2 uses codex+claude.
  // Register idempotently WITHOUT clearRegistry() — this file shares a process with
  // the no-mock defaults batch; clearing would corrupt sibling tests.
  beforeAll(() => {
    if (!isRegisteredProvider('codex')) {
      try {
        registerBuiltinProviders();
      } catch {
        // Another test in the batch already registered builtins — fine.
      }
    }
  });

  // ── gate-planner node shape (structural support for AC1/AC3) ───────────────
  describe('gate-planner node exists as a deterministic bash node', () => {
    it('A3.1-INT-001-STRUCT [P0] a `gate-planner` node exists and is a bash node (deterministic, no AI)', () => {
      // RED: gate-planner does not exist yet. It must be a bash node so flag
      // computation is reproducible and markdown-free (design Open Q2 / W-02).
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'a gate-planner node must exist').toBeDefined();
      expect('bash' in gp!, 'gate-planner must be a bash node (not command/prompt/AI)').toBe(true);
      // A prompt/command node would introduce nondeterminism — explicitly reject.
      expect('prompt' in gp!, 'gate-planner must not be a prompt node').toBe(false);
      expect('command' in gp!, 'gate-planner must not be a command node').toBe(false);
    });

    it('A3.1-INT-013-STRUCT [P1] gate-planner declares `output_type: gate-decision` and depends on the CR gate', () => {
      // RED: node absent. output_type drives the typed sidecar the DAG harness reads;
      // depends_on:[code-review-gate] guarantees CR/TA/resolve are completed ancestors.
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'gate-planner must exist').toBeDefined();
      expect((gp as unknown as { output_type?: string }).output_type).toBe('gate-decision');
      expect((gp as { depends_on?: string[] }).depends_on).toContain('code-review-gate');
    });

    it('A3.1-INT-024-STRUCT [P3] gate-planner declares a bounded timeout (trivial bash cannot hang)', () => {
      // Documented low risk R-024: a finite timeout guards a pathological hang.
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'gate-planner must exist').toBeDefined();
      const timeout = (gp as unknown as { timeout?: number }).timeout;
      expect(typeof timeout, 'gate-planner must set a numeric timeout').toBe('number');
      expect(timeout).toBeGreaterThan(0);
    });
  });

  // ── tea-automate structured signal (AC1/AC6 enabler; RC8 / R-004) ──────────
  describe('tea-automate surfaces the structured evidence gate-planner consumes', () => {
    it('A3.1-INT-023 [P1] tea-automate.output_format declares EVERY field gate-planner reads (no OutputRefError)', () => {
      // RED: tea-automate currently has `output_type: tea-automation` only — no
      // output_format. Field-access strictness (output-ref.ts:70-77) throws if
      // gate-planner references a field the producer never declared. Declaring all
      // read fields is the fix; a missing one is R-004.
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const ta = nodeById(v2, 'tea-automate');
      expect(ta, 'tea-automate must exist').toBeDefined();
      const of = (ta as unknown as { output_format?: OutputFormat }).output_format;
      expect(of, 'tea-automate must declare an output_format structured signal').toBeDefined();
      for (const field of TA_FIELDS_READ_BY_GATE_PLANNER) {
        expect(of!.properties, `tea-automate must declare field ${field}`).toHaveProperty(field);
        expect(of!.required, `tea-automate field ${field} must be required`).toContain(field);
      }
    });

    it('A3.1-INT-020-STRUCT [P2] `nfr_relevant` is a strict string enum ["true","false"] (enum discipline for run_nr)', () => {
      // RED: field absent. run_nr flips on TA_NFR == "true"; a loose type would let
      // "yes"/"TRUE" leak past the fail-closed check (R-008 self-report flakiness = W-03).
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const ta = nodeById(v2, 'tea-automate');
      const of = (ta as unknown as { output_format?: OutputFormat }).output_format;
      expect(of?.properties?.nfr_relevant?.enum?.slice().sort()).toEqual(['false', 'true']);
    });

    it('tea-automate keeps codex provider (Codex enforces structured output) and its dev-story dependency', () => {
      // Regression: the structured signal must not change tea-automate's provider or
      // wiring — only add output_format + prompt_suffix.
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const ta = nodeById(v2, 'tea-automate');
      expect((ta as { provider?: string }).provider).toBe('codex');
      expect((ta as { depends_on?: string[] }).depends_on).toEqual(['dev-story']);
    });
  });

  // ── DAG re-parenting (Task 3 / AC7 / R-009) ────────────────────────────────
  describe('DAG re-parenting places gate-planner between the CR gate and the TEA gates', () => {
    it('A3.1-VAL-001a [P1] code-review-gate positive route points at `gate-planner` (was `tea-rv`)', () => {
      // RED: positive is currently `tea-rv`. Re-pointing to gate-planner inserts the
      // planner on the CR-passed branch. gate-planner flows forward only, so the
      // route-loop exit-path rule (loader.ts:315-324) still holds (R-009).
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gate = nodeById(v2, 'code-review-gate');
      const routes = (gate as unknown as { route_loop?: { routes?: { positive?: string } } })
        .route_loop?.routes;
      expect(routes?.positive, 'positive route must target gate-planner').toBe('gate-planner');
    });

    it('A3.1-VAL-001b [P1] tea-rv now depends on gate-planner (was code-review-gate)', () => {
      // RED: tea-rv.depends_on is currently [code-review-gate].
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const teaRv = nodeById(v2, 'tea-rv');
      expect((teaRv as { depends_on?: string[] }).depends_on).toEqual(['gate-planner']);
    });

    it('A3.1-VAL-001 [P1] v2 passes loader schema + DAG + route_loop validation (≙ `cli validate workflows …-v2`)', () => {
      // First-party consumer surface: `bun run cli validate workflows
      // bmad-dev-story-with-tea-fix-loop-v2` wraps exactly this loader path (schema,
      // provider identity, dup-id/cycle/$node.output ref, route_loop exit-path).
      // parseWorkflow error===null in-process is the deterministic equivalent.
      // RED while the new node / re-parenting is absent or the TA field refs dangle.
      const content = readLF(V2_FILE);
      expect(content, `expected v2 file to exist: ${V2_FILE}`).not.toBeNull();
      const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
      expect(
        result.error,
        `loader validation must pass: ${result.error?.error ?? 'none'}`
      ).toBeNull();
    });
  });

  // ── Scope boundary (AC scope / R-006 / RC9) ────────────────────────────────
  describe('scope boundary — flags are emitted but MUST stay unconsumed this story', () => {
    it('A3.1-VAL-007a [regression] tea-rv → tea-nr → tea-tr still run UNCONDITIONALLY (no when: added)', () => {
      // Green-now regression guard protecting a3.2. The TEA gates keep their linear
      // unconditional chain; no `when:` conditions are introduced this story.
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      expect((nodeById(v2, 'tea-nr') as { depends_on?: string[] }).depends_on).toEqual(['tea-rv']);
      expect((nodeById(v2, 'tea-tr') as { depends_on?: string[] }).depends_on).toEqual(['tea-nr']);
      for (const id of ['tea-rv', 'tea-nr', 'tea-tr']) {
        const n = nodeById(v2, id) as unknown as { when?: string };
        expect(n?.when, `${id} must NOT gain a when: condition this story`).toBeUndefined();
      }
    });

    it('A3.1-VAL-007b [regression] NO node declares a `when:` on $gate-planner.output (a3.2 owns consumption)', () => {
      // Scope-creep tripwire (R-006): the whole raw YAML must not reference
      // $gate-planner.output in any when:/branch. Emitted-but-unconsumed is the contract.
      const content = readLF(V2_FILE);
      expect(content, `expected v2 file to exist: ${V2_FILE}`).not.toBeNull();
      expect(
        content as string,
        'no node may consume $gate-planner.output this story — that belongs to a3.2'
      ).not.toContain('$gate-planner.output');
    });
  });

  // ── v1 baseline additivity (AC7 / R-005) ───────────────────────────────────
  describe('v1 baseline additivity — the delta must not leak into the release baseline', () => {
    it('A3.1-VAL-002 [P0] v1 baseline has NO gate-planner node and keeps its original structure', () => {
      // In-process proxy for the byte-for-byte v1 immutability git-diff gate. The
      // real byte-equality check runs in CI (see WAIVER: VAL-002-GITDIFF). Here we
      // assert the baseline never grew the new node.
      const v1 = parseFromDisk(V1_FILE, V1_STEM);
      expect(
        nodeById(v1, 'gate-planner'),
        'baseline must not contain gate-planner'
      ).toBeUndefined();
      expect(
        nodeById(v1, 'code-review'),
        'baseline retains its original code-review node'
      ).toBeDefined();
      const v1Raw = readLF(V1_FILE);
      expect(v1Raw as string, 'v1 baseline must not mention gate-planner at all').not.toContain(
        'gate-planner'
      );
    });
  });

  // ── Bundle regeneration (AC7 / R-005) ──────────────────────────────────────
  describe('bundled defaults regenerated (guards "forgot to run generate:bundled")', () => {
    it('A3.1-VAL-004 [P1] BUNDLED_WORKFLOWS v2 contains the gate-planner node + tea-automate structured signal', () => {
      // RED: bundle predates the delta. `bun run generate:bundled` must be run so
      // the embedded copy matches disk; `check:bundled` (CI) enforces byte-equality.
      const bundled = BUNDLED_WORKFLOWS[V2_STEM];
      expect(bundled, 'v2 workflow must be present in the bundle').toBeDefined();
      expect(bundled, 'bundle must include the gate-planner node').toContain('gate-planner');
      expect(bundled, 'bundle must include the tea-automate nfr_relevant signal').toContain(
        'nfr_relevant'
      );
    });
  });

  // ── Code-comment policy (RC9 / project rule) ───────────────────────────────
  describe('reviewer concern — shipped YAML carries no plan-artifact references', () => {
    it('CONCERN-RC9 [P1] v2 YAML has no story/epic/requirement/finding codes in comments or ids', () => {
      // Repo rule: comments explain the invariant (why), never the plan label. Locks
      // the new gate-planner comment + node id against leakage of a3.1 / A-FR / A-AD codes.
      const content = readLF(V2_FILE);
      expect(content, `expected v2 file to exist: ${V2_FILE}`).not.toBeNull();
      const forbidden = [
        /\bA-FR-\d/i,
        /\bA-AD-\d/i,
        /\ba3\.\d/i,
        /\bepic\s+a\d/i,
        /\bstory\s+a3/i,
        /\bR-0\d{2}\b/,
        /\bF\d{1,2}\b/,
      ];
      for (const pattern of forbidden) {
        expect(content as string, `forbidden plan reference ${pattern}`).not.toMatch(pattern);
      }
    });
  });

  // ── First-party CONSUMER boundary (AC5 — the a3.2 unblocker, at the seam a3.2 uses) ──
  describe('AC5 consumer contract — a3.2 branch conditions resolve through the real condition-evaluator', () => {
    // a3.2 will write `when: $gate-planner.output.run_rv == true`. That comparison
    // is evaluated by evaluateCondition against the node's JSON output. This proves
    // the CONSUMER seam works with REAL JSON booleans — the reason string booleans
    // MUST NOT be quoted, or the unquoted-boolean RHS match silently never fires (R-002).
    const makeCompletedOutput = (jsonStdout: string): NodeOutput => ({
      state: 'completed',
      output: jsonStdout,
    });

    it('A3.1-INT-015-CONSUMER [P0] JSON-boolean run_rv=true → a3.2 `when: … == true` FIRES', () => {
      // A representative contract shape gate-planner MUST emit (real JSON booleans).
      // If the dev ships `"run_rv":"true"` (string), this assertion fails — exactly
      // the silent-skip bug a3.2 would otherwise inherit.
      const emitted = JSON.stringify({
        contract_version: '1.0',
        workflow: V2_STEM,
        node: 'gate-planner',
        story_ref: 'a1-2-example',
        run_rv: true,
        run_nr: true,
        run_tr: true,
        reason_rv: 'Automation produced 3 changed test files; run test-review.',
        reason_nr: 'Implementation touches NFR-sensitive paths.',
        reason_tr: 'Traceability review is the default final release gate.',
      });
      const outputs = new Map<string, NodeOutput>([['gate-planner', makeCompletedOutput(emitted)]]);
      expect(evaluateCondition('$gate-planner.output.run_rv == true', outputs).result).toBe(true);
      expect(evaluateCondition('$gate-planner.output.run_nr == true', outputs).result).toBe(true);
      expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs).result).toBe(true);
    });

    it('A3.1-INT-015-CONSUMER-FALSE [P0] JSON-boolean run_rv=false → a3.2 `when: … == true` does NOT fire; `== false` DOES', () => {
      const emitted = JSON.stringify({
        contract_version: '1.0',
        workflow: V2_STEM,
        node: 'gate-planner',
        story_ref: 'a1-2-example',
        run_rv: false,
        run_nr: false,
        run_tr: true,
        reason_rv: 'No test files changed; test-review is not applicable.',
        reason_nr: 'No NFR-sensitive paths touched.',
        reason_tr: 'Traceability review is the default final release gate.',
      });
      const outputs = new Map<string, NodeOutput>([['gate-planner', makeCompletedOutput(emitted)]]);
      expect(evaluateCondition('$gate-planner.output.run_rv == true', outputs).result).toBe(false);
      expect(evaluateCondition('$gate-planner.output.run_rv == false', outputs).result).toBe(true);
      // run_tr defaults true even in the false-case (AC4).
      expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs).result).toBe(true);
    });

    it('A3.1-INT-015-COERCION-NOTE [P0] the condition-evaluator string-coerces both sides — so `typeof boolean` on the EMITTED JSON is the real AC5 guard (see File B INT-015)', () => {
      // VERIFIED behavior (condition-evaluator.ts:262 `actual === expected`, both
      // coerced to strings): a JSON string "true" and a JSON boolean true BOTH satisfy
      // `== true`. That means the stated R-002 failure mode ("string booleans make the
      // when: never match → silent skip forever") does NOT reproduce at THIS seam.
      // Consequence for the scaffold: the a3.2 `when:` match alone cannot detect a
      // string-boolean regression. AC5 ("real JSON booleans") is therefore enforced by
      // asserting `typeof === 'boolean'` on gate-planner's EMITTED stdout — see
      // v2-gate-planner-dag.test.ts INT-015/016/017 — NOT by a condition-match probe.
      const asBoolean = new Map<string, NodeOutput>([
        ['gate-planner', makeCompletedOutput(JSON.stringify({ run_rv: true }))],
      ]);
      const asString = new Map<string, NodeOutput>([
        ['gate-planner', makeCompletedOutput(JSON.stringify({ run_rv: 'true' }))],
      ]);
      // Both fire — documenting that the match is coercion-based and cannot be the guard.
      expect(evaluateCondition('$gate-planner.output.run_rv == true', asBoolean).result).toBe(true);
      expect(evaluateCondition('$gate-planner.output.run_rv == true', asString).result).toBe(true);
    });
  });
});
