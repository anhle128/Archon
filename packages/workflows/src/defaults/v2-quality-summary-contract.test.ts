/**
 * RED-PHASE ATDD scaffolds — structural / contract assertions for evolving
 * `quality-gate-summary` into the four-role route-facing aggregator that reads
 * the resolved CR / RV / NR / TR gate contracts and emits
 * `quality-gate-summary.json`.
 *
 * These parse the v2 YAML on disk, import the regenerated bundled defaults, and
 * drive self-contained bash serialization / parsing proofs — NO mock.module()
 * needed, so this file is safe to co-locate in the shared `bun test` batch (the
 * GREEN-phase step registers it alongside v2-tr-join-contract.test.ts in
 * packages/workflows/package.json).
 *
 * Behavioral / DAG-execution proof lives in the sibling file
 * v2-quality-summary-dag.test.ts (real bash + real executor, isolated
 * invocation).
 *
 * ── TDD RED PHASE ──────────────────────────────────────────────────────────
 * The YAML-structural assertions target the NOT-YET-IMPLEMENTED aggregator and
 * are EXPECTED TO FAIL until the v2 YAML evolves `quality-gate-summary` to:
 *   1. depend on [code-review-auto, tea-rv, tea-rv-skipped, tea-nr,
 *      tea-nr-skipped, tea-tr, tea-tr-skipped, resolve-story-input] with
 *      trigger_rule: none_failed_min_one_success,
 *   2. read every optional role with the WHOLE-output ref ($tea-rv.output …)
 *      and never the field-level $tea-*.output.gate on a skip-capable branch,
 *   3. parse each selected contract with bun -e + JSON.parse (never grep/case),
 *   4. validate identity (story_ref/contract_version/workflow/node) fail-closed,
 *   5. emit the routing envelope (gate PASS|FAIL, round, blocking_count,
 *      decision_needed_count, findings_total, cr/rv/nr/tr gate echoes) with
 *      output_type: quality-gate-summary and timeout: 60000, and
 *   6. leave create-pull-request depending only on quality-gate-summary with
 *      NO route-loop node added.
 *
 * The self-contained "technique proof" blocks (TD-105, TD-150, TD-151, TD-152)
 * validate that the CHOSEN encoder/parser pattern is sound; they pass in the
 * red phase and are paired with the static YAML assertions that the node must
 * actually adopt that pattern.
 *
 * NOTE ON THE a3.3 PRECURSOR: the predecessor introduced a minimal
 * `quality-gate-summary` barrier (output_type "gate-summary", six branch deps,
 * exit-1 on TR FAIL). This story EVOLVES it — output_type "quality-gate-summary",
 * eight deps (adds code-review-auto + resolve-story-input), and a PASS|FAIL
 * routing contract that does NOT exit-1 on a role FAIL (routing on that contract
 * is a later story). These assertions therefore intentionally supersede the
 * precursor barrier assertions; reconciling them is a dev task (see the ATDD
 * checklist "Predecessor reconciliation" note).
 *
 * Run in red phase with:
 *   bun test packages/workflows/src/defaults/v2-quality-summary-contract.test.ts
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
const CANONICAL_REF = 'a1-2-preserve-story-input-resolution';

// The eight resolved sources the aggregator must join: CR (required) + the six
// RV/NR/TR real/skip branch nodes + the resolved-input identity anchor.
const EXPECTED_SUMMARY_DEPS = [
  'code-review-auto',
  'resolve-story-input',
  'tea-nr',
  'tea-nr-skipped',
  'tea-rv',
  'tea-rv-skipped',
  'tea-tr',
  'tea-tr-skipped',
];

// Every optional role must be selected through its WHOLE-output ref so a skipped
// sibling yields '' instead of throwing producer-not-run.
const OPTIONAL_WHOLE_OUTPUT_REFS = [
  '$tea-rv.output',
  '$tea-rv-skipped.output',
  '$tea-nr.output',
  '$tea-nr-skipped.output',
  '$tea-tr.output',
  '$tea-tr-skipped.output',
];

// Field-level gate reads on a skip-capable branch throw producer-not-run when
// that branch is the skipped sibling — strictly forbidden.
const FORBIDDEN_FIELD_LEVEL_REFS = [
  '$tea-rv.output.gate',
  '$tea-nr.output.gate',
  '$tea-tr.output.gate',
];

// Route-facing envelope + routing fields the emitted contract must carry.
const REQUIRED_ENVELOPE_TOKENS = [
  'contract_version',
  'workflow',
  'node',
  'story_ref',
  'gate',
  'round',
  'blocking_count',
  'decision_needed_count',
  'findings_total',
  'cr_gate',
  'rv_gate',
  'nr_gate',
  'tr_gate',
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

const summaryBash = (wf: WorkflowDefinition): string =>
  (nodeById(wf, SUMMARY_ID) as { bash?: string } | undefined)?.bash ?? '';

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
// TD-163 [P0] — the TR-join baseline must exist before the aggregator can read a
// resolved TR contract (AC #6). Precondition gate.
// ═══════════════════════════════════════════════════════════════════════════

describe('Baseline precondition — resolved TR path exists before aggregation (TD-163)', () => {
  it('tea-tr is gated on run_tr == true and carries a real gate output_format', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const tr = nodeById(v2, 'tea-tr') as { when?: string; output_format?: { required?: string[] } };
    expect(tr.when, 'tea-tr must be gated so a skip sibling can exist').toBe(
      '$gate-planner.output.run_tr == true'
    );
    expect(tr.output_format?.required, 'tea-tr must carry a real gate output_format').toContain(
      'gate'
    );
  });

  it('tea-tr-skipped sibling exists as a bash node with the inverse guard', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const skip = nodeById(v2, 'tea-tr-skipped') as { when?: string } | undefined;
    expect(skip, 'tea-tr-skipped must exist (a3.3 TR-join baseline)').toBeDefined();
    expect('bash' in (skip as object), 'tea-tr-skipped must be a bash node').toBe(true);
    expect(skip!.when, 'tea-tr-skipped must use the inverse run_tr guard').toBe(
      '$gate-planner.output.run_tr == false'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-100 [P0] — quality-gate-summary is a deterministic bash aggregator with the
// full eight-source join, fail-closed trigger rule, bounded timeout, and typed
// output (AC #1, #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Aggregator shape — deterministic bash join over all sources (TD-100)', () => {
  it('quality-gate-summary exists and is a bash node (no AI, no command, no prompt)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, SUMMARY_ID);
    expect(node, 'quality-gate-summary must exist').toBeDefined();
    expect('bash' in node!, 'quality-gate-summary must be a bash node').toBe(true);
    expect('prompt' in node!, 'quality-gate-summary must NOT be a prompt (prose) node').toBe(false);
    expect('command' in node!, 'quality-gate-summary must NOT be a command node').toBe(false);
  });

  it('quality-gate-summary depends on CR + all six branch nodes + resolve-story-input', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = [...(nodeById(v2, SUMMARY_ID)!.depends_on ?? [])].sort();
    expect(deps, 'aggregator must join CR, the six RV/NR/TR branches, and resolved input').toEqual(
      [...EXPECTED_SUMMARY_DEPS].sort()
    );
  });

  it('quality-gate-summary uses none_failed_min_one_success (fails closed on any real branch failure)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, SUMMARY_ID) as { trigger_rule?: string }).trigger_rule).toBe(
      'none_failed_min_one_success'
    );
  });

  it('quality-gate-summary declares output_type: quality-gate-summary and timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, SUMMARY_ID) as { output_type?: string }).output_type).toBe(
      'quality-gate-summary'
    );
    expect((nodeById(v2, SUMMARY_ID) as { timeout?: number }).timeout).toBe(60000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-101 [P0] — whole-output reads for optional roles; field-level gate reads on
// skip-capable branches forbidden (AC #1, #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Optional-branch safety — whole-output reads only (TD-101)', () => {
  it('aggregator reads each optional role via the whole-output ref', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    for (const ref of OPTIONAL_WHOLE_OUTPUT_REFS) {
      expect(bash, `aggregator must select ${ref} (whole-output, skip-safe)`).toContain(ref);
    }
  });

  it('aggregator reads CR via its whole-output ref (CR is required, not skip-capable)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(summaryBash(v2), 'CR contract must be read via $code-review-auto.output').toContain(
      '$code-review-auto.output'
    );
  });

  it('aggregator NEVER uses field-level $tea-*.output.gate on a skip-capable branch', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    for (const ref of FORBIDDEN_FIELD_LEVEL_REFS) {
      expect(
        bash,
        `${ref} throws producer-not-run when that branch is skipped — forbidden`
      ).not.toContain(ref);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-102 [P0] — deterministic JSON parsing; no grep/case/substring gate matching
// (AC #1, #5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Deterministic parsing — bun -e + JSON.parse, no substring matching (TD-102)', () => {
  it('aggregator parses contracts with bun -e + JSON.parse', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    expect(bash, 'aggregator must use bun -e for JSON handling').toContain('bun -e');
    expect(bash, 'aggregator must parse with JSON.parse (not substring matching)').toContain(
      'JSON.parse'
    );
  });

  it('aggregator does NOT gate on grep/case substring matching of raw JSON', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    // A `case`/`grep` on raw JSON text accepts false positives from other fields.
    expect(
      /\bgrep\b[^\n]*\bFAIL\b/.test(bash),
      'must not grep raw JSON for a FAIL substring'
    ).toBe(false);
    expect(
      /\bcase\b[^\n]*\$(tea|code)/.test(bash),
      'must not case-match a substituted contract value for gate detection'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-103 [P1] — aggregator emits exact JSON to stdout and best-effort persists
// quality-gate-summary.json (structural half; DAG half in the sibling file)
// (AC #1, #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Emission — stdout contract + best-effort artifact persist (TD-103)', () => {
  it('aggregator writes the contract to stdout via printf (becomes the node output)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    expect(bash, 'aggregator must emit the contract with printf to stdout').toContain('printf');
    expect(
      /echo\s+["']?\{/.test(bash),
      'aggregator must not build the JSON contract with a naive echo "{...}"'
    ).toBe(false);
  });

  it('aggregator best-effort persists quality-gate-summary.json under the run dir', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(
      summaryBash(v2),
      'aggregator must best-effort persist quality-gate-summary.json for later consumers'
    ).toContain('quality-gate-summary.json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-104 [P1] — the emitted envelope carries every routing field + per-role gate
// echoes so downstream routing never re-reads the source gates (AC #3)
// ═══════════════════════════════════════════════════════════════════════════

describe('Envelope completeness — routing fields + per-role gate echoes (TD-104)', () => {
  it('aggregator serializes every required envelope and routing token', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    for (const token of REQUIRED_ENVELOPE_TOKENS) {
      expect(bash, `emitted contract must include ${token}`).toContain(token);
    }
  });

  it('aggregator serializes via bun -e JSON.stringify (safe encoder), not string concat', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect(summaryBash(v2), 'emitted contract must be built with JSON.stringify').toContain(
      'JSON.stringify'
    );
  });

  it('aggregator self-identifies node:"quality-gate-summary" and pins workflow identity', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    expect(bash, 'contract must self-identify the summary node').toContain('quality-gate-summary');
    expect(bash, 'contract must pin the workflow identity').toContain(V2_STEM);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-105 [P1] — technique proof: special characters in a selected contract's
// string fields survive JSON.parse + re-encode (malformed-input hardening)
// ═══════════════════════════════════════════════════════════════════════════

describe('Encoder hardening — special chars survive parse + re-encode (TD-105)', () => {
  it('the bun JSON parse/re-encode pipeline preserves quotes/backslashes/newlines/tabs', async () => {
    // Self-contained proof that the CHOSEN parse+re-encode pattern is sound.
    // Pairs with the static TD-102/TD-104 assertions that the node adopts it.
    const nastyReport = 'report\\path "gate":"FAIL" leftover\nline2\rcr\ttab';
    const nastyRef = 'story\\ref"x';
    const roleContract = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'tea-tr',
      gate: 'PASS',
      story_ref: nastyRef,
      findings_count: 0,
      report_file: nastyReport,
    });
    const bashScript = `
      set -e
      ROLE_JSON="$1"
      OUT=$(
        ROLE_JSON="$ROLE_JSON" \\
        bun -e 'const c = JSON.parse(process.env.ROLE_JSON); process.stdout.write(JSON.stringify({gate:c.gate,story_ref:c.story_ref,report_file:c.report_file,findings_total:c.findings_count}))'
      )
      printf '%s' "$OUT"
    `;
    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', roleContract]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.gate).toBe('PASS');
    expect(parsed.story_ref).toBe(nastyRef);
    expect(parsed.report_file).toBe(nastyReport);
    expect(parsed.findings_total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-150 [P1] — technique proof: the count derivation is correct
// (decision_needed_count = #CONCERNS roles, blocking_count = #FAIL roles,
// findings_total = sum of findings_count) across boundary role sets
// ═══════════════════════════════════════════════════════════════════════════

describe('Aggregation arithmetic — count derivation boundaries (TD-150)', () => {
  const aggregate = async (roles: Array<Record<string, unknown>>): Promise<Record<string, number | string>> => {
    // Proves the documented KISS policy without inventing new source fields.
    const rolesJson = JSON.stringify(roles);
    const bashScript = `
      set -e
      ROLES="$1"
      ROLES="$ROLES" bun -e '
        const roles = JSON.parse(process.env.ROLES);
        const blocking = roles.filter(r => r.gate === "FAIL").length;
        const decision = roles.filter(r => r.gate === "CONCERNS").length;
        const findings = roles.reduce((s, r) => s + (r.findings_count ?? 0), 0);
        const hasError = roles.some(r => r.gate === "ERROR");
        const gate = blocking > 0 ? "FAIL" : "PASS";
        process.stdout.write(JSON.stringify({gate, blocking_count: blocking, decision_needed_count: decision, findings_total: findings, has_error: hasError ? 1 : 0}));
      '
    `;
    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', rolesJson]);
    return JSON.parse(stdout) as Record<string, number | string>;
  };

  it('all PASS with zero findings → PASS, zero blocking, zero decision-needed, zero findings', async () => {
    const r = await aggregate([
      { gate: 'PASS', findings_count: 0 },
      { gate: 'PASS', findings_count: 0 },
      { gate: 'SKIPPED', findings_count: 0 },
      { gate: 'PASS', findings_count: 0 },
    ]);
    expect(r.gate).toBe('PASS');
    expect(r.blocking_count).toBe(0);
    expect(r.decision_needed_count).toBe(0);
    expect(r.findings_total).toBe(0);
  });

  it('CONCERNS-only roles → PASS with decision_needed_count equal to the CONCERNS count', async () => {
    const r = await aggregate([
      { gate: 'PASS', findings_count: 0 },
      { gate: 'CONCERNS', findings_count: 2 },
      { gate: 'CONCERNS', findings_count: 1 },
      { gate: 'SKIPPED', findings_count: 0 },
    ]);
    expect(r.gate).toBe('PASS');
    expect(r.decision_needed_count).toBe(2);
    expect(r.blocking_count).toBe(0);
    expect(r.findings_total).toBe(3);
  });

  it('multiple FAIL roles → FAIL with blocking_count equal to the FAIL count', async () => {
    const r = await aggregate([
      { gate: 'FAIL', findings_count: 4 },
      { gate: 'FAIL', findings_count: 1 },
      { gate: 'CONCERNS', findings_count: 2 },
      { gate: 'PASS', findings_count: 0 },
    ]);
    expect(r.gate).toBe('FAIL');
    expect(r.blocking_count).toBe(2);
    expect(r.decision_needed_count).toBe(1);
    expect(r.findings_total).toBe(7);
  });

  it('SKIPPED roles are neither blocking nor decision-needed', async () => {
    const r = await aggregate([
      { gate: 'SKIPPED', findings_count: 0 },
      { gate: 'SKIPPED', findings_count: 0 },
      { gate: 'PASS', findings_count: 0 },
      { gate: 'SKIPPED', findings_count: 0 },
    ]);
    expect(r.blocking_count).toBe(0);
    expect(r.decision_needed_count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-151 [P1] — technique proof: JSON.parse reads the actual gate field; a
// substring false positive in another field cannot flip the decision
// ═══════════════════════════════════════════════════════════════════════════

describe('Substring immunity — parsed gate field only (TD-151)', () => {
  it('a report_file containing a "gate":"FAIL" substring does not make a PASS role read as FAIL', async () => {
    const role = JSON.stringify({
      contract_version: '1.0',
      workflow: V2_STEM,
      node: 'tea-rv',
      gate: 'PASS',
      story_ref: CANONICAL_REF,
      findings_count: 0,
      report_file: 'leftover-"gate":"FAIL"-note.md',
    });
    const bashScript = `
      set -e
      ROLE="$1"
      ROLE="$ROLE" bun -e 'const c = JSON.parse(process.env.ROLE); process.stdout.write(c.gate)'
    `;
    const { stdout } = await execFileAsync('bash', ['-c', bashScript, '_', role]);
    expect(stdout.trim(), 'the parsed gate field is PASS regardless of substring noise').toBe(
      'PASS'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-147 [P0] — technique proof: malformed JSON makes the parse pipeline exit
// non-zero (the aggregator's fail-closed guard). The behavioral mid-DAG
// injection seam is absent (see the skipped scaffold in the DAG sibling).
// ═══════════════════════════════════════════════════════════════════════════

describe('Malformed input — JSON.parse fails closed with a non-zero exit (TD-147)', () => {
  it('a non-JSON contract makes the bun -e JSON.parse guard exit non-zero', async () => {
    const bashScript = `
      set -e
      ROLE="$1"
      ROLE="$ROLE" bun -e 'JSON.parse(process.env.ROLE)'
    `;
    let exitCode = 0;
    try {
      await execFileAsync('bash', ['-c', bashScript, '_', 'not-json{oops']);
    } catch (err) {
      exitCode = (err as { code?: number }).code ?? 1;
    }
    expect(exitCode, 'malformed JSON must fail the parse guard, never be accepted').not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-152 [P2] — technique proof: the encoder is deterministic for identical
// inputs (the artifact write overwrites, never appends duplicate JSON)
// ═══════════════════════════════════════════════════════════════════════════

describe('Determinism — identical inputs produce identical bytes (TD-152)', () => {
  it('encoding the same aggregate twice yields byte-identical output', async () => {
    const encode = async (): Promise<string> => {
      const bashScript = `
        bun -e 'process.stdout.write(JSON.stringify({contract_version:"1.0",workflow:"${V2_STEM}",node:"quality-gate-summary",story_ref:"${CANONICAL_REF}",gate:"PASS",round:1,blocking_count:0,decision_needed_count:0,findings_total:0,cr_gate:"PASS",rv_gate:"PASS",nr_gate:"SKIPPED",tr_gate:"PASS"}))'
      `;
      const { stdout } = await execFileAsync('bash', ['-c', bashScript]);
      return stdout;
    };
    const [a, b] = await Promise.all([encode(), encode()]);
    expect(a, 'the encoder must be deterministic').toBe(b);
  });

  it('the aggregator persists with a truncating redirect (>), never an append (>>)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    // Guard against >> append which would duplicate JSON across re-runs.
    expect(
      /quality-gate-summary\.json[^\n]*>>/.test(bash),
      'the summary artifact must not be appended to (>>) — it must be overwritten'
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-155 [P2] — bounded timeout, no unbounded external command (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Timeout guard — bounded aggregator (TD-155)', () => {
  it('quality-gate-summary declares timeout: 60000', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    expect((nodeById(v2, SUMMARY_ID) as { timeout?: number }).timeout).toBe(60000);
  });

  it('quality-gate-summary runs no network/watch command that could hang unbounded', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const bash = summaryBash(v2);
    for (const forbidden of ['curl ', 'wget ', 'nc ', 'tail -f', 'sleep ']) {
      expect(bash, `aggregator must not invoke an unbounded '${forbidden.trim()}'`).not.toContain(
        forbidden
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-160 [P1] — edited v2 parses; source + bundle match; v1 byte-for-byte
// unchanged (AC #6). Pair with `bun run check:bundled`.
// ═══════════════════════════════════════════════════════════════════════════

describe('Schema + bundle parity — edited v2 valid, v1 untouched (TD-160)', () => {
  it('edited v2 workflow parses and passes schema + DAG validation', () => {
    const content = readLF(V2_FILE);
    const result = parseWorkflow(content as string, `${V2_STEM}.yml`);
    expect(result.error, `parseWorkflow reported: ${result.error?.error ?? 'none'}`).toBeNull();
    expect((result.workflow as WorkflowDefinition).nodes.length).toBeGreaterThan(0);
  });

  it('quality-gate-summary legally carries depends_on + trigger_rule + output_type together', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const node = nodeById(v2, SUMMARY_ID) as {
      depends_on?: string[];
      trigger_rule?: string;
      output_type?: string;
    };
    expect((node.depends_on ?? []).length, 'aggregator must keep its eight-source join').toBe(8);
    expect(node.trigger_rule).toBe('none_failed_min_one_success');
    expect(node.output_type).toBe('quality-gate-summary');
  });

  it('bundled v2 content matches the on-disk source (no drift) and embeds the aggregator', () => {
    const content = BUNDLED_WORKFLOWS[V2_STEM];
    expect(content, 'bundled v2 workflow must be present').toBeDefined();
    expect(content, 'regenerated bundle must embed quality-gate-summary').toContain(SUMMARY_ID);
    expect(content?.replace(/\r\n/g, '\n')).toBe(readLF(V2_FILE));
  });

  it('v1 baseline gains no aggregator node (proves it was not edited)', () => {
    const v1 = parseFromDisk(V1_FILE, V1_STEM);
    expect(nodeById(v1, SUMMARY_ID), 'v1 must not gain quality-gate-summary').toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-161 [P1] — tail wiring: create-pull-request depends only on the summary and
// NO route-loop node is added by this story (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tail wiring — PR consumes the summary, no route loop added (TD-161)', () => {
  it('create-pull-request depends only on quality-gate-summary', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const deps = nodeById(v2, 'create-pull-request')!.depends_on ?? [];
    expect(deps, 'PR tail must resolve solely through the aggregator').toEqual([SUMMARY_ID]);
  });

  it('no quality route-loop node is introduced by this story (route decision is a later story)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const routeLoopIds = v2.nodes
      .filter(n => 'route_loop' in (n as object))
      .map(n => n.id);
    expect(
      routeLoopIds,
      'the only route_loop may remain the existing code-review-gate; no quality-route-loop yet'
    ).toEqual(['code-review-gate']);
    expect(v2.nodes.map(n => n.id), 'no quality-route-loop node may be added yet').not.toContain(
      'quality-route-loop'
    );
  });

  it('quality-gate-summary is the single successor feeding the tail (no dependency cycle)', () => {
    const v2 = parseFromDisk(V2_FILE, V2_STEM);
    const summaryDeps = nodeById(v2, SUMMARY_ID)!.depends_on ?? [];
    expect(
      summaryDeps,
      'the aggregator must not depend on create-pull-request (would be a cycle)'
    ).not.toContain('create-pull-request');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-162 [P1] — CI registration: contract test in the non-mock batch, DAG test
// in its OWN bun invocation (mock.module isolation) (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Test registration — mock isolation preserved (TD-162)', () => {
  it('contract test is registered in a shared (non-mock) batch segment', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the contract test must be registered').toContain(
      'v2-quality-summary-contract.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-quality-summary-contract.test.ts'));
    expect(owning.length, 'exactly one segment must own the contract test').toBe(1);
    expect(
      owning[0].includes('v2-quality-summary-dag.test.ts'),
      'the contract test must NOT share a segment with the mock.module DAG test'
    ).toBe(false);
  });

  it('DAG test is registered as its OWN standalone bun invocation (process-global mock.module)', () => {
    const pkg = readLF(PACKAGE_JSON) as string;
    const testScript = (JSON.parse(pkg) as { scripts?: { test?: string } }).scripts?.test ?? '';
    expect(testScript, 'the DAG fixture must be registered').toContain(
      'v2-quality-summary-dag.test.ts'
    );
    const segments = testScript.split('&&').map(s => s.trim());
    const owning = segments.filter(s => s.includes('v2-quality-summary-dag.test.ts'));
    expect(owning.length, 'exactly one segment must own the DAG fixture').toBe(1);
    expect(
      owning[0],
      'the DAG fixture must run alone (mock.module is process-global)'
    ).toBe('bun test src/defaults/v2-quality-summary-dag.test.ts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TD-164 [P3] — kebab-case ids/output types; no plan/finding identifiers in the
// generated ATDD files (AC #6)
// ═══════════════════════════════════════════════════════════════════════════

describe('Naming conventions — kebab-case ids, no plan references (TD-164)', () => {
  it('the new node id and output_type are kebab-case', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const label of ['quality-gate-summary']) {
      expect(kebab.test(label), `${label} must be kebab-case`).toBe(true);
    }
  });

  it('generated quality-summary ATDD files contain no plan/story/epic/finding identifiers', () => {
    const files = ['v2-quality-summary-dag.test.ts', 'v2-quality-summary-contract.test.ts'];
    // Forbidden: epic story codes (A3.x/A4.x), architecture decision/req codes,
    // risk/waiver codes, and predecessor finding codes. Allowed: TD-nnn / AC#.
    const planRef = /\b(A[0-9]\.[0-9]|A-FR-[0-9]|A-AD-[0-9]|R-0[0-9][0-9]|W-00[0-9]|R[0-9]-F[0-9])\b/;
    for (const f of files) {
      const body = readLF(join(import.meta.dir, f));
      expect(body, `${f} must exist`).not.toBeNull();
      const offending = (body as string)
        .split('\n')
        .filter(line => planRef.test(line) && !line.includes('CANONICAL_REF'));
      expect(
        offending,
        `${f} must not embed plan identifiers: ${offending[0] ?? ''}`
      ).toHaveLength(0);
    }
  });
});
