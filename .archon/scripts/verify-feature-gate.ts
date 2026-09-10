import { z } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  digest,
  normalizeProposal,
  proposalSchema,
  selectionSchema,
  snapshotSchema,
  type Selection,
} from '../../.agents/skills/verify-archon/lib/contract';
import {
  git,
  loadCatalog,
  readJson,
  snapshot,
  toolingDigest,
  writeJson,
} from '../../.agents/skills/verify-archon/lib/io';
import {
  prove,
  validateRunnable,
  validateSelection,
} from '../../.agents/skills/verify-archon/lib/runner';

const attemptSchema = z.object({ id: z.uuid(), repo: z.string() }).strict();
const normalizationSchema = z
  .object({
    ok: z.boolean(),
    selection_sha256: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
const executionSchema = z
  .object({
    completed: z.boolean(),
    result_path: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
const proofRecordSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal('selection'),
    repo: z.string(),
    ok: z.boolean(),
    verdict: z.enum(['PASS', 'FAIL']),
    product: snapshotSchema,
    catalog_sha256: z.string(),
    selection_sha256: z.string(),
    tooling_sha256: z.string(),
    behavior_ids: z.array(z.string()),
    scenario_ids: z.array(z.string()),
    errors: z.array(z.string()),
    scenarios: z.array(
      z.object({ id: z.string(), status: z.string(), errors: z.array(z.string()) }).loose()
    ),
  })
  .loose();
const gateSchema = z.object({
  ok: z.boolean(),
  verdict: z.enum(['PASS', 'FAIL']),
  head_sha: z.string(),
  behavior_ids: z.array(z.string()),
  scenario_ids: z.array(z.string()),
  result_path: z.string().nullable(),
  errors: z.array(z.string()),
});
export type Gate = z.infer<typeof gateSchema>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attemptDir(repo: string, artifacts: string, expectedId?: string): Promise<string> {
  const attempt = attemptSchema.parse(await readJson(join(artifacts, 'verify/current.json')));
  if (attempt.repo !== repo) throw new Error('Verification attempt belongs to another checkout');
  if (
    expectedId !== undefined &&
    (!z.uuid().safeParse(expectedId).success || attempt.id !== expectedId)
  )
    throw new Error('Missing or mismatched successful begin receipt for this execution');
  return join(artifacts, 'verify/attempts', attempt.id);
}

export async function beginAttempt(repo: string, artifacts: string): Promise<string> {
  const id = randomUUID();
  await mkdir(join(artifacts, 'verify/attempts', id), { recursive: true });
  // Invalidate the previous attempt before any AI, install, or snapshot can fail.
  await writeJson(join(artifacts, 'verify/current.json'), { id, repo });
  return id;
}

export async function prepareAttempt(repo: string, artifacts: string): Promise<void> {
  const dir = await attemptDir(repo, artifacts);
  const base = (await readFile(join(artifacts, 'superpowers/base-sha.txt'), 'utf8')).trim();
  const current = await snapshot(repo, base);
  await writeJson(join(dir, 'snapshot.json'), current);
  if (current.dirty)
    throw new Error(
      'Commit only the intended change before selecting verification; checkout is dirty'
    );
}

export async function normalizeAttempt(
  repo: string,
  artifacts: string,
  input: unknown
): Promise<Selection> {
  const dir = await attemptDir(repo, artifacts);
  await writeJson(join(dir, 'normalization.json'), { ok: false });
  await writeJson(join(dir, 'execution.json'), { completed: false });
  await writeJson(join(dir, 'proposal.json'), input);
  try {
    const prepared = snapshotSchema.parse(await readJson(join(dir, 'snapshot.json')));
    const proposal = proposalSchema.parse(input);
    if (proposal.base_sha !== prepared.base_sha || proposal.head_sha !== prepared.head_sha)
      throw new Error(
        'Proposal must use the workflow base and prepared HEAD, not a substitute diff'
      );
    const catalog = await loadCatalog();
    const selected = normalizeProposal(catalog, proposal, await snapshot(repo, prepared.base_sha));
    await validateRunnable(catalog, selected.scenario_ids, dir);
    await writeJson(join(dir, 'selection.json'), selected);
    await writeJson(join(dir, 'normalization.json'), {
      ok: true,
      selection_sha256: digest(selected),
    });
    return selected;
  } catch (error) {
    await writeJson(join(dir, 'normalization.json'), { ok: false, error: errorMessage(error) });
    throw error;
  }
}

async function currentSelection(repo: string, dir: string): Promise<Selection> {
  const receipt = normalizationSchema.parse(await readJson(join(dir, 'normalization.json')));
  if (!receipt.ok)
    throw new Error(receipt.error ?? 'Normalization did not complete for this attempt');
  const selected = selectionSchema.parse(await readJson(join(dir, 'selection.json')));
  if (receipt.selection_sha256 !== digest(selected))
    throw new Error('Normalized selection was modified');
  const prepared = snapshotSchema.parse(await readJson(join(dir, 'snapshot.json')));
  return validateSelection(await loadCatalog(), repo, selected, prepared.base_sha);
}

export async function proveAttempt(repo: string, artifacts: string): Promise<boolean> {
  const dir = await attemptDir(repo, artifacts);
  await writeJson(join(dir, 'execution.json'), { completed: false });
  try {
    const selection = await currentSelection(repo, dir);
    // Same executable runner as `verify-archon prove --selection`, without an AI verdict.
    const result = await prove(
      await loadCatalog(),
      repo,
      selection.scenario_ids,
      join(dir, 'evidence'),
      selection,
      selection.proposal.base_sha
    );
    await writeJson(join(dir, 'execution.json'), {
      completed: true,
      result_path: join(result.evidence_dir, 'result.json'),
    });
    return result.ok;
  } catch (error) {
    await writeJson(join(dir, 'execution.json'), { completed: false, error: errorMessage(error) });
    throw error;
  }
}

export async function recordAttempt(
  repo: string,
  artifacts: string,
  expectedId: string
): Promise<Gate> {
  const gate = gateSchema.parse({
    ok: false,
    verdict: 'FAIL',
    head_sha: '',
    behavior_ids: [],
    scenario_ids: [],
    result_path: null,
    errors: [],
  });
  try {
    const dir = await attemptDir(repo, artifacts, expectedId);
    const selected = await currentSelection(repo, dir);
    gate.head_sha = selected.proposal.head_sha;
    gate.behavior_ids = selected.behavior_ids;
    gate.scenario_ids = selected.scenario_ids;
    const receipt = executionSchema.parse(await readJson(join(dir, 'execution.json')));
    if (!receipt.completed || !receipt.result_path)
      throw new Error(receipt.error ?? 'Proof did not complete for this attempt');
    const resultPath = resolve(receipt.result_path);
    const within = relative(join(dir, 'evidence'), resultPath);
    if (isAbsolute(within) || within.startsWith('..') || basename(resultPath) !== 'result.json')
      throw new Error('Proof result is not evidence from the current attempt');
    gate.result_path = resultPath;
    const result = proofRecordSchema.parse(await readJson(resultPath));
    if (
      result.repo !== repo ||
      result.product.dirty ||
      result.product.base_sha !== selected.proposal.base_sha ||
      result.product.head_sha !== gate.head_sha ||
      digest([...new Set(result.product.changed_paths)].sort()) !==
        digest([...new Set(selected.proposal.changed_paths)].sort()) ||
      result.catalog_sha256 !== selected.catalog_sha256 ||
      result.selection_sha256 !== digest(selected) ||
      result.tooling_sha256 !== (await toolingDigest()) ||
      digest(result.behavior_ids) !== digest(selected.behavior_ids) ||
      digest(result.scenario_ids) !== digest(selected.scenario_ids)
    )
      throw new Error('Proof provenance is stale or does not match this selection and checkout');
    gate.errors.push(...result.errors);
    for (const id of selected.scenario_ids) {
      const matches = result.scenarios.filter(item => item.id === id);
      if (matches.length !== 1) gate.errors.push(`${id}: required proof missing or duplicated`);
      else if (matches[0].status !== 'passed' || matches[0].errors.length)
        gate.errors.push(`${id}: ${matches[0].status}: ${matches[0].errors.join('; ')}`);
    }
    if (result.scenarios.length !== selected.scenario_ids.length)
      gate.errors.push('Unexpected scenario result count');
    if (!result.ok || result.verdict !== 'PASS')
      gate.errors.push('Executable verifier returned FAIL');
    gate.ok = gate.errors.length === 0;
    gate.verdict = gate.ok ? 'PASS' : 'FAIL';
  } catch (error) {
    gate.errors.push(errorMessage(error));
  }
  await mkdir(join(artifacts, 'verify'), { recursive: true });
  await writeJson(join(artifacts, 'verify/gate.json'), gate);
  await writeFile(join(artifacts, 'verify/report.md'), renderGate(gate));
  return gate;
}

export function renderGate(gate: Gate): string {
  return [
    '# Feature verification',
    '',
    `Verdict: ${gate.verdict}`,
    `Product HEAD: ${gate.head_sha || 'unavailable'}`,
    '',
    '## Behaviors',
    ...gate.behavior_ids.map(id => `- ${id}`),
    '',
    '## Required Scenarios',
    ...gate.scenario_ids.map(id => `- ${id}`),
    '',
    '## Evidence',
    gate.result_path ?? 'No complete executable result for this attempt.',
    '',
    '## Failures',
    ...gate.errors.map(error => `- ${error}`),
    '',
  ].join('\n');
}

export async function assertPass(
  repo: string,
  artifacts: string,
  expectedId: string
): Promise<Gate> {
  const gate = await recordAttempt(repo, artifacts, expectedId);
  if (!gate.ok) throw new Error(`PR blocked: ${gate.errors.join('; ')}`);
  return gate;
}

async function main(): Promise<void> {
  const artifacts = process.env.ARTIFACTS_DIR;
  if (!artifacts) throw new Error('ARTIFACTS_DIR is required for the workflow adapter');
  const repo = (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).trim();
  const root = resolve(artifacts);
  switch (process.argv[2]) {
    case 'begin':
      console.log(await beginAttempt(repo, root));
      break;
    case 'prepare':
      await prepareAttempt(repo, root);
      break;
    case 'normalize':
      console.log(
        JSON.stringify(
          await normalizeAttempt(repo, root, JSON.parse(await Bun.stdin.text()) as unknown)
        )
      );
      break;
    case 'prove':
      process.exitCode = (await proveAttempt(repo, root)) ? 0 : 1;
      break;
    case 'record':
      // Bash route sources consume a JSON scalar; full provenance stays in gate.json.
      console.log(JSON.stringify((await recordAttempt(repo, root, process.argv[3] ?? '')).ok));
      break;
    case 'assert-pass':
      console.log(JSON.stringify(await assertPass(repo, root, process.argv[3] ?? '')));
      break;
    case 'blocked': {
      const gate = await recordAttempt(repo, root, process.argv[3] ?? '');
      await writeFile(
        join(root, 'verify/BLOCKED.md'),
        `# Verification fix budget exhausted\n\nNo pull request was created.\n\n${renderGate(gate)}`
      );
      console.error(`Verification blocked. See ${join(root, 'verify/BLOCKED.md')}`);
      process.exitCode = 1;
      break;
    }
    default:
      throw new Error('Expected begin, prepare, normalize, prove, record, assert-pass, or blocked');
  }
}

if (import.meta.main) {
  main().catch((error: unknown): void => {
    console.error(JSON.stringify({ ok: false, error: errorMessage(error) }));
    process.exitCode = 1;
  });
}
