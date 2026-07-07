/**
 * Structural / contract assertions against the v2 workflow YAML on disk plus the
 * regenerated bundled defaults. These tests parse the YAML, import the bundle,
 * and drive the pure condition-evaluator — no mock.module() needed.
 *
 * Behavioral flag/fail-closed proof lives in the sibling DAG-harness file
 * v2-gate-planner-dag.test.ts (real bash execution), which DOES use mock.module
 * and runs in its own isolated invocation.
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

const TA_FIELDS_READ_BY_GATE_PLANNER = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'test_files_changed',
  'nfr_relevant',
];

describe('Gate-planner — v2 YAML structural + bundle + consumer boundary', () => {
  beforeAll(() => {
    if (!isRegisteredProvider('codex')) {
      try {
        registerBuiltinProviders();
      } catch {
        // Another test in the batch already registered builtins — fine.
      }
    }
  });

  describe('gate-planner node exists as a deterministic bash node', () => {
    it('gate-planner node exists and is a bash node (deterministic, no AI)', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'a gate-planner node must exist').toBeDefined();
      expect('bash' in gp!, 'gate-planner must be a bash node (not command/prompt/AI)').toBe(true);
      expect('prompt' in gp!, 'gate-planner must not be a prompt node').toBe(false);
      expect('command' in gp!, 'gate-planner must not be a command node').toBe(false);
    });

    it('gate-planner declares gate-decision output type and depends on the CR gate', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'gate-planner must exist').toBeDefined();
      expect((gp as unknown as { output_type?: string }).output_type).toBe('gate-decision');
      expect((gp as { depends_on?: string[] }).depends_on).toContain('code-review-gate');
    });

    it('gate-planner declares a bounded timeout', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gp = nodeById(v2, 'gate-planner');
      expect(gp, 'gate-planner must exist').toBeDefined();
      const timeout = (gp as unknown as { timeout?: number }).timeout;
      expect(typeof timeout, 'gate-planner must set a numeric timeout').toBe('number');
      expect(timeout).toBeGreaterThan(0);
    });
  });

  describe('tea-automate surfaces the structured evidence gate-planner consumes', () => {
    it('tea-automate output_format declares every field gate-planner reads', () => {
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

    it('nfr_relevant is a strict string enum ["true","false"] for deterministic run_nr', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const ta = nodeById(v2, 'tea-automate');
      const of = (ta as unknown as { output_format?: OutputFormat }).output_format;
      expect(of?.properties?.nfr_relevant?.enum?.slice().sort()).toEqual(['false', 'true']);
    });

    it('tea-automate keeps codex provider and its dev-story dependency', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const ta = nodeById(v2, 'tea-automate');
      expect((ta as { provider?: string }).provider).toBe('codex');
      expect((ta as { depends_on?: string[] }).depends_on).toEqual(['dev-story']);
    });
  });

  describe('DAG re-parenting places gate-planner between the CR gate and the TEA gates', () => {
    it('code-review-gate positive route points at gate-planner', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const gate = nodeById(v2, 'code-review-gate');
      const routes = (gate as unknown as { route_loop?: { routes?: { positive?: string } } })
        .route_loop?.routes;
      expect(routes?.positive, 'positive route must target gate-planner').toBe('gate-planner');
    });

    it('tea-rv depends on gate-planner', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const teaRv = nodeById(v2, 'tea-rv');
      expect((teaRv as { depends_on?: string[] }).depends_on).toEqual(['gate-planner']);
    });

    it('v2 passes loader schema + DAG + route_loop validation', () => {
      const content = readLF(V2_FILE);
      expect(content, `expected v2 file to exist: ${V2_FILE}`).not.toBeNull();
      const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
      expect(
        result.error,
        `loader validation must pass: ${result.error?.error ?? 'none'}`
      ).toBeNull();
    });
  });

  describe('scope boundary — gate-planner flags consumed by conditional branches', () => {
    it('tea-rv and tea-nr are conditional siblings gated on gate-planner flags', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      expect((nodeById(v2, 'tea-rv') as unknown as { when?: string }).when).toBe(
        '$gate-planner.output.run_rv == true'
      );
      expect((nodeById(v2, 'tea-nr') as unknown as { when?: string }).when).toBe(
        '$gate-planner.output.run_nr == true'
      );
      expect((nodeById(v2, 'tea-rv') as { depends_on?: string[] }).depends_on).toEqual([
        'gate-planner',
      ]);
      expect((nodeById(v2, 'tea-nr') as { depends_on?: string[] }).depends_on).toEqual([
        'gate-planner',
      ]);
    });

    it('tea-rv-skipped and tea-nr-skipped are inverse-condition bash siblings', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      expect((nodeById(v2, 'tea-rv-skipped') as unknown as { when?: string }).when).toBe(
        '$gate-planner.output.run_rv == false'
      );
      expect((nodeById(v2, 'tea-nr-skipped') as unknown as { when?: string }).when).toBe(
        '$gate-planner.output.run_nr == false'
      );
    });

    it('tea-tr joins the four branch nodes with none_failed_min_one_success', () => {
      const v2 = parseFromDisk(V2_FILE, V2_STEM);
      const tr = nodeById(v2, 'tea-tr') as {
        depends_on?: string[];
        trigger_rule?: string;
      };
      expect([...(tr.depends_on ?? [])].sort()).toEqual(
        ['tea-nr', 'tea-nr-skipped', 'tea-rv', 'tea-rv-skipped'].sort()
      );
      expect(tr.trigger_rule).toBe('none_failed_min_one_success');
    });
  });

  describe('v1 baseline additivity — the delta must not leak into the release baseline', () => {
    it('v1 baseline has no gate-planner node and keeps its original structure', () => {
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

  describe('bundled defaults regenerated', () => {
    it('bundled v2 contains the gate-planner node and tea-automate structured signal', () => {
      const bundled = BUNDLED_WORKFLOWS[V2_STEM];
      expect(bundled, 'v2 workflow must be present in the bundle').toBeDefined();
      expect(bundled, 'bundle must include the gate-planner node').toContain('gate-planner');
      expect(bundled, 'bundle must include the tea-automate nfr_relevant signal').toContain(
        'nfr_relevant'
      );
    });
  });

  describe('shipped YAML carries no plan-artifact references in comments or ids', () => {
    it('v2 YAML has no story/epic/requirement/finding codes in comments or ids', () => {
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

  describe('consumer contract — branch conditions resolve through the real condition-evaluator', () => {
    const makeCompletedOutput = (jsonStdout: string): NodeOutput => ({
      state: 'completed',
      output: jsonStdout,
    });

    it('JSON-boolean run_rv=true makes a == true branch condition fire', () => {
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

    it('JSON-boolean run_rv=false makes == true NOT fire; == false DOES fire', () => {
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
      expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs).result).toBe(true);
    });

    it('condition-evaluator string-coerces both sides — typeof boolean on emitted JSON is the real guard', () => {
      const asBoolean = new Map<string, NodeOutput>([
        ['gate-planner', makeCompletedOutput(JSON.stringify({ run_rv: true }))],
      ]);
      const asString = new Map<string, NodeOutput>([
        ['gate-planner', makeCompletedOutput(JSON.stringify({ run_rv: 'true' }))],
      ]);
      expect(evaluateCondition('$gate-planner.output.run_rv == true', asBoolean).result).toBe(true);
      expect(evaluateCondition('$gate-planner.output.run_rv == true', asString).result).toBe(true);
    });
  });
});
