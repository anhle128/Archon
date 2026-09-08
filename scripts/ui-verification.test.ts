import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import rootPackage from '../package.json';
import workflowPackage from '../packages/workflows/package.json';
import {
  candidateTree,
  checkPlaywright,
  COMMANDS,
  freeze,
  gate,
  imageHash,
  manifestSchema,
  parseReference,
  pushVerifiedCommit,
  reviewFailures,
  runOwnedCommand,
  type Manifest,
  type Review,
} from '../.archon/scripts/ui-verification';
import { parseWorkflow } from '../packages/workflows/src/loader';
import { applyRouteLoopTransition } from '../packages/workflows/src/route-loop-state';
import { isRouteLoopNode } from '../packages/workflows/src/schemas/dag-node';
import { registerBuiltinProviders } from '@archon/providers';

const scratch: string[] = [];
const verificationEnv = process.env;
const bindingKeys = [
  'UI_VERIFY_AUTHORITY',
  'UI_VERIFY_LOCK',
  'UI_VERIFY_CHECKS',
  'UI_VERIFY_REVIEW',
];
const savedBindings = Object.fromEntries(bindingKeys.map(key => [key, verificationEnv[key]]));
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
  for (const key of bindingKeys) {
    if (savedBindings[key] === undefined) delete verificationEnv[key];
    else verificationEnv[key] = savedBindings[key];
  }
});
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'archon-ui-gate-test-'));
  scratch.push(path);
  return path;
}
test('declares the schema dependency used by the root workflow helper', () => {
  expect(rootPackage.devDependencies['@hono/zod-openapi']).toBe(
    workflowPackage.dependencies['@hono/zod-openapi']
  );
});
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function put(root: string, path: string, value: string | unknown): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
function digest(root: string, path: string): string {
  return createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
}
function repo(): string {
  const root = temporary();
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Gate Test');
  git(root, 'config', 'user.email', 'gate-test@example.invalid');
  put(root, 'packages/web/src/view.ts', 'export const closed = true;\n');
  put(root, 'docs/source.md', 'The room starts closed.\n');
  put(root, 'e2e/ui/room.spec.ts', '// A frozen test source for gate unit checks.\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'test: seed gate repository');
  return root;
}
function manifest(): Manifest {
  return manifestSchema.parse({
    requirements: [{ id: 'closed', source: 'docs/source.md', quote: 'The room starts closed.' }],
    criteria: [
      {
        id: 'console-closed',
        requirementIds: ['closed'],
        surface: 'console',
        state: 'plain run',
        viewport: { width: 1440, height: 1000 },
        test: { file: 'e2e/ui/room.spec.ts', title: 'room closes' },
        visual: null,
      },
    ],
    unitTests: [],
    mockedExternals: ['provider'],
  });
}
function report(root: string, title = 'room closes', status = 'passed'): unknown {
  return {
    config: { rootDir: join(root, 'e2e/ui') },
    errors: [],
    suites: [
      {
        title: 'room.spec.ts',
        specs: [
          {
            title,
            file: 'room.spec.ts',
            tests: [
              {
                expectedStatus: status === 'skipped' ? 'skipped' : 'passed',
                status: status === 'passed' ? 'expected' : status,
                results: [{ status }],
              },
            ],
          },
        ],
      },
    ],
  };
}
function checks(candidate = 'tree'): Parameters<typeof reviewFailures>[1] {
  return {
    candidate,
    round: 'round',
    directory: '/evidence/round',
    report: '/evidence/round/playwright.json',
    reportDigest: 'test-report',
    images: {},
    errors: [],
    commands: COMMANDS.map(command => ({ ...command, exitCode: 0, log: `${command.id}.log` })),
  };
}
function review(candidate = 'tree'): Review {
  return {
    candidate,
    round: 'round',
    findings: [],
    criteria: [
      {
        id: 'console-closed',
        passed: true,
        browserVerified: true,
        imagesViewed: false,
        observations: 'Closing the room restores the main view.',
      },
    ],
    thirdParty: {
      allTicked: true,
      unticked: [],
      anchors: [
        {
          service: 'provider',
          paths: ['e2e/ui/room.spec.ts'],
          reasoning: 'Unit-test anchor path for gate validation.',
        },
      ],
    },
  };
}

test('explicit issue and PR inputs are validated as URLs, without shell interpretation', () => {
  expect(parseReference('https://github.com/anhle128/Archon/issues/144', 'issues')).toEqual({
    repo: 'anhle128/Archon',
    number: '144',
  });
  expect(() => parseReference('144', 'issues')).toThrow();
  expect(() =>
    parseReference('https://github.com/anhle128/Archon/pull/4;touch x', 'pull')
  ).toThrow();
  expect(() => parseReference('https://github.com.evil.invalid/a/b/pull/4', 'pull')).toThrow();
  expect(() => parseReference(undefined, 'issues')).toThrow();
});

test('candidate includes staged and unstaged new files and dirty content without changing the real index', () => {
  const root = repo();
  const baseline = git(root, 'rev-parse', 'HEAD');
  const original = candidateTree(root);
  put(root, 'e2e/ui/new.spec.ts', '// new acceptance\n');
  const untracked = candidateTree(root, baseline);
  expect(untracked).not.toBe(original);
  git(root, 'add', 'e2e/ui/new.spec.ts');
  const realIndex = git(root, 'write-tree');
  expect(candidateTree(root, baseline)).toBe(untracked);
  put(root, 'packages/web/src/view.ts', 'export const closed = false;\n');
  const dirty = candidateTree(root, baseline);
  expect(dirty).not.toBe(untracked);
  expect(git(root, 'write-tree')).toBe(realIndex);
  expect(git(root, 'show', `${dirty}:e2e/ui/new.spec.ts`)).toBe('// new acceptance');
  put(root, 'private.txt', 'unrelated');
  git(root, 'add', 'private.txt');
  expect(() => candidateTree(root, baseline)).toThrow('Unapproved new candidate file');
  git(root, 'commit', '-qm', 'test: simulate engine checkpoint');
  expect(() => candidateTree(root, baseline)).toThrow('Unapproved new candidate file');
});

test('candidate accepts JavaScript module fixtures without allowing module files elsewhere', () => {
  const root = repo();
  const fixture = 'e2e/fixtures/plannotator/e2e-plannotator.mjs';
  put(root, fixture, 'export const fixture = true;');
  const tree = candidateTree(root);
  expect(git(root, 'show', `${tree}:${fixture}`)).toBe('export const fixture = true;');
  for (const path of ['e2e/lib/extra.mjs', 'packages/providers/src/e2e-fake/extra.mjs']) {
    put(root, path, 'export const unexpected = true;');
    expect(() => candidateTree(root)).toThrow(`Unapproved new candidate file: ${path}`);
    rmSync(join(root, path));
  }
});

test('author can extend only existing fake-provider support before freeze; the gate locks test and CI infrastructure afterward', () => {
  const root = repo();
  const dir = temporary();
  const providerFiles = [
    'packages/providers/src/e2e-fake/provider.ts',
    'packages/providers/src/e2e-fake/provider.test.ts',
  ];
  const ciFiles = ['.github/workflows/pr-e2e-verify.yml', '.github/workflows/test.yml'];
  const protectedOwnerFiles = [
    'migrations/000_combined.sql',
    'packages/core/src/db/adapters/sqlite.ts',
    'packages/core/src/db/bundled-schema.generated.ts',
    'packages/web/src/experiments/console/console-isolation.test.ts',
    'packages/server/src/routes/api.auth.test.ts',
    'packages/server/src/routes/api.workflow-runs.test.ts',
    'packages/core/src/operations/workflow-operations.test.ts',
  ];
  const frozenFiles = [...providerFiles, ...ciFiles, ...protectedOwnerFiles];
  const forbiddenFiles = [
    'packages/providers/src/claude/provider.ts',
    'packages/providers/src/types.ts',
    'packages/providers/src/e2e-fake/capabilities.ts',
    'packages/web/src/view.ts',
    ...ciFiles,
  ];
  for (const path of [...frozenFiles, ...forbiddenFiles]) put(root, path, '// original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'test: seed provider boundary');
  const source = manifest();
  source.criteria = (['console', 'legacy'] as const).flatMap(surface =>
    [
      [1440, 1000],
      [1280, 900],
      [390, 844],
      [768, 1024],
    ].map(([width, height]) => ({
      ...source.criteria[0],
      id: `${surface}-${width}`,
      surface,
      viewport: { width, height },
      visual: {
        source: 'docs/source.md',
        actual: `${surface}-${width}-actual.png`,
        reference: `${surface}-${width}-reference.png`,
      },
    }))
  );
  put(dir, 'manifest.json', source);
  put(dir, 'author-notes.md', 'Contract fixture for the authoring-boundary unit test.');
  put(dir, 'controller.mjs', '// frozen executable');
  put(dir, 'sources/docs/source.md', 'The room starts closed.\n');
  put(dir, 'authority.json', {
    runId: 'test-run',
    root,
    head: git(root, 'rev-parse', 'HEAD'),
    prRepo: 'a/b',
    issueRepo: 'a/b',
    files: { 'docs/source.md': digest(root, 'docs/source.md') },
    artifacts: { 'sources/docs/source.md': digest(dir, 'sources/docs/source.md') },
    controller: digest(dir, 'controller.mjs'),
  });
  verificationEnv.UI_VERIFY_AUTHORITY = JSON.stringify({
    authorityDigest: digest(dir, 'authority.json'),
    controllerDigest: digest(dir, 'controller.mjs'),
  });
  verificationEnv.UI_VERIFY_REVIEW = JSON.stringify({
    complete: true,
    missing: [],
    sourcePaths: ['docs/source.md'],
    criterionIds: source.criteria.map(row => row.id),
  });
  for (const path of forbiddenFiles) {
    put(root, path, '// forbidden author change\n');
    expect(() => freeze(root, dir)).toThrow(`Author changed a non-test file: ${path}`);
    put(root, path, '// original\n');
  }
  for (const path of providerFiles) put(root, path, '// test-only scenario support\n');
  freeze(root, dir);
  const lock = JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  for (const path of frozenFiles) expect(lock.files[path]).toBe(digest(root, path));
  expect(lock.files['packages/web/src/view.ts']).toBeUndefined();
  verificationEnv.UI_VERIFY_LOCK = JSON.stringify({ lockDigest: digest(dir, 'lock.json') });
  const directory = join(dir, 'rounds/round');
  const current = { candidate: candidateTree(root), round: 'round', directory };
  put(dir, 'current.json', current);
  put(directory, 'checks.json', {});
  verificationEnv.UI_VERIFY_CHECKS = JSON.stringify({
    ...current,
    checksDigest: digest(directory, 'checks.json'),
  });
  for (const path of frozenFiles) {
    const original = readFileSync(join(root, path), 'utf8');
    put(root, path, '// forbidden post-freeze change\n');
    expect(gate(root, dir, true).findings).toContain(`Locked file changed: ${path}`);
    put(root, path, original);
  }
});

test('Playwright paths use config.rootDir; required skipped/missing/duplicate tests fail', () => {
  const root = '/test/repo';
  expect(checkPlaywright(report(root), manifest(), root)).toEqual([]);
  expect(
    checkPlaywright(report(root, 'room closes', 'skipped'), manifest(), root).join()
  ).toContain('No passing test for criterion');
  expect(checkPlaywright(report(root, 'different title'), manifest(), root).join()).toContain(
    'No passing test for criterion'
  );
  const unrelated = report(root, 'old deferred feature', 'skipped') as { suites: unknown[] };
  const passing = report(root) as { suites: unknown[] };
  expect(
    checkPlaywright(
      { ...passing, suites: [...passing.suites, ...unrelated.suites] },
      manifest(),
      root
    )
  ).toEqual([]);
  expect(
    checkPlaywright(
      { ...passing, suites: [...passing.suites, ...passing.suites] },
      manifest(),
      root
    ).join()
  ).toContain('Duplicate test');
});

test('describe titles distinguish Console and Legacy with the same leaf title', () => {
  const root = '/test/repo';
  const leaf = {
    title: 'room closes',
    file: 'room.spec.ts',
    tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }],
  };
  const source = manifest();
  source.criteria[0].test.title = 'Console › room closes';
  source.criteria.push({
    ...source.criteria[0],
    id: 'legacy-closed',
    surface: 'legacy',
    test: { file: 'e2e/ui/room.spec.ts', title: 'Legacy › room closes' },
  });
  expect(
    checkPlaywright(
      {
        config: { rootDir: join(root, 'e2e/ui') },
        suites: [
          {
            title: 'room.spec.ts',
            suites: [
              { title: 'Console', specs: [leaf] },
              { title: 'Legacy', specs: [leaf] },
            ],
          },
        ],
      },
      source,
      root
    )
  ).toEqual([]);
});

