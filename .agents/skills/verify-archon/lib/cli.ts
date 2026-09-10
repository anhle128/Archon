import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { normalizeProposal, proposalSchema } from './contract';
import {
  git,
  loadCatalog,
  readJson,
  repoRoot,
  resolveSelectionBase,
  skillRoot,
  snapshot,
  writeJson,
} from './io';
import { prove, validateRunnable, validateSelection } from './runner';

const help = `verify-archon catalog --json
verify-archon snapshot [--repo PATH] [--base REF]
verify-archon normalize-selection PROPOSAL.json [--repo PATH] [--base REF] [--historical] [--out PATH]
verify-archon validate-selection SELECTION.json [--repo PATH] [--base REF] [--historical]
verify-archon prove --selection SELECTION.json [--repo PATH] [--base REF] [--historical] [--evidence-root PATH]
verify-archon prove --scenario ID [--scenario ID ...] [--repo PATH] [--evidence-root PATH]

Catalog manifests define behavior and executable scenario IDs. Selection proof
requires a normalized selection and a clean product checkout. Scenario mode is
diagnostic; it does not establish complete coverage of a change. Repeated IDs
are rejected. Every proof builds the target UI when browser scenarios are used.

Compatibility: features = catalog; prove FEATURE runs all that feature's
scenarios in diagnostic mode. launch/doctor/cleanup/cli/http/status/evidence
remain available through the isolated CLI/API runtime.
`;

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const command = args[0] ?? 'help';
    if (
      ['launch', 'doctor', 'cleanup', 'cli', 'http', 'status', 'evidence', 'drive'].includes(
        command
      )
    ) {
      const child = Bun.spawn(['bash', join(skillRoot, 'bin/runtime'), ...args], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      process.exitCode = await child.exited;
      return;
    }
    if (['help', '--help', '-h'].includes(command)) {
      process.stdout.write(help);
      return;
    }
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        repo: { type: 'string' },
        base: { type: 'string' },
        historical: { type: 'boolean' },
        out: { type: 'string' },
        selection: { type: 'string' },
        scenario: { type: 'string', multiple: true },
        'evidence-root': { type: 'string' },
      },
    });
    const catalog = await loadCatalog();
    if (command === 'catalog' || command === 'features') {
      print({ version: 1, catalog_sha256: catalog.sha256, features: catalog.features });
      return;
    }
    const repo = (
      await git(resolve(values.repo ?? repoRoot), ['rev-parse', '--show-toplevel'])
    ).trim();
    if (command === 'snapshot') {
      print(await snapshot(repo, values.base ?? 'HEAD'));
      return;
    }
    if (command === 'normalize-selection') {
      const path = positionals[0];
      if (!path || positionals.length !== 1)
        throw new Error('normalize-selection requires one proposal JSON path');
      const output = resolve(values.out ?? join(skillRoot, 'evidence/last-select/selection.json'));
      // An unsuccessful attempt must not leave an older selection reusable at this path.
      await rm(output, { force: true });
      if (values.historical && !values.base)
        throw new Error('Historical selection requires an explicit --base REF.');
      const mode = values.historical ? 'historical' : 'change';
      const base = await resolveSelectionBase(repo, values.base);
      const proposal = proposalSchema.parse(await readJson(resolve(path)));
      const selected = normalizeProposal(catalog, proposal, await snapshot(repo, base), mode);
      const checkDir = await mkdtemp(join(tmpdir(), 'archon-selection-'));
      await validateRunnable(catalog, selected.scenario_ids, checkDir);
      await mkdir(dirname(output), { recursive: true });
      await writeJson(output, selected);
      print({ ok: true, output_path: output, selection: selected });
      return;
    }
    if (command === 'validate-selection') {
      const path = positionals[0];
      if (!path || positionals.length !== 1)
        throw new Error('validate-selection requires one normalized JSON path');
      if (values.historical && !values.base)
        throw new Error('Historical selection requires an explicit --base REF.');
      const mode = values.historical ? 'historical' : 'change';
      const base = await resolveSelectionBase(repo, values.base);
      const selected = await validateSelection(
        catalog,
        repo,
        await readJson(resolve(path)),
        base,
        mode
      );
      const checkDir = await mkdtemp(join(tmpdir(), 'archon-selection-'));
      await validateRunnable(catalog, selected.scenario_ids, checkDir);
      print({ ok: true, selection: selected });
      return;
    }
    if (command === 'prove') {
      const selectionMode = values.selection !== undefined;
      const scenarioMode = (values.scenario?.length ?? 0) > 0;
      const featureMode = positionals.length === 1;
      if (
        Number(selectionMode) + Number(scenarioMode) + Number(featureMode) !== 1 ||
        positionals.length > 1
      ) {
        throw new Error(
          'Choose exactly one: --selection FILE, --scenario ID, or a feature ID. There is no default smoke.'
        );
      }
      if (values.selection && values.historical && !values.base)
        throw new Error('Historical selection requires an explicit --base REF.');
      const mode = values.historical ? 'historical' : 'change';
      const base = values.selection ? await resolveSelectionBase(repo, values.base) : 'HEAD';
      const selected = values.selection
        ? await validateSelection(
            catalog,
            repo,
            await readJson(resolve(values.selection)),
            base,
            mode
          )
        : undefined;
      let ids = selected?.scenario_ids ?? values.scenario ?? [];
      if (featureMode) {
        const feature = catalog.features.find(item => item.id === positionals[0]);
        if (!feature) throw new Error(`Unknown feature: ${positionals[0]}`);
        ids = [...new Set(feature.behaviors.flatMap(item => item.scenarios))].sort();
      }
      const evidenceRoot =
        values['evidence-root'] ??
        join(process.env.ARCHON_VERIFY_EVIDENCE ?? join(skillRoot, 'evidence'), 'runs');
      const result = await prove(catalog, repo, ids, evidenceRoot, selected, base, mode);
      print(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    print({ ok: false, verdict: 'FAIL', error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}
