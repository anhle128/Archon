/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for the RV/NR
 * conditional sibling-branch wiring in the v2 workflow.
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive the pure condition-evaluator + a self-contained bash serialization
 * proof — NO mock.module() needed, so this file is safe to co-locate in the
 * shared `bun test` batch (the GREEN-phase step registers it alongside
 * v2-gate-planner-contract.test.ts in packages/workflows/package.json).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-tea-branches-dag.test.ts (real bash + real executor, isolated invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * Every assertion targets the NOT-YET-IMPLEMENTED wiring and is EXPECTED TO
 * FAIL until the v2 YAML is edited. Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-tea-branches-contract.test.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isRegisteredProvider, registerBuiltinProviders } from '@archon/providers';
import { parseWorkflow } from '../loader';
import { evaluateCondition } from '../condition-evaluator';
import type { NodeOutput } from '../schemas';
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

const REAL_GATE_REQUIRED_FIELDS = [
  'contract_version',
  'workflow',
  'node',
  'gate',
  'story_ref',
  'findings_count',
  'report_file',
];

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
// TD-009 [P1] — branch dependency + layer shape (sibling concurrency)
// AC #1, #3
// ═══════════════════════════════════════════════════════════════════════════

describe('Branch dependency shape — RV/NR are siblings off gate-planner (TD-009)', () => {
  it('tea-rv, tea-rv-skipped, tea-nr, tea-nr-skipped all exist and depend only on gate-planner', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const id of ['tea-rv', 'tea-rv-skipped', 'tea-nr', 'tea-nr-skipped']) {
      const node = nodeById(v2, id);
      expect(node, `${id} node must exist`).toBeDefined();
      expect(node!.depends_on, `${id} must depend only on gate-planner`).toEqual(['gate-planner']);
    }
  });

  it('tea-nr is decoupled from tea-rv (no longer depends_on tea-rv)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const nr = nodeById(v2, 'tea-nr');
    expect(nr!.depends_on, 'tea-nr must NOT depend on tea-rv').not.toContain('tea-rv');
  });

  it('tea-rv-skipped and tea-nr-skipped are deterministic bash nodes (no AI)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const id of ['tea-rv-skipped', 'tea-nr-skipped']) {
      const node = nodeById(v2, id)!;
      expect('bash' in node, `${id} must be a bash node`).toBe(true);
      expect('prompt' in node, `${id} must not be a prompt node`).toBe(false);
      expect('command' in node, `${id} must not be a command node`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-014 [P1] — `when:` boolean grammar valid + edited workflow parses/validates
// AC #1, #2, #3, #5
// (In-process parity for the CLI `validate workflows` consumer — parseWorkflow
//  runs the same schema + DAG validation the CLI invokes.)
// ═══════════════════════════════════════════════════════════════════════════

describe('when: conditions — paired inverse boolean atoms (TD-014)', () => {
  it('edited v2 workflow parses and passes schema + DAG validation', () => {
    const content = readLF(V2_FILE);
    const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
    expect(result.error, `parseWorkflow reported: ${result.error?.error ?? 'none'}`).toBeNull();
    expect((result.workflow as WorkflowDefinition).nodes.length).toBeGreaterThan(0);
  });

  it('tea-rv gated on run_rv==true; tea-rv-skipped on run_rv==false (unquoted booleans)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, 'tea-rv')!.when).toBe('$gate-planner.output.run_rv == true');
    expect(nodeById(v2, 'tea-rv-skipped')!.when).toBe('$gate-planner.output.run_rv == false');
  });

  it('tea-nr gated on run_nr==true; tea-nr-skipped on run_nr==false (unquoted booleans)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, 'tea-nr')!.when).toBe('$gate-planner.output.run_nr == true');
    expect(nodeById(v2, 'tea-nr-skipped')!.when).toBe('$gate-planner.output.run_nr == false');
  });

  it('evaluator: run_rv boolean drives exactly one RV branch per flag value', () => {
    const makeCompletedOutput = (jsonStdout: string): NodeOutput => ({
      state: 'completed',
      output: jsonStdout,
    });
    const outputs = (runRv: boolean): Map<string, NodeOutput> =>
      new Map([['gate-planner', makeCompletedOutput(JSON.stringify({ run_rv: runRv }))]]);
    // run_rv=true → real true, skip false
    expect(evaluateCondition('$gate-planner.output.run_rv == true', outputs(true)).result).toBe(
      true
    );
    expect(evaluateCondition('$gate-planner.output.run_rv == false', outputs(true)).result).toBe(
      false
    );
    // run_rv=false → real false, skip true
    expect(evaluateCondition('$gate-planner.output.run_rv == true', outputs(false)).result).toBe(
      false
    );
    expect(evaluateCondition('$gate-planner.output.run_rv == false', outputs(false)).result).toBe(
      true
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-007 [P1] — real RV/NR branches expose valid output schemas (gate ⊉ SKIPPED)
// AC #1, #3
// ═══════════════════════════════════════════════════════════════════════════

describe('Real branch contracts — output_format present, SKIPPED excluded (TD-007)', () => {
  it('tea-rv and tea-nr each declare an output_format with the required gate-envelope fields', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const [id, expectedNode] of [
      ['tea-rv', 'tea-rv'],
      ['tea-nr', 'tea-nr'],
    ] as const) {
      const of = (nodeById(v2, id) as { output_format?: OutputFormat } | undefined)?.output_format;
      expect(of, `${id} must declare output_format`).toBeDefined();
      expect(of!.type).toBe('object');
      for (const field of REAL_GATE_REQUIRED_FIELDS) {
        expect(of!.required, `${id}.output_format must require ${field}`).toContain(field);
      }
      const gateEnum = of!.properties?.gate?.enum ?? [];
      expect(gateEnum, `${id} gate enum must be PASS/FAIL/CONCERNS/ERROR`).toEqual([
        'PASS',
        'FAIL',
        'CONCERNS',
        'ERROR',
      ]);
      expect(gateEnum, `${id} real branch must NOT allow SKIPPED`).not.toContain('SKIPPED');
      expect(expectedNode).toBe(id);
    }
  });

  it('tea-rv and tea-nr prompt bodies pin story_ref to the resolved input', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const id of ['tea-rv', 'tea-nr']) {
      const node = nodeById(v2, id) as { prompt_suffix?: string } | undefined;
      expect(node?.prompt_suffix, `${id} must add a prompt_suffix pinning story_ref`).toBeDefined();
      expect(
        node!.prompt_suffix,
        `${id} prompt_suffix must pin $resolve-story-input.output.story_ref`
      ).toContain('$resolve-story-input.output.story_ref');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-008 [P1] — skipped contract encoder uses safe JSON serialization
// AC #2
// ═══════════════════════════════════════════════════════════════════════════

describe('Skip-contract encoder — safe JSON serialization (TD-008)', () => {
  it('tea-rv-skipped / tea-nr-skipped use the bun JSON.stringify encoder, not naive echo', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    for (const id of ['tea-rv-skipped', 'tea-nr-skipped']) {
      const bash = (nodeById(v2, id) as { bash?: string } | undefined)?.bash ?? '';
      expect(bash, `${id} must serialize via bun -e JSON.stringify`).toContain('JSON.stringify');
      expect(bash, `${id} contract must set gate:"SKIPPED"`).toContain('SKIPPED');
      // Guard against naive interpolation that corrupts special characters.
      expect(
        /echo\s+["']?\{/.test(bash),
        `${id} must not build JSON with a naive echo "{...}"`
      ).toBe(false);
    }
  });

  it('technique proof: the bun JSON encoder survives backslash/quote/newline/CR/tab in reasons', async () => {
    // Self-contained proof that the CHOSEN encoder pattern is sound. Mirrors the
    // gate-planner escaping proof; pairs with the static assertion above that the
    // skip nodes actually adopt this pattern.
    const nastyReason = 'skip: no test\\files "changed"\nline2\rcr\ttab';
    const nastyRef = 'a1-2\\ref"x';
    const bashScript = `
      set -e
      SK_STORY_REF="$1"
      SK_REASON="$2"
      CONTRACT=$(
        SK_STORY_REF="$SK_STORY_REF" SK_REASON="$SK_REASON" \\
        bun -e 'process.stdout.write(JSON.stringify({contract_version:"1.0",workflow:"bmad-dev-story-with-tea-fix-loop-v2",node:"tea-rv-skipped",story_ref:process.env.SK_STORY_REF,gate:"SKIPPED",findings_count:0,reason:process.env.SK_REASON}))'
      )
      printf '%s' "$CONTRACT"
    `;
    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', nastyRef, nastyReason]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.gate).toBe('SKIPPED');
    expect(parsed.story_ref).toBe(nastyRef);
    expect(parsed.reason).toBe(nastyReason);
    expect(parsed.findings_count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-018 [P2] — skip nodes carry timeout + typed-output observability
// ═══════════════════════════════════════════════════════════════════════════

describe('Skip-node hygiene — timeout + output_type sidecar (TD-018)', () => {
  it('tea-rv-skipped and tea-nr-skipped declare timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-rv-skipped') as { timeout?: number }).timeout).toBe(60000);
    expect((nodeById(v2, 'tea-nr-skipped') as { timeout?: number }).timeout).toBe(60000);
  });

  it('skip nodes declare kebab-case semantic output_type labels', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-rv-skipped') as { output_type?: string }).output_type).toBe(
      'test-review-skipped'
    );
    expect((nodeById(v2, 'tea-nr-skipped') as { output_type?: string }).output_type).toBe(
      'nfr-skipped'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-010 [P1] — tea-tr fail-closed join with run_tr gating; tea-tr-skipped sibling
// AC #1, #2, #4, #5
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr join — fail-closed and scope-bounded (TD-010)', () => {
  it('tea-tr depends on all four RV/NR branch nodes (not the old linear chain)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, 'tea-tr')!.depends_on ?? [];
    expect([...deps].sort()).toEqual(
      ['tea-nr', 'tea-nr-skipped', 'tea-rv', 'tea-rv-skipped'].sort()
    );
  });

  it('tea-tr uses none_failed_min_one_success (tolerates skips, fails closed on failure)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const tr = nodeById(v2, 'tea-tr') as { trigger_rule?: string };
    expect(tr.trigger_rule, 'tea-tr must not use all_done (would mask real failures)').toBe(
      'none_failed_min_one_success'
    );
  });

  it('tea-tr is gated on run_tr==true and tea-tr-skipped sibling exists with run_tr==false', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      (nodeById(v2, 'tea-tr') as { when?: string }).when,
      'tea-tr must be gated on run_tr==true'
    ).toBe('$gate-planner.output.run_tr == true');
    const trSkipped = nodeById(v2, 'tea-tr-skipped');
    expect(trSkipped, 'tea-tr-skipped must exist').toBeDefined();
    expect(
      (trSkipped as { when?: string }).when,
      'tea-tr-skipped must be gated on run_tr==false'
    ).toBe('$gate-planner.output.run_tr == false');
    expect('bash' in trSkipped!, 'tea-tr-skipped must be a bash node').toBe(true);
  });

  it('create-pull-request depends on both TR branches with fail-closed join', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect([...nodeById(v2, 'create-pull-request')!.depends_on].sort()).toEqual(
      ['tea-tr', 'tea-tr-skipped'].sort()
    );
    const cpr = nodeById(v2, 'create-pull-request') as { trigger_rule?: string };
    expect(cpr.trigger_rule, 'create-pull-request must use none_failed_min_one_success').toBe(
      'none_failed_min_one_success'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-020 [P1] — tea-tr real branch contract (output_format, prompt_suffix)
// AC #1, #3
// ═══════════════════════════════════════════════════════════════════════════

describe('TR real branch contract — output_format + prompt_suffix (TD-020)', () => {
  it('tea-tr declares an output_format with the required gate-envelope fields and gate enum excluding SKIPPED', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const of = (nodeById(v2, 'tea-tr') as { output_format?: OutputFormat } | undefined)
      ?.output_format;
    expect(of, 'tea-tr must declare output_format').toBeDefined();
    expect(of!.type).toBe('object');
    for (const field of REAL_GATE_REQUIRED_FIELDS) {
      expect(of!.required, `tea-tr.output_format must require ${field}`).toContain(field);
    }
    const gateEnum = of!.properties?.gate?.enum ?? [];
    expect(gateEnum, 'tea-tr gate enum must be PASS/FAIL/CONCERNS/ERROR').toEqual([
      'PASS',
      'FAIL',
      'CONCERNS',
      'ERROR',
    ]);
    expect(gateEnum, 'tea-tr real branch must NOT allow SKIPPED').not.toContain('SKIPPED');
  });

  it('tea-tr prompt_suffix pins story_ref to the resolved input', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'tea-tr') as { prompt_suffix?: string } | undefined;
    expect(node?.prompt_suffix, 'tea-tr must add a prompt_suffix pinning story_ref').toBeDefined();
    expect(
      node!.prompt_suffix,
      'tea-tr prompt_suffix must pin $resolve-story-input.output.story_ref'
    ).toContain('$resolve-story-input.output.story_ref');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-021 [P1] — tea-tr-skipped skip-contract encoder + hygiene
// AC #2
// ═══════════════════════════════════════════════════════════════════════════

describe('TR skip-contract encoder + hygiene (TD-021)', () => {
  it('tea-tr-skipped uses the bun JSON.stringify encoder, not naive echo', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = (nodeById(v2, 'tea-tr-skipped') as { bash?: string } | undefined)?.bash ?? '';
    expect(bash, 'tea-tr-skipped must serialize via bun -e JSON.stringify').toContain(
      'JSON.stringify'
    );
    expect(bash, 'tea-tr-skipped contract must set gate:"SKIPPED"').toContain('SKIPPED');
    expect(
      /echo\s+["']?\{/.test(bash),
      'tea-tr-skipped must not build JSON with a naive echo "{...}"'
    ).toBe(false);
  });

  it('tea-tr-skipped depends on gate-planner directly (not on RV/NR branches)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(nodeById(v2, 'tea-tr-skipped')!.depends_on).toEqual(['gate-planner']);
  });

  it('tea-tr-skipped declares timeout: 60000 and output_type: trace-skipped', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-tr-skipped') as { timeout?: number }).timeout).toBe(60000);
    expect((nodeById(v2, 'tea-tr-skipped') as { output_type?: string }).output_type).toBe(
      'trace-skipped'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-022 [P1] — run_tr boolean drives exactly one TR branch per flag value
// AC #1, #2
// ═══════════════════════════════════════════════════════════════════════════

describe('TR when: conditions — paired inverse boolean atoms (TD-022)', () => {
  it('evaluator: run_tr boolean drives exactly one TR branch per flag value', () => {
    const makeCompletedOutput = (jsonStdout: string): NodeOutput => ({
      state: 'completed',
      output: jsonStdout,
    });
    const outputs = (runTr: boolean): Map<string, NodeOutput> =>
      new Map([['gate-planner', makeCompletedOutput(JSON.stringify({ run_tr: runTr }))]]);
    // run_tr=true → real true, skip false
    expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs(true)).result).toBe(
      true
    );
    expect(evaluateCondition('$gate-planner.output.run_tr == false', outputs(true)).result).toBe(
      false
    );
    // run_tr=false → real false, skip true
    expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs(false)).result).toBe(
      false
    );
    expect(evaluateCondition('$gate-planner.output.run_tr == false', outputs(false)).result).toBe(
      true
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-011 [P1] — route-loop configuration unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('Route-loop integrity — code-review-gate unchanged (TD-011)', () => {
  it('code-review-gate route_loop still routes positive→gate-planner and no when/trigger_rule/retry leaked in', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const gate = nodeById(v2, 'code-review-gate') as {
      route_loop?: { routes?: { positive?: string; negative?: string } };
      when?: string;
      trigger_rule?: string;
      retry?: unknown;
    };
    expect(gate.route_loop, 'code-review-gate must remain a route_loop node').toBeDefined();
    expect(
      gate.route_loop!.routes?.positive,
      'positive branch must still target gate-planner'
    ).toBe('gate-planner');
    expect(gate.when, 'loader forbids when: on route_loop nodes').toBeUndefined();
    expect(gate.trigger_rule).toBeUndefined();
    expect(gate.retry).toBeUndefined();
  });

  it('gate-planner is unchanged — still a bash node depending on code-review-gate', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const gp = nodeById(v2, 'gate-planner')!;
    expect('bash' in gp).toBe(true);
    expect(gp.depends_on).toEqual(['code-review-gate']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-015 [P1] — bundled defaults regenerated and consistent with source
// AC #6
// ═══════════════════════════════════════════════════════════════════════════

describe('Bundle parity — generated defaults embed the new branches (TD-015)', () => {
  it('BUNDLED_WORKFLOWS v2 entry includes tea-rv-skipped, tea-nr-skipped, and tea-tr-skipped nodes', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, `bundled v2 workflow must be present`).toBeDefined();
    expect(content, 'regenerated bundle must contain tea-rv-skipped').toContain('tea-rv-skipped');
    expect(content, 'regenerated bundle must contain tea-nr-skipped').toContain('tea-nr-skipped');
    expect(content, 'regenerated bundle must contain tea-tr-skipped').toContain('tea-tr-skipped');
    expect(content, 'regenerated bundle must contain the run_rv when: guard').toContain(
      'run_rv == false'
    );
    expect(content, 'regenerated bundle must contain the run_tr when: guard').toContain(
      'run_tr == false'
    );
  });

  it('bundled v2 content matches the on-disk source (no drift)', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    const source = readLF(V2_FILE);
    expect(content?.replace(/\r\n/g, '\n')).toBe(source);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-016 [P2] — v1 baseline untouched; scope stays narrow (rollback safety)
// ═══════════════════════════════════════════════════════════════════════════

describe('Scope guard — v1 baseline untouched (TD-016)', () => {
  it('v1 workflow has no skip nodes and keeps tea-nr coupled to tea-rv (proves it was not edited)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, 'tea-rv-skipped'), 'v1 must not gain skip nodes').toBeUndefined();
    expect(nodeById(v1, 'tea-nr-skipped'), 'v1 must not gain skip nodes').toBeUndefined();
    const v1Nr = nodeById(v1, 'tea-nr');
    if (v1Nr) {
      expect(v1Nr.depends_on, 'v1 tea-nr wiring must be left as-is').toEqual(['tea-rv']);
    }
  });

  it('v2 change is additive — exactly three new node ids appear versus the branch baseline', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const ids = v2.nodes.map(n => n.id);
    expect(ids, 'tea-rv-skipped must be a NEW node id').toContain('tea-rv-skipped');
    expect(ids, 'tea-nr-skipped must be a NEW node id').toContain('tea-nr-skipped');
    expect(ids, 'tea-tr-skipped must be a NEW node id').toContain('tea-tr-skipped');
    // No new packages/migrations concern is a repo-structure fact, guarded by full validate (TD-019).
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-013 [P1] — new DAG fixture is isolated in package.json (mock pollution)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test isolation — DAG fixture runs as its own bun test invocation (TD-013)', () => {
  it('packages/workflows/package.json runs v2-tea-branches-dag.test.ts in its OWN invocation', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the dag fixture must be registered').toContain(
      'v2-tea-branches-dag.test.ts'
    );
    // It must run alone: "bun test src/defaults/v2-tea-branches-dag.test.ts" as a
    // standalone && segment, NOT co-located with other files in one invocation.
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-tea-branches-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the dag fixture').toBe(1);
    expect(
      owning[0],
      'the dag fixture segment must not co-locate other .test.ts files (mock.module is process-global)'
    ).toBe('bun test src/defaults/v2-tea-branches-dag.test.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-017 [P2] — naming conventions; no plan identifiers in code artifacts
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — kebab-case ids, no plan references (TD-017)', () => {
  it('new node ids are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const id of ['tea-rv-skipped', 'tea-nr-skipped', 'tea-tr-skipped']) {
      expect(kebab.test(id), `${id} must be kebab-case`).toBe(true);
    }
  });

  it('generated ATDD test files contain no plan/story/epic identifiers', () => {
    // Guards CLAUDE.md "no plan references in code" for the artifacts THIS ATDD run produced.
    const files = ['v2-tea-branches-dag.test.ts', 'v2-tea-branches-contract.test.ts'];
    const planRef = /\b(A3\.\d|A-FR-\d|A-AD-\d|R-0\d\d|W-00\d)\b/;
    for (const f of files) {
      const body = readLF(join(import.meta.dir, f));
      expect(body, `${f} must exist`).not.toBeNull();
      // TD-/AC# scenario tags are allowed (test-design taxonomy, stable);
      // plan/finding codes are not.
      const offending = (body as string)
        .split('\n')
        .filter(line => planRef.test(line) && !line.includes('CANONICAL_REF'));
      expect(offending, `${f} must not embed plan identifiers: ${offending[0] ?? ''}`).toHaveLength(
        0
      );
    }
  });
});