test('review cannot pass incomplete criteria, stale candidates, missing anchors or failed commands', () => {
  expect(reviewFailures(manifest(), checks(), review())).toEqual([]);
  const cases: Array<(value: Review, result: ReturnType<typeof checks>) => void> = [
    value => {
      value.criteria = [];
    },
    value => {
      value.criteria.push(value.criteria[0]);
    },
    value => {
      value.criteria[0].browserVerified = false;
    },
    value => {
      value.criteria[0].passed = false;
    },
    value => {
      value.candidate = 'old';
    },
    value => {
      value.round = 'old';
    },
    value => {
      value.thirdParty.anchors = [];
    },
    value => {
      value.thirdParty.unticked = ['provider'];
    },
    (_value, result) => {
      result.commands[0].exitCode = 1;
    },
    (_value, result) => {
      result.commands.pop();
    },
    (_value, result) => {
      result.commands[0].argv = ['true'];
    },
  ];
  for (const change of cases) {
    const value = review();
    const result = checks();
    change(value, result);
    expect(reviewFailures(manifest(), result, value).length).toBeGreaterThan(0);
  }
});

test('real gate rejects changed text or binary authority, tests, stale candidates and missing images', () => {
  const root = repo();
  const dir = temporary();
  const directory = join(dir, 'rounds/round');
  const source = manifest();
  const referencePath = 'docs/reference.png';
  const referenceBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=',
    'base64'
  );
  writeFileSync(join(root, referencePath), referenceBytes);
  git(root, 'add', referencePath);
  git(root, 'commit', '-qm', 'test: pin binary reference');
  mkdirSync(join(dir, 'sources/docs'), { recursive: true });
  writeFileSync(join(dir, 'sources', referencePath), referenceBytes);
  const candidate = candidateTree(root);
  put(dir, 'manifest.json', source);
  put(dir, 'controller.mjs', '// frozen executable');
  put(dir, 'authority.json', {
    runId: 'test-run',
    root,
    head: git(root, 'rev-parse', 'HEAD'),
    prRepo: 'a/b',
    issueRepo: 'a/b',
    files: {
      'docs/source.md': digest(root, 'docs/source.md'),
      [referencePath]: digest(root, referencePath),
    },
    artifacts: { [`sources/${referencePath}`]: digest(dir, `sources/${referencePath}`) },
    controller: digest(dir, 'controller.mjs'),
  });
  put(dir, 'lock.json', {
    files: { 'e2e/ui/room.spec.ts': digest(root, 'e2e/ui/room.spec.ts') },
    artifacts: { 'manifest.json': digest(dir, 'manifest.json') },
    authority: digest(dir, 'authority.json'),
  });
  const current = { candidate, round: 'round', directory };
  put(dir, 'current.json', current);
  put(directory, 'playwright.json', report(root));
  put(directory, 'checks.json', {
    ...checks(candidate),
    ...current,
    report: join(directory, 'playwright.json'),
    reportDigest: digest(directory, 'playwright.json'),
  });
  verificationEnv.UI_VERIFY_AUTHORITY = JSON.stringify({
    authorityDigest: digest(dir, 'authority.json'),
    controllerDigest: digest(dir, 'controller.mjs'),
  });
  verificationEnv.UI_VERIFY_LOCK = JSON.stringify({ lockDigest: digest(dir, 'lock.json') });
  verificationEnv.UI_VERIFY_CHECKS = JSON.stringify({
    ...current,
    checksDigest: digest(directory, 'checks.json'),
  });
  put(directory, 'review.json', review(candidate));
  expect(gate(root, dir, true).passed).toBe(true);
  const changedReference = Buffer.from(referenceBytes);
  changedReference[changedReference.length - 1] ^= 1;
  for (const [referenceRoot, path] of [
    [root, referencePath],
    [dir, `sources/${referencePath}`],
  ]) {
    writeFileSync(join(referenceRoot, path), changedReference);
    expect(gate(root, dir, true).findings).toContain(`Locked file changed: ${path}`);
    writeFileSync(join(referenceRoot, path), referenceBytes);
  }
  expect(gate(root, dir, true).passed).toBe(true);
  const originalLock = readFileSync(join(dir, 'lock.json'), 'utf8');
  put(dir, 'lock.json', {});
  expect(gate(root, dir, true).findings.join()).toContain('Lock record changed');
  put(dir, 'lock.json', originalLock);
  const originalChecks = readFileSync(join(directory, 'checks.json'), 'utf8');
  put(directory, 'checks.json', {});
  expect(gate(root, dir, true).findings.join()).toContain('Checks record changed');
  put(directory, 'checks.json', originalChecks);
  put(directory, 'playwright.json', {});
  expect(gate(root, dir, true).findings.join()).toContain('Playwright report changed');
  put(directory, 'playwright.json', report(root));
  put(root, 'docs/source.md', 'Weakened source');
  expect(gate(root, dir, true).findings.join()).toContain('Locked file changed');
  put(root, 'docs/source.md', 'The room starts closed.\n');
  put(root, 'e2e/ui/room.spec.ts', '// weakened test');
  expect(gate(root, dir, true).findings.join()).toContain('Locked file changed');
  put(root, 'e2e/ui/room.spec.ts', '// A frozen test source for gate unit checks.\n');
  put(root, 'packages/web/src/view.ts', 'export const closed = false;\n');
  expect(gate(root, dir, true).findings.join()).toContain('Candidate changed');
  expect(() => imageHash(directory, 'missing.png', { width: 1440, height: 1000 })).toThrow();
  put(directory, 'fake.png', 'Not a browser image');
  expect(() => imageHash(directory, 'fake.png', { width: 1440, height: 1000 })).toThrow(
    'invalid PNG'
  );
});

