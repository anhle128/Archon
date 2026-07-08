/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for wiring
 * `tea-tr` as the joined final release gate plus its `tea-tr-skipped` sibling.
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive the pure condition-evaluator + a self-contained bash serialization
 * proof — NO mock.module() needed, so this file is safe to co-locate in the
 * shared `bun test` batch (the GREEN-phase step registers it alongside
 * v2-tea-branches-contract.test.ts in packages/workflows/package.json).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-tr-join-dag.test.ts (real bash + real executor, isolated invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * Every assertion targets the NOT-YET-IMPLEMENTED wiring and is EXPECTED TO
 * FAIL until the v2 YAML is edited to:
 *   1. gate `tea-tr` on `when: "$gate-planner.output.run_tr == true"`,
 *   2. give `tea-tr` an output_format gate envelope (SKIPPED excluded) and a
 *      prompt_suffix pinning story_ref,
 *   3. add a `tea-tr-skipped` bash sibling (`when: "... run_tr == false"`,
 *      depends_on: [gate-planner]) emitting a gate:"SKIPPED" contract, and
 *   4. rewire `create-pull-request` to depends_on: [tea-tr, tea-tr-skipped]
 *      with trigger_rule: none_failed_min_one_success.
 * Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-tr-join-contract.test.ts
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

// Route-facing gate envelope every REAL branch (RV/NR/TR) must require. The
// real TR gate intentionally excludes SKIPPED — only the skip node emits it.
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
// TD-020 [P0] — tea-tr gated by run_tr == true (AC #1, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr run_tr gate — real TR runs only when run_tr==true (TD-020)', () => {
  it('tea-tr declares when: "$gate-planner.output.run_tr == true" (unquoted boolean)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      (nodeById(v2, 'tea-tr') as { when?: string }).when,
      'tea-tr must be gated on run_tr == true'
    ).toBe('$gate-planner.output.run_tr == true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-021 [P0] — tea-tr output_format requires the full gate envelope and
// excludes SKIPPED (AC #1, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr real gate contract — envelope present, SKIPPED excluded (TD-021)', () => {
  it('tea-tr declares an output_format object requiring every gate-envelope field', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const of = (nodeById(v2, 'tea-tr') as { output_format?: OutputFormat } | undefined)
      ?.output_format;
    expect(of, 'tea-tr must declare output_format').toBeDefined();
    expect(of!.type).toBe('object');
    for (const field of REAL_GATE_REQUIRED_FIELDS) {
      expect(of!.required, `tea-tr.output_format must require ${field}`).toContain(field);
    }
  });

  it('tea-tr gate enum is PASS/FAIL/CONCERNS/ERROR and NEVER allows SKIPPED', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const of = (nodeById(v2, 'tea-tr') as { output_format?: OutputFormat } | undefined)
      ?.output_format;
    const gateEnum = of!.properties?.gate?.enum ?? [];
    expect(gateEnum, 'tea-tr gate enum must be PASS/FAIL/CONCERNS/ERROR').toEqual([
      'PASS',
      'FAIL',
      'CONCERNS',
      'ERROR',
    ]);
    expect(gateEnum, 'real tea-tr branch must NOT allow SKIPPED').not.toContain('SKIPPED');
  });

  it('tea-tr contract self-identifies node:"tea-tr" via its prompt_suffix', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'tea-tr') as { prompt_suffix?: string } | undefined;
    // Node identity is pinned in the prompt_suffix instruction (mirrors tea-rv/tea-nr).
    expect(node?.prompt_suffix, 'tea-tr prompt_suffix must pin node identity').toContain('tea-tr');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-022 [P1] — tea-tr prompt_suffix pins story_ref (AC #1)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr story identity — prompt_suffix pins resolved story_ref (TD-022)', () => {
  it('tea-tr adds a prompt_suffix pinning $resolve-story-input.output.story_ref', () => {
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
// TD-023 [P0] — tea-tr-skipped is a direct gate-planner bash sibling with the
// inverse condition (AC #2, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr-skipped node shape — direct gate-planner bash sibling (TD-023)', () => {
  it('tea-tr-skipped exists and is a deterministic bash node (no AI, no command)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'tea-tr-skipped');
    expect(node, 'tea-tr-skipped node must exist').toBeDefined();
    expect('bash' in node!, 'tea-tr-skipped must be a bash node').toBe(true);
    expect('prompt' in node!, 'tea-tr-skipped must not be a prompt node').toBe(false);
    expect('command' in node!, 'tea-tr-skipped must not be a command node').toBe(false);
  });

  it('tea-tr-skipped hangs off gate-planner directly — NOT behind the RV/NR branches', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'tea-tr-skipped')!;
    expect(
      node.depends_on,
      'tea-tr-skipped must depend only on gate-planner (unblocked by RV/NR)'
    ).toEqual(['gate-planner']);
    for (const rvNr of ['tea-rv', 'tea-rv-skipped', 'tea-nr', 'tea-nr-skipped']) {
      expect(node.depends_on, `tea-tr-skipped must NOT depend on ${rvNr}`).not.toContain(rvNr);
    }
  });

  it('tea-tr-skipped uses the inverse guard when: "$gate-planner.output.run_tr == false"', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-tr-skipped') as { when?: string }).when).toBe(
      '$gate-planner.output.run_tr == false'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-024 [P1] — tea-tr-skipped emits the SKIPPED gate envelope via safe encoder
// (AC #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr-skipped contract — SKIPPED envelope, safe JSON encoder (TD-024)', () => {
  it('tea-tr-skipped serializes via bun -e JSON.stringify with gate:"SKIPPED", not naive echo', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = (nodeById(v2, 'tea-tr-skipped') as { bash?: string } | undefined)?.bash ?? '';
    expect(bash, 'tea-tr-skipped must serialize via bun -e JSON.stringify').toContain(
      'JSON.stringify'
    );
    expect(bash, 'tea-tr-skipped contract must set gate:"SKIPPED"').toContain('SKIPPED');
    // Guard against naive interpolation that corrupts special characters.
    expect(
      /echo\s+["']?\{/.test(bash),
      'tea-tr-skipped must not build JSON with a naive echo "{...}"'
    ).toBe(false);
  });

  it('tea-tr-skipped contract pins node id, story_ref, findings_count:0, and reason_tr', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = (nodeById(v2, 'tea-tr-skipped') as { bash?: string } | undefined)?.bash ?? '';
    expect(bash, 'contract must self-identify node:"tea-tr-skipped"').toContain('tea-tr-skipped');
    expect(bash, 'contract story_ref must come from resolved input').toContain(
      '$resolve-story-input.output.story_ref'
    );
    expect(bash, 'contract reason must come from gate-planner reason_tr').toContain(
      '$gate-planner.output.reason_tr'
    );
    expect(bash, 'skip contract must carry findings_count:0').toContain('findings_count:0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-025 [P1] — skip encoder survives backslash/quote/newline/CR/tab
// (malformed input)
// ═══════════════════════════════════════════════════════════════════════════

describe('Skip-contract encoder — malformed reason survives serialization (TD-025)', () => {
  it('technique proof: the bun JSON encoder survives backslash/quote/newline/CR/tab in reasons', async () => {
    // Self-contained proof that the CHOSEN encoder pattern is sound. Pairs with
    // the static assertion in TD-024 that tea-tr-skipped actually adopts it.
    const nastyReason = 'skip: not run\\this "run"\nline2\rcr\ttab';
    const nastyRef = 'story\\ref"x';
    const bashScript = `
      set -e
      SK_STORY_REF="$1"
      SK_REASON="$2"
      CONTRACT=$(
        SK_STORY_REF="$SK_STORY_REF" SK_REASON="$SK_REASON" \\
        bun -e 'process.stdout.write(JSON.stringify({contract_version:"1.0",workflow:"bmad-dev-story-with-tea-fix-loop-v2",node:"tea-tr-skipped",story_ref:process.env.SK_STORY_REF,gate:"SKIPPED",findings_count:0,reason:process.env.SK_REASON}))'
      )
      printf '%s' "$CONTRACT"
    `;
    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', nastyRef, nastyReason]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.gate).toBe('SKIPPED');
    expect(parsed.node).toBe('tea-tr-skipped');
    expect(parsed.story_ref).toBe(nastyRef);
    expect(parsed.reason).toBe(nastyReason);
    expect(parsed.findings_count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-026 [P1] — tea-tr-skipped has timeout, typed output, and artifact write
// (observability/timeout)
// ═══════════════════════════════════════════════════════════════════════════

describe('tea-tr-skipped hygiene — timeout + typed-output + artifact write (TD-026)', () => {
  it('tea-tr-skipped declares timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-tr-skipped') as { timeout?: number }).timeout).toBe(60000);
  });

  it('tea-tr-skipped declares a kebab-case semantic output_type: trace-skipped', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-tr-skipped') as { output_type?: string }).output_type).toBe(
      'trace-skipped'
    );
  });

  it('tea-tr-skipped best-effort writes tea-tr-skipped.gate.json under the run dir', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = (nodeById(v2, 'tea-tr-skipped') as { bash?: string } | undefined)?.bash ?? '';
    expect(bash, 'tea-tr-skipped must best-effort persist its gate contract').toContain(
      'tea-tr-skipped.gate.json'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-027 [P0] — PR tail depends on both TR-role branches with fail-closed join
// (AC #2, #3, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('PR tail — resolves through quality-gate-summary barrier (TD-027)', () => {
  it('create-pull-request depends on quality-gate-summary (not directly on TR branches)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, 'create-pull-request')!.depends_on ?? [];
    expect(deps, 'PR tail must depend on the quality-gate-summary barrier').toEqual([
      'quality-gate-summary',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-042 [P0] — quality-gate-summary barrier: fail-closed on RV/NR failure
// and ERROR (not FAIL — FAIL is a valid routing decision for the aggregator)
// ═══════════════════════════════════════════════════════════════════════════

describe('quality-gate-summary — fail-closed barrier before PR (TD-042)', () => {
  it('quality-gate-summary exists as a bash node depending on all eight source nodes', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'quality-gate-summary');
    expect(node, 'quality-gate-summary must exist').toBeDefined();
    expect('bash' in node!, 'quality-gate-summary must be a bash node').toBe(true);
    expect([...(node!.depends_on ?? [])].sort()).toEqual(
      [
        'code-review-auto',
        'resolve-story-input',
        'tea-nr',
        'tea-nr-skipped',
        'tea-rv',
        'tea-rv-skipped',
        'tea-tr',
        'tea-tr-skipped',
      ].sort()
    );
  });

  it('quality-gate-summary uses none_failed_min_one_success (fails closed on any real branch failure)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, 'quality-gate-summary') as { trigger_rule?: string };
    expect(node.trigger_rule).toBe('none_failed_min_one_success');
  });

  it('quality-gate-summary parses TR contract via JSON.parse and validates the full envelope before aggregating', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash =
      (nodeById(v2, 'quality-gate-summary') as { bash?: string } | undefined)?.bash ?? '';
    expect(bash, 'must use whole-output ref to avoid producer-not-run on skipped tea-tr').toContain(
      '$tea-tr.output'
    );
    expect(
      bash,
      'must NOT use field-level $tea-tr.output.gate (throws producer-not-run when tea-tr is skipped)'
    ).not.toContain('$tea-tr.output.gate');
    expect(bash, 'must use JSON.parse for deterministic parsing').toContain('JSON.parse');
    expect(bash, 'must validate contract_version').toContain('contract_version');
    expect(bash, 'must validate workflow identity').toContain('workflow');
    expect(bash, 'must validate node identity').toContain('node');
    expect(bash, 'must validate story_ref against resolved input').toContain('story_ref');
    expect(bash, 'must validate findings_count is non-negative').toContain('findings_count');
    expect(
      bash,
      'must reference FAIL for aggregation (FAIL is a valid routing decision)'
    ).toContain('FAIL');
    expect(
      bash,
      'must exit non-zero on ERROR gate (ERROR is a hard failure, distinct from FAIL)'
    ).toContain('exit 1');
  });

  it('quality-gate-summary declares timeout and typed output', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'quality-gate-summary') as { timeout?: number }).timeout).toBe(60000);
    expect((nodeById(v2, 'quality-gate-summary') as { output_type?: string }).output_type).toBe(
      'quality-gate-summary'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-028 [P1] — edited v2 YAML passes parseWorkflow schema + DAG validation
// with when/trigger_rule/depends_on coexisting (AC #3)
// (In-process parity for CLI `validate workflows` — parseWorkflow runs the same
//  schema + DAG validation the CLI invokes.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Schema + DAG validation — edited v2 stays valid (TD-028)', () => {
  it('edited v2 workflow parses and passes schema + DAG validation', () => {
    const content = readLF(V2_FILE);
    const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
    expect(result.error, `parseWorkflow reported: ${result.error?.error ?? 'none'}`).toBeNull();
    expect((result.workflow as WorkflowDefinition).nodes.length).toBeGreaterThan(0);
  });

  it('tea-tr legally carries when: + trigger_rule: + multi depends_on together', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const tr = nodeById(v2, 'tea-tr') as {
      when?: string;
      trigger_rule?: string;
      depends_on?: string[];
    };
    expect(tr.when, 'tea-tr must carry a when: guard').toBeDefined();
    expect(tr.trigger_rule, 'tea-tr must carry a trigger_rule').toBe('none_failed_min_one_success');
    expect((tr.depends_on ?? []).length, 'tea-tr must keep its multi-branch join').toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-029 [P0] — run_tr boolean drives exactly one TR branch per flag value
// (proves the run_tr=false path WITHOUT faking gate-planner; AC #1, #2)
// ═══════════════════════════════════════════════════════════════════════════

describe('when: evaluator — run_tr drives exactly one TR branch (TD-029)', () => {
  const makeCompletedOutput = (jsonStdout: string): NodeOutput => ({
    state: 'completed',
    output: jsonStdout,
  });
  const outputs = (runTr: boolean): Map<string, NodeOutput> =>
    new Map([['gate-planner', makeCompletedOutput(JSON.stringify({ run_tr: runTr }))]]);

  it('run_tr=true → real tea-tr guard true, skip guard false', () => {
    expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs(true)).result).toBe(
      true
    );
    expect(evaluateCondition('$gate-planner.output.run_tr == false', outputs(true)).result).toBe(
      false
    );
  });

  it('run_tr=false → real tea-tr guard false, skip guard true (the false path, proven structurally)', () => {
    expect(evaluateCondition('$gate-planner.output.run_tr == true', outputs(false)).result).toBe(
      false
    );
    expect(evaluateCondition('$gate-planner.output.run_tr == false', outputs(false)).result).toBe(
      true
    );
  });

  it('the two TR guards are mutually exclusive for every run_tr value (no impossible dual-run)', () => {
    for (const flag of [true, false]) {
      const real = evaluateCondition('$gate-planner.output.run_tr == true', outputs(flag)).result;
      const skip = evaluateCondition('$gate-planner.output.run_tr == false', outputs(flag)).result;
      expect(real !== skip, `exactly one TR branch may run for run_tr=${flag}`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-035 [P1] — existing four-way RV/NR tea-tr join remains intact
// (regression guard for AC #1, #4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Regression — tea-tr keeps its four-way RV/NR join (TD-035)', () => {
  it('tea-tr still depends on all four RV/NR branch nodes', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, 'tea-tr')!.depends_on ?? [];
    expect([...deps].sort(), 'the four-way branch join must survive').toEqual(
      ['tea-nr', 'tea-nr-skipped', 'tea-rv', 'tea-rv-skipped'].sort()
    );
  });

  it('tea-tr still uses none_failed_min_one_success (tolerates skips, fails closed)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, 'tea-tr') as { trigger_rule?: string }).trigger_rule).toBe(
      'none_failed_min_one_success'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-036 [P1] — bundled v2 embeds the TR skip and matches source (AC #5).
// Pair with `bun run check:bundled`.
// ═══════════════════════════════════════════════════════════════════════════

describe('Bundle parity — generated defaults embed the TR join (TD-036)', () => {
  it('BUNDLED_WORKFLOWS v2 entry includes tea-tr-skipped and the run_tr guards', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, 'bundled v2 workflow must be present').toBeDefined();
    expect(content, 'regenerated bundle must contain tea-tr-skipped').toContain('tea-tr-skipped');
    expect(content, 'regenerated bundle must contain the run_tr==true guard').toContain(
      'run_tr == true'
    );
    expect(content, 'regenerated bundle must contain the run_tr==false guard').toContain(
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
// TD-037 [P1] — v1 baseline untouched; v2 additive scope includes the third
// skip node (AC #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Scope guard — v1 untouched, v2 additive third skip node (TD-037)', () => {
  it('v1 workflow gains no TR skip node and keeps tea-tr unconditional (proves it was not edited)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, 'tea-tr-skipped'), 'v1 must not gain a TR skip node').toBeUndefined();
    const v1Tr = nodeById(v1, 'tea-tr') as { when?: string } | undefined;
    if (v1Tr) {
      expect(v1Tr.when, 'v1 tea-tr must stay unconditional').toBeUndefined();
    }
  });

  it('v2 change is additive — tea-tr-skipped is the third skip node id alongside RV/NR skips', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const ids = v2.nodes.map(n => n.id);
    expect(ids, 'tea-rv-skipped baseline skip must remain').toContain('tea-rv-skipped');
    expect(ids, 'tea-nr-skipped baseline skip must remain').toContain('tea-nr-skipped');
    expect(ids, 'tea-tr-skipped must be a NEW third skip node id').toContain('tea-tr-skipped');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-038 [P1] — predecessor regression assertions preserved, not lost.
// The predecessor file's fail-closed join checks must survive the predecessor-update
// task; the pre-TR-join "no when / skip absent" assertions must be INVERTED
// there, never silently deleted.
// ═══════════════════════════════════════════════════════════════════════════

describe('Regression preservation — predecessor fail-closed checks survive (TD-038)', () => {
  const PREDECESSOR = join(import.meta.dir, 'v2-tea-branches-contract.test.ts');

  it('the predecessor contract file still asserts the four-way tea-tr join and none_failed_min_one_success', () => {
    const body = readLF(PREDECESSOR);
    expect(body, 'predecessor contract file must exist').not.toBeNull();
    // These KEEP-lines must not be deleted while inverting the pre-TR-join assertions.
    expect(body, 'four-way tea-tr join assertion must remain in the predecessor file').toContain(
      'tea-tr depends on all four RV/NR branch nodes'
    );
    expect(
      body,
      'none_failed_min_one_success join assertion must remain in the predecessor file'
    ).toContain('none_failed_min_one_success');
  });

  it('the predecessor no longer asserts the stale pre-TR-join state (tea-tr-skipped absent)', () => {
    const body = readLF(PREDECESSOR) as string;
    // After the predecessor update inverts the stale block, this claim must be gone.
    expect(
      body.includes('tea-tr-skipped belongs to a later story'),
      'stale "tea-tr-skipped belongs to a later story" assertion must be inverted, not kept'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-039 [P1] — any mock.module() DAG file runs as its own bun invocation
// (concurrency/flake prevention)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test isolation — TR-join DAG fixture runs standalone (TD-039)', () => {
  it('packages/workflows/package.json runs v2-tr-join-dag.test.ts in its OWN invocation', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the TR-join dag fixture must be registered').toContain(
      'v2-tr-join-dag.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-tr-join-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the TR-join dag fixture').toBe(1);
    expect(
      owning[0],
      'the TR-join dag fixture must not co-locate other .test.ts files (mock.module is process-global)'
    ).toBe('bun test src/defaults/v2-tr-join-dag.test.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-040 [P2] — route_loop / gate-planner / v1 stay out of scope
// ═══════════════════════════════════════════════════════════════════════════

describe('Blast-radius guard — upstream + planner unchanged (TD-040)', () => {
  it('gate-planner is unchanged — bash node depending on code-review-gate, still emitting run_tr', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const gp = nodeById(v2, 'gate-planner') as { bash?: string; depends_on?: string[] };
    expect('bash' in (gp as object), 'gate-planner must remain a bash node').toBe(true);
    expect(gp.depends_on, 'gate-planner must still depend on code-review-gate').toEqual([
      'code-review-gate',
    ]);
    expect(gp.bash, 'gate-planner must still emit run_tr').toContain('run_tr');
    expect(gp.bash, 'gate-planner must still emit reason_tr').toContain('reason_tr');
  });

  it('code-review-gate remains a route_loop routing positive→gate-planner', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const gate = nodeById(v2, 'code-review-gate') as {
      route_loop?: { routes?: { positive?: string } };
    };
    expect(gate.route_loop, 'code-review-gate must remain a route_loop node').toBeDefined();
    expect(gate.route_loop!.routes?.positive).toBe('gate-planner');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-041 [P3] — kebab-case ids; no plan identifiers in generated tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — kebab-case ids, no plan references (TD-041)', () => {
  it('new node id and output_type are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const label of ['tea-tr-skipped', 'trace-skipped']) {
      expect(kebab.test(label), `${label} must be kebab-case`).toBe(true);
    }
  });

  it('generated TR-join ATDD test files contain no plan/story/epic identifiers', () => {
    const files = ['v2-tr-join-dag.test.ts', 'v2-tr-join-contract.test.ts'];
    const planRef = /\b(A3\.\d|A-FR-\d|A-AD-\d|R-0\d\d|W-00\d|R\d-F\d|a\d\.\d)\b/;
    for (const f of files) {
      const body = readLF(join(import.meta.dir, f));
      expect(body, `${f} must exist`).not.toBeNull();
      // TD-/AC# scenario tags are allowed (stable test taxonomy); plan/finding codes are not.
      const offending = (body as string)
        .split('\n')
        .filter(line => planRef.test(line) && !line.includes('CANONICAL_REF'));
      expect(offending, `${f} must not embed plan identifiers: ${offending[0] ?? ''}`).toHaveLength(
        0
      );
    }
  });
});