test('publication accepts only the verified direct child and rejects remote advance, rewind and deletion', () => {
  const root = repo();
  const remote = temporary();
  git(remote, 'init', '--bare', '-q');
  const parent = git(root, 'rev-parse', 'HEAD');
  const tree = candidateTree(root);
  const branch = 'refs/heads/candidate';
  git(root, 'push', '-q', remote, `${parent}:${branch}`);
  const child = git(root, 'commit-tree', tree, '-p', parent, '-m', 'test: verified child');
  pushVerifiedCommit(root, remote, branch, parent, tree, child);
  expect(git(remote, 'rev-parse', branch)).toBe(child);
  expect(() => pushVerifiedCommit(root, remote, branch, parent, tree, child)).toThrow();
  const next = git(root, 'commit-tree', tree, '-p', child, '-m', 'test: next child');
  git(remote, 'update-ref', branch, parent);
  expect(() => pushVerifiedCommit(root, remote, branch, child, tree, next)).toThrow();
  git(remote, 'update-ref', '-d', branch);
  expect(() => pushVerifiedCommit(root, remote, branch, child, tree, next)).toThrow();
  expect(() => pushVerifiedCommit(root, remote, branch, parent, tree, next)).toThrow(
    'direct child'
  );
});

test.skipIf(process.platform === 'win32')(
  'timeout stops the owned command and its descendant',
  async () => {
    const root = temporary();
    const marker = join(root, 'child-pid');
    const childCode = 'setInterval(() => {}, 1000)';
    const wrapper = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const p=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); writeFileSync(${JSON.stringify(marker)},String(p.pid)); setInterval(()=>{},1000);`;
    const result = await runOwnedCommand(
      root,
      { id: 'owned-timeout', cwd: '.', argv: [process.execPath, '-e', wrapper] },
      join(root, 'command.log'),
      process.env,
      500
    );
    expect(result).toBe(-1);
    const pid = Number(readFileSync(marker, 'utf8'));
    await Bun.sleep(100);
    expect(() => process.kill(pid, 0)).toThrow();
  }
);

test('the real route controller runs at most the configured repairs, then fails exhaustion', async () => {
  registerBuiltinProviders();
  const workflow = parseWorkflow(
    readFileSync(join(import.meta.dir, '../.archon/workflows/pr-e2e-verify.yaml'), 'utf8'),
    'pr-e2e-verify.yaml'
  );
  expect(workflow.error).toBeNull();
  const controller = workflow.workflow?.nodes.find(node => node.id === 'gate');
  if (!controller || !isRouteLoopNode(controller)) throw new Error('Missing route controller');
  let metadata: Record<string, unknown> = {};
  const outcomes: string[] = [];
  for (let index = 0; index <= controller.route_loop.max_iterations; index += 1) {
    const result = applyRouteLoopTransition({
      metadata,
      routeLoopNodeId: 'gate',
      routeLoop: controller.route_loop,
      sourceNodeIds: ['acceptance'],
      conditionResult: false,
    });
    metadata = result.metadata;
    outcomes.push(result.eventData.to);
  }
  expect(outcomes).toEqual([
    'diagnose',
    'diagnose',
    'diagnose',
    'diagnose',
    'diagnose',
    'exhausted',
  ]);
  const root = temporary();
  put(root, 'ui-verification/current.json', { candidate: 'tree', round: 'round', directory: root });
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, '../.archon/scripts/ui-verification.ts'), 'exhausted'],
    { env: { ...process.env, ARTIFACTS_DIR: root }, stdout: 'pipe', stderr: 'pipe' }
  );
  expect(await proc.exited).toBe(1);
  expect(await new Response(proc.stderr).text()).toContain('Repair budget exhausted');
});
