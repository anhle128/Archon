#!/usr/bin/env bun
/** Candidate-bound evidence gate for the project-local pr-e2e-verify workflow. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { z } from '@hono/zod-openapi';

const environment = process.env;
const textSchema = z.string().min(1);
const hashesSchema = z.record(z.string(), textSchema);
const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const criterionSchema = z.object({
  id: textSchema,
  requirementIds: z.array(textSchema).min(1),
  surface: z.enum(['console', 'legacy', 'shared']),
  state: textSchema,
  viewport: viewportSchema,
  test: z.object({ file: textSchema, title: textSchema }),
  visual: z.object({ source: textSchema, actual: textSchema, reference: textSchema }).nullable(),
});
export const manifestSchema = z
  .object({
    requirements: z
      .array(z.object({ id: textSchema, source: textSchema, quote: textSchema }))
      .min(1),
    criteria: z.array(criterionSchema).min(1),
    unitTests: z.array(textSchema),
    mockedExternals: z.array(textSchema),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
const auditSchema = z.object({
  complete: z.boolean(),
  missing: z.array(textSchema),
  sourcePaths: z.array(textSchema),
  criterionIds: z.array(textSchema),
});
export const reviewSchema = z.object({
  candidate: textSchema,
  round: textSchema,
  criteria: z.array(
    z.object({
      id: textSchema,
      passed: z.boolean(),
      browserVerified: z.boolean(),
      imagesViewed: z.boolean(),
      observations: textSchema,
    })
  ),
  thirdParty: z.object({
    allTicked: z.boolean(),
    unticked: z.array(textSchema),
    anchors: z.array(
      z.object({ service: textSchema, paths: z.array(textSchema).min(1), reasoning: textSchema })
    ),
  }),
  findings: z.array(textSchema),
});
export type Review = z.infer<typeof reviewSchema>;
const prSchema = z
  .object({
    number: z.number().int(),
    title: textSchema,
    body: z.string(),
    url: textSchema,
    headRefName: textSchema,
    headRefOid: textSchema,
    baseRefName: textSchema,
    baseRefOid: textSchema,
    state: z.literal('OPEN'),
    headRepository: z.object({ name: textSchema }),
    headRepositoryOwner: z.object({ login: textSchema }),
  })
  .passthrough();
const issueSchema = z
  .object({ number: z.number().int(), title: textSchema, body: textSchema, url: textSchema })
  .passthrough();
const authoritySchema = z.object({
  runId: textSchema,
  root: textSchema,
  head: textSchema,
  prRepo: textSchema,
  issueRepo: textSchema,
  files: hashesSchema,
  artifacts: hashesSchema,
  controller: textSchema,
});
const lockSchema = z.object({
  files: hashesSchema,
  artifacts: hashesSchema,
  authority: textSchema,
});
const currentSchema = z.object({ candidate: textSchema, round: textSchema, directory: textSchema });
const commandSchema = z.object({
  id: textSchema,
  cwd: textSchema,
  argv: z.array(textSchema).min(1),
});
type Command = z.infer<typeof commandSchema>;
const checksSchema = currentSchema.extend({
  commands: z.array(commandSchema.extend({ exitCode: z.number().int(), log: textSchema })),
  errors: z.array(textSchema),
  images: hashesSchema,
  report: textSchema,
  reportDigest: z.string(),
});
type Checks = z.infer<typeof checksSchema>;

export const COMMANDS: readonly Command[] = [
  { id: 'install', cwd: '.', argv: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'e2e-install', cwd: 'e2e', argv: ['npm', 'ci'] },
  {
    id: 'browser-install',
    cwd: 'e2e',
    argv: ['npx', '--no-install', 'playwright', 'install', 'chromium'],
  },
  { id: 'build-web', cwd: '.', argv: ['bun', 'run', 'build:web'] },
  { id: 'e2e-types', cwd: 'e2e', argv: ['npm', 'run', 'typecheck'] },
  {
    id: 'e2e',
    cwd: 'e2e',
    argv: [
      'npm',
      'run',
      'test:ui',
      '--',
      '--reporter=json',
      '--workers=1',
      '--retries=0',
      '--forbid-only',
    ],
  },
  { id: 'validate', cwd: '.', argv: ['bun', 'run', 'validate'] },
];

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function hash(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
function save(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
function exec(
  cwd: string,
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv = environment
): string {
  return execFileSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}
function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return exec(cwd, 'git', args, env);
}
function safePath(root: string, path: string): string {
  ensure(
    !isAbsolute(path) && path.length > 0 && !path.split(/[\\/]/).includes('..'),
    `Unsafe relative path: ${path}`
  );
  const target = resolve(root, path);
  ensure(target.startsWith(`${resolve(root)}${sep}`), `Path leaves root: ${path}`);
  return target;
}
function fileHash(root: string, path: string): string {
  const target = safePath(root, path);
  ensure(lstatSync(target).isFile(), `Not a regular file: ${path}`);
  ensure(
    realpathSync(target).startsWith(`${realpathSync(root)}${sep}`),
    `Symlink leaves root: ${path}`
  );
  return hash(readFileSync(target));
}
function fileHashes(root: string, paths: string[]): Record<string, string> {
  return Object.fromEntries([...new Set(paths)].sort().map(path => [path, fileHash(root, path)]));
}
function sameSet(actual: string[], expected: string[], label: string): void {
  ensure(new Set(actual).size === actual.length, `${label}: duplicate entries`);
  ensure(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label}: missing or unexpected entries`
  );
}
function assertHashes(root: string, files: Record<string, string>): void {
  for (const [path, expected] of Object.entries(files))
    ensure(fileHash(root, path) === expected, `Locked file changed: ${path}`);
}
function listFiles(root: string): string[] {
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
}

function criticalFiles(root: string): string[] {
  return listFiles(root).filter(
    path =>
      path.startsWith('e2e/') ||
      path.startsWith('.archon/scripts/') ||
      path.startsWith('scripts/') ||
      path.startsWith('packages/providers/src/e2e-fake/') ||
      /\/src\/test\//.test(path) ||
      path === '.archon/workflows/pr-e2e-verify.yaml' ||
      /(^|\/)(package\.json|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|[^/]*\.config\.[^/]+|tsconfig[^/]*\.json|bunfig\.toml|\.gitignore|\.prettierignore|\.prettierrc[^/]*)$/.test(
        path
      )
  );
}
function allowedNewFile(path: string): boolean {
  return (
    /^(packages\/[^/]+\/src\/|e2e\/(ui|lib|fixtures)\/|scripts\/|docs\/)/.test(path) &&
    /\.(tsx?|jsx?|json|ya?ml|css|html|md|png|webp|svg)$/.test(path) &&
    !/(^|\/)(node_modules|reports|test-results|dist)(\/|$)/.test(path)
  );
}

/** A temporary index includes current tracked bytes, deletions, modes and allowed new files. */
export function candidateTree(root: string, baseline = 'HEAD'): string {
  const original = new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', baseline]).split('\0'));
  const fresh = [...new Set(listFiles(root))].filter(path => !original.has(path));
  for (const path of fresh) {
    ensure(allowedNewFile(path), `Unapproved new candidate file: ${path}`);
    fileHash(root, path);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'archon-ui-index-'));
  try {
    const env = { ...environment, GIT_INDEX_FILE: join(scratch, 'index') };
    git(root, ['read-tree', 'HEAD'], env);
    git(root, ['add', '-u', '--', '.'], env);
    if (fresh.length) git(root, ['add', '--', ...fresh], env);
    return git(root, ['write-tree'], env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function parseReference(
  value: string | undefined,
  kind: 'pull' | 'issues'
): { repo: string; number: string } {
  ensure(value, `Missing required ${kind} URL input`);
  const url = new URL(value);
  const match = new RegExp(`^/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/${kind}/([1-9][0-9]*)/?$`).exec(
    url.pathname
  );
  ensure(
    url.origin === 'https://github.com' && !url.search && !url.hash && !url.username && match,
    `Expected a full GitHub ${kind} URL`
  );
  return { repo: match[1], number: match[2] };
}

async function initialize(root: string, dir: string): Promise<void> {
  ensure(
    !existsSync(join(dir, 'authority.json')),
    'Authority already exists; start a new run to change the contract'
  );
  ensure(
    !git(root, ['status', '--porcelain']),
    'Initialization requires a clean isolated worktree'
  );
  const common = realpathSync(resolve(root, git(root, ['rev-parse', '--git-common-dir'])));
  ensure(realpathSync(root) !== dirname(common), 'Refusing to switch the canonical checkout');
  const prRef = parseReference(environment.INPUTS_PR, 'pull');
  const issueRef = parseReference(environment.INPUTS_ISSUE, 'issues');
  const pr = prSchema.parse(
    JSON.parse(
      exec(root, 'gh', [
        'pr',
        'view',
        prRef.number,
        '--repo',
        prRef.repo,
        '--json',
        'number,title,body,url,headRefName,headRefOid,baseRefName,baseRefOid,state,headRepository,headRepositoryOwner,files',
      ])
    )
  );
  const issue = issueSchema.parse(
    JSON.parse(
      exec(root, 'gh', [
        'issue',
        'view',
        issueRef.number,
        '--repo',
        issueRef.repo,
        '--json',
        'number,title,body,url,updatedAt',
      ])
    )
  );
  mkdirSync(dir, { recursive: true });
  const controller = join(dir, 'controller.mjs');
  const build = await Bun.build({
    entrypoints: [join(root, '.archon/scripts/ui-verification.ts')],
    target: 'bun',
    outdir: dir,
    naming: 'controller.mjs',
  });
  ensure(build.success, `Cannot preserve gate executable: ${build.logs.join('\n')}`);
  git(root, ['fetch', `https://github.com/${prRef.repo}.git`, `refs/pull/${prRef.number}/head`]);
  ensure(git(root, ['rev-parse', 'FETCH_HEAD']) === pr.headRefOid, 'PR head changed during fetch');
  git(root, ['checkout', '--detach', pr.headRefOid]);
  git(root, ['fetch', `https://github.com/${prRef.repo}.git`, pr.baseRefOid]);
  save(join(dir, 'pr.json'), pr);
  save(join(dir, 'issue.json'), issue);
  writeFileSync(join(dir, 'issue.md'), `# ${issue.title}\n\n${issue.body}\n`);
  const files: Record<string, string> = {};
  const links = [...issue.body.matchAll(/https:\/\/github\.com\/[^\s<>"')\]]+/g)].map(
    match => new URL(match[0])
  );
  for (const link of links) {
    const match = /^\/([^/]+\/[^/]+)\/(blob|tree)\/([a-f0-9]{7,40})\/(.+)$/.exec(link.pathname);
    if (!match) {
      ensure(!/\/(blob|tree)\//.test(link.pathname), `Source must pin a commit: ${link.href}`);
      continue;
    }
    const [, repo, kind, ref, rawPath] = match;
    ensure(
      repo === prRef.repo,
      `Cross-repository source needs an explicit supported source import: ${link.href}`
    );
    const path = decodeURIComponent(rawPath);
    safePath(root, path);
    const paths =
      kind === 'tree'
        ? git(root, ['ls-tree', '-r', '--name-only', ref, '--', path]).split('\n').filter(Boolean)
        : [path];
    ensure(paths.length > 0, `Empty source directory: ${path}`);
    for (const source of paths) {
      const bytes = execFileSync('git', ['show', `${ref}:${source}`], { cwd: root });
      ensure(
        fileHash(root, source) === hash(bytes),
        `Source differs from pinned issue authority: ${source}`
      );
      const destination = safePath(join(dir, 'sources'), source);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
      files[source] = hash(bytes);
    }
  }
  ensure(
    Object.keys(files).length > 0,
    'Issue must include complete pinned source document/mockup links'
  );
  const artifacts = fileHashes(dir, [
    'issue.md',
    'issue.json',
    'pr.json',
    ...Object.keys(files).map(path => `sources/${path}`),
  ]);
  save(join(dir, 'authority.json'), {
    runId: textSchema.parse(environment.UI_VERIFY_RUN_ID),
    root,
    head: pr.headRefOid,
    prRepo: prRef.repo,
    issueRepo: issueRef.repo,
    files,
    artifacts,
    controller: hash(readFileSync(controller)),
  });
  process.stdout.write(
    `${JSON.stringify({ directory: dir, head: pr.headRefOid, sources: Object.keys(files), authorityDigest: fileHash(dir, 'authority.json'), controllerDigest: fileHash(dir, 'controller.mjs') })}\n`
  );
}

function authority(root: string, dir: string): z.infer<typeof authoritySchema> {
  const binding = z
    .object({ authorityDigest: textSchema, controllerDigest: textSchema })
    .parse(JSON.parse(environment.UI_VERIFY_AUTHORITY ?? 'null'));
  ensure(
    fileHash(dir, 'authority.json') === binding.authorityDigest,
    'Authority record changed after initialization'
  );
  ensure(
    fileHash(dir, 'controller.mjs') === binding.controllerDigest,
    'Frozen gate executable changed'
  );
  const value = authoritySchema.parse(readJson(join(dir, 'authority.json')));
  ensure(value.root === root, 'Authority belongs to another checkout');
  assertHashes(root, value.files);
  assertHashes(dir, value.artifacts);
  ensure(
    hash(readFileSync(join(dir, 'controller.mjs'))) === value.controller,
    'Frozen gate executable changed'
  );
  return value;
}

function freeze(root: string, dir: string): void {
  const source = authority(root, dir);
  ensure(!existsSync(join(dir, 'lock.json')), 'Contract is already frozen');
  const manifest = manifestSchema.parse(readJson(join(dir, 'manifest.json')));
  const audit = auditSchema.parse(JSON.parse(environment.UI_VERIFY_REVIEW ?? 'null'));
  ensure(
    audit.complete && audit.missing.length === 0,
    `Contract audit incomplete: ${audit.missing.join('; ')}`
  );
  sameSet(audit.sourcePaths, Object.keys(source.files), 'Source audit');
  sameSet(
    audit.criterionIds,
    manifest.criteria.map(row => row.id),
    'Criteria audit'
  );
  sameSet(
    manifest.requirements.map(row => row.id),
    [...new Set(manifest.requirements.map(row => row.id))],
    'Requirements'
  );
  for (const requirement of manifest.requirements) {
    ensure(
      requirement.source === 'issue.md' || requirement.source in source.files,
      `Unknown requirement source: ${requirement.source}`
    );
    const path =
      requirement.source === 'issue.md'
        ? join(dir, 'issue.md')
        : safePath(join(dir, 'sources'), requirement.source);
    ensure(
      readFileSync(path, 'utf8').includes(requirement.quote),
      `Requirement quote absent from source: ${requirement.id}`
    );
    ensure(
      manifest.criteria.some(row => row.requirementIds.includes(requirement.id)),
      `Requirement has no criterion: ${requirement.id}`
    );
  }
  for (const row of manifest.criteria) {
    ensure(
      row.requirementIds.every(id =>
        manifest.requirements.some(requirement => requirement.id === id)
      ),
      `Unknown requirement in criterion: ${row.id}`
    );
    ensure(
      /^e2e\/ui\/.+\.spec\.ts$/.test(row.test.file),
      `Criterion requires a durable E2E spec: ${row.id}`
    );
    fileHash(root, row.test.file);
    if (row.visual) {
      ensure(row.visual.source in source.files, `Unknown visual source: ${row.id}`);
      safePath(dir, row.visual.actual);
      safePath(dir, row.visual.reference);
      ensure(
        row.visual.actual !== row.visual.reference,
        `Actual and reference are the same path: ${row.id}`
      );
    }
  }
  for (const surface of ['console', 'legacy']) {
    for (const [width, height] of [
      [1440, 1000],
      [1280, 900],
      [390, 844],
      [768, 1024],
    ]) {
      ensure(
        manifest.criteria.some(
          row =>
            row.surface === surface &&
            row.viewport.width === width &&
            row.viewport.height === height &&
            row.visual
        ),
        `Missing ${surface} visual viewport ${width}x${height}`
      );
    }
  }
  const changed = git(root, ['diff', '--name-only', source.head, candidateTree(root, source.head)])
    .split('\n')
    .filter(Boolean);
  for (const path of manifest.unitTests)
    ensure(
      /\.test\.tsx?$/.test(path) &&
        git(root, ['ls-tree', '--name-only', source.head, '--', path]) === path,
      `Only existing unit tests can be corrected: ${path}`
    );
  for (const path of changed)
    ensure(
      /^e2e\/(ui|lib|fixtures)\//.test(path) ||
        path === 'e2e/playwright.config.ts' ||
        manifest.unitTests.includes(path),
      `Author changed a non-test file: ${path}`
    );
  save(join(dir, 'audit.json'), audit);
  save(join(dir, 'lock.json'), {
    files: fileHashes(root, [...criticalFiles(root), ...manifest.unitTests]),
    artifacts: fileHashes(dir, ['manifest.json', 'audit.json', 'author-notes.md']),
    authority: fileHash(dir, 'authority.json'),
  });
  process.stdout.write(
    `${JSON.stringify({ frozen: true, criteria: manifest.criteria.length, lockDigest: fileHash(dir, 'lock.json') })}\n`
  );
}

function locked(root: string, dir: string): Manifest {
  authority(root, dir);
  const binding = z
    .object({ lockDigest: textSchema })
    .parse(JSON.parse(environment.UI_VERIFY_LOCK ?? 'null'));
  ensure(fileHash(dir, 'lock.json') === binding.lockDigest, 'Lock record changed after freeze');
  const lock = lockSchema.parse(readJson(join(dir, 'lock.json')));
  ensure(fileHash(dir, 'authority.json') === lock.authority, 'Authority lock changed');
  assertHashes(root, lock.files);
  assertHashes(dir, lock.artifacts);
  for (const path of criticalFiles(root))
    ensure(path in lock.files, `New file changes frozen test infrastructure: ${path}`);
  return manifestSchema.parse(readJson(join(dir, 'manifest.json')));
}

const resultSchema = z.object({ status: textSchema });
const specSchema = z.object({
  title: textSchema,
  file: textSchema,
  tests: z
    .array(
      z.object({ expectedStatus: textSchema, status: textSchema, results: z.array(resultSchema) })
    )
    .min(1),
});
const suiteSchema = z.object({
  title: z.string().default(''),
  specs: z.array(specSchema).default([]),
  suites: z.array(z.unknown()).default([]),
});

/** Every mapped criterion must pass; unrelated pre-existing fixme cases stay outside the contract. */
export function checkPlaywright(
  report: unknown,
  manifest: Manifest,
  root = process.cwd()
): string[] {
  const top = z
    .object({
      config: z.object({ rootDir: textSchema }),
      suites: z.array(z.unknown()),
      errors: z.array(z.unknown()).default([]),
    })
    .parse(report);
  const errors: string[] = top.errors.map(error => `Playwright error: ${JSON.stringify(error)}`);
  const seen = new Map<string, boolean>();
  const visit = (raw: unknown, parents: string[] = []): void => {
    const suite = suiteSchema.parse(raw);
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs) {
      const file = relative(root, resolve(top.config.rootDir, spec.file)).replaceAll('\\', '/');
      // The top suite is the file; nested suite names disambiguate describe blocks.
      const title = [...titles.slice(1), spec.title].join(' › ');
      const key = `${file}\0${title}`;
      if (seen.has(key)) errors.push(`Duplicate test: ${spec.title}`);
      const passed =
        spec.tests.length === 1 &&
        spec.tests.every(
          test =>
            test.expectedStatus === 'passed' &&
            test.status === 'expected' &&
            test.results.length === 1 &&
            test.results.every(result => result.status === 'passed')
        );
      seen.set(key, passed);
      const unrelatedSkip =
        !manifest.criteria.some(row => `${row.test.file}\0${row.test.title}` === key) &&
        spec.tests.every(
          test =>
            test.expectedStatus === 'skipped' &&
            test.results.every(result => result.status === 'skipped')
        );
      if (!passed && !unrelatedSkip) errors.push(`Failed, skipped or retried test: ${spec.title}`);
    }
    suite.suites.forEach(child => visit(child, titles));
  };
  top.suites.forEach(suite => visit(suite));
  if (seen.size === 0) errors.push('No Playwright tests ran');
  for (const row of manifest.criteria)
    if (!seen.get(`${row.test.file}\0${row.test.title}`))
      errors.push(`No passing test for criterion: ${row.id}`);
  return errors;
}

/** Chromium PNGs must contain a complete, nontrivial pixel stream at the requested viewport. */
export function imageHash(
  root: string,
  path: string,
  viewport: z.infer<typeof viewportSchema>
): string {
  const digest = fileHash(root, path);
  const bytes = readFileSync(safePath(root, path));
  ensure(
    bytes.length > 1024 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    `Missing or invalid PNG: ${path}`
  );
  ensure(
    bytes.readUInt32BE(16) === viewport.width && bytes.readUInt32BE(20) >= viewport.height,
    `PNG viewport mismatch: ${path}`
  );
  const chunks: Buffer[] = [];
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    ensure(offset + length + 12 <= bytes.length, `Truncated PNG: ${path}`);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (kind === 'IEND') ended = true;
    offset += length + 12;
  }
  ensure(ended && chunks.length > 0, `Incomplete PNG: ${path}`);
  const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: 128 * 1024 * 1024 });
  ensure(
    pixels.length >= viewport.width * viewport.height * 3 && new Set(pixels).size > 16,
    `Blank or fake PNG: ${path}`
  );
  return digest;
}

function captureHashes(directory: string, manifest: Manifest): Record<string, string> {
  const images: Record<string, string> = {};
  for (const row of manifest.criteria)
    if (row.visual) {
      images[row.visual.actual] = imageHash(directory, row.visual.actual, row.viewport);
      images[row.visual.reference] = imageHash(directory, row.visual.reference, row.viewport);
      ensure(
        images[row.visual.actual] !== images[row.visual.reference],
        `Actual image is a copied reference: ${row.id}`
      );
    }
  return images;
}

/** Each command owns one POSIX process group, including fixture servers and browser children. */
export async function runOwnedCommand(
  root: string,
  command: Command,
  log: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<number> {
  ensure(
    process.platform !== 'win32',
    'Local UI verification currently requires POSIX process-group cleanup'
  );
  const fd = openSync(log, 'w');
  const child = spawn(command.argv[0], command.argv.slice(1), {
    cwd: resolve(root, command.cwd),
    env,
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  const pid = child.pid;
  let timedOut = false;
  let cancelled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalGroup = (signal: NodeJS.Signals): void => {
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const stop = (): void => {
    signalGroup('SIGTERM');
    killTimer ??= setTimeout(() => signalGroup('SIGKILL'), 1000);
  };
  const interrupt = (): void => {
    cancelled = true;
    stop();
  };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  save(`${log}.process.json`, {
    pid,
    command,
    worktree: root,
    processGroup: pid,
    status: 'running',
  });
  try {
    const exitCode = await new Promise<number>((done, reject) => {
      child.once('error', reject);
      child.once('exit', code => done(code ?? -1));
    });
    if (cancelled) throw new Error(`Command interrupted: ${command.id}`);
    return timedOut ? -1 : exitCode;
  } finally {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    signalGroup('SIGTERM');
    // Descendants can outlive a wrapper that exits before its fixture cleanup runs.
    if (pid) {
      try {
        process.kill(-pid, 0);
        await new Promise<void>(done => setTimeout(done, 250));
        signalGroup('SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
    closeSync(fd);
    save(`${log}.process.json`, {
      pid,
      command,
      worktree: root,
      processGroup: pid,
      status: 'stopped',
      timedOut,
      cancelled,
    });
  }
}

async function checks(root: string, dir: string): Promise<void> {
  const round = randomUUID();
  const directory = join(dir, 'rounds', round);
  mkdirSync(directory, { recursive: true });
  const source = authoritySchema.parse(readJson(join(dir, 'authority.json')));
  const current = { candidate: candidateTree(root, source.head), round, directory };
  save(join(dir, 'current.json'), current);
  const result: Checks = {
    ...current,
    commands: [],
    errors: [],
    images: {},
    report: join(directory, 'playwright.json'),
    reportDigest: '',
  };
  try {
    const manifest = locked(root, dir);
    for (const command of COMMANDS) {
      const log = join(directory, `${command.id}.log`);
      const exitCode = await runOwnedCommand(
        root,
        command,
        log,
        {
          ...environment,
          UI_VERIFY_EVIDENCE_DIR: directory,
          PLAYWRIGHT_JSON_OUTPUT_NAME: result.report,
          ARCHON_PW_WORKERS: '1',
        },
        command.id === 'validate' ? 2400000 : 900000
      );
      result.commands.push({ ...command, exitCode, log });
      if (exitCode !== 0) result.errors.push(`Command failed: ${command.id} (exit ${exitCode})`);
      // Stop before E2E when installation or build cannot provide the current bundle.
      if (
        exitCode !== 0 &&
        ['install', 'e2e-install', 'browser-install', 'build-web'].includes(command.id)
      )
        break;
    }
    result.reportDigest = fileHash(directory, 'playwright.json');
    result.errors.push(...checkPlaywright(readJson(result.report), manifest, root));
    result.images = captureHashes(directory, manifest);
    locked(root, dir);
    ensure(
      candidateTree(root, source.head) === current.candidate,
      'Candidate changed during checks'
    );
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  save(join(directory, 'checks.json'), result);
  process.stdout.write(
    `${JSON.stringify({ ...current, errors: result.errors, checksDigest: fileHash(directory, 'checks.json') })}\n`
  );
}

export function reviewFailures(manifest: Manifest, check: Checks, review: Review): string[] {
  const failures = [...check.errors, ...review.findings];
  if (review.candidate !== check.candidate || review.round !== check.round)
    failures.push('Stale review candidate or round');
  try {
    sameSet(
      review.criteria.map(row => row.id),
      manifest.criteria.map(row => row.id),
      'Review criteria'
    );
  } catch (error) {
    failures.push((error as Error).message);
  }
  for (const row of manifest.criteria) {
    const verdict = review.criteria.find(value => value.id === row.id);
    if (!verdict?.passed || !verdict.browserVerified || (row.visual && !verdict.imagesViewed))
      failures.push(`Criterion rejected or incomplete: ${row.id}`);
  }
  if (!review.thirdParty.allTicked || review.thirdParty.unticked.length)
    failures.push(`Third-party coverage incomplete: ${review.thirdParty.unticked.join(', ')}`);
  const services = review.thirdParty.anchors.map(row => row.service);
  if (new Set(services).size !== services.length)
    failures.push('Duplicate third-party anchor service');
  for (const service of manifest.mockedExternals)
    if (!services.includes(service)) failures.push(`Missing real third-party anchor: ${service}`);
  if (check.commands.length !== COMMANDS.length) failures.push('Required commands are missing');
  for (const command of COMMANDS) {
    const executed = check.commands.filter(row => row.id === command.id);
    if (
      executed.length !== 1 ||
      executed[0].exitCode !== 0 ||
      executed[0].cwd !== command.cwd ||
      JSON.stringify(executed[0].argv) !== JSON.stringify(command.argv)
    )
      failures.push(`Command not verified: ${command.id}`);
  }
  return failures;
}

export function gate(
  root: string,
  dir: string,
  publish = false
): { passed: boolean; findings: string[] } {
  const current = currentSchema.parse(readJson(join(dir, 'current.json')));
  const findings: string[] = [];
  try {
    const binding = currentSchema
      .extend({ checksDigest: textSchema })
      .parse(JSON.parse(environment.UI_VERIFY_CHECKS ?? 'null'));
    ensure(
      current.directory === binding.directory &&
        current.round === binding.round &&
        current.candidate === binding.candidate,
      'Current candidate pointer changed after checks'
    );
    ensure(
      fileHash(current.directory, 'checks.json') === binding.checksDigest,
      'Checks record changed after execution'
    );
    const manifest = locked(root, dir);
    const check = checksSchema.parse(readJson(join(current.directory, 'checks.json')));
    const reviewPath = join(current.directory, 'review.json');
    if (!publish) save(reviewPath, JSON.parse(environment.UI_VERIFY_REVIEW ?? 'null'));
    const review = reviewSchema.parse(readJson(reviewPath));
    ensure(
      current.round === check.round &&
        current.candidate === check.candidate &&
        current.directory === check.directory,
      'Checks belong to another candidate or round'
    );
    ensure(
      candidateTree(root, authority(root, dir).head) === current.candidate,
      'Candidate changed after checks'
    );
    findings.push(...reviewFailures(manifest, check, review));
    ensure(
      check.report === join(current.directory, 'playwright.json') &&
        fileHash(current.directory, 'playwright.json') === check.reportDigest,
      'Playwright report changed after execution'
    );
    findings.push(...checkPlaywright(readJson(check.report), manifest, root));
    const images = captureHashes(current.directory, manifest);
    ensure(
      JSON.stringify(images) === JSON.stringify(check.images),
      'Images changed after deterministic capture'
    );
    for (const anchor of review.thirdParty.anchors)
      for (const path of anchor.paths) fileHash(root, path);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const result = { passed: findings.length === 0, findings };
  save(join(current.directory, 'gate.json'), { ...current, ...result });
  return result;
}

export function pushVerifiedCommit(
  root: string,
  remote: string,
  branch: string,
  expectedHead: string,
  candidate: string,
  commit: string
): void {
  sameSet(
    git(root, ['rev-list', '--parents', '-n', '1', commit]).split(' '),
    [commit, expectedHead],
    'Published commit must be a direct child of the original PR head'
  );
  ensure(
    git(root, ['rev-parse', `${commit}^{tree}`]) === candidate,
    'Publication tree differs from verified tree'
  );
  ensure(
    git(root, ['ls-remote', remote, branch]).split(/\s+/)[0] === expectedHead,
    'Remote branch changed during verification'
  );
  // The exact lease is a compare-and-swap guard. The checked parent forbids history rewrites.
  git(root, [
    'push',
    `--force-with-lease=${branch}:${expectedHead}`,
    remote,
    `${commit}:${branch}`,
  ]);
}

function publish(root: string, dir: string): void {
  const verdict = gate(root, dir, true);
  ensure(verdict.passed, `Publication refused: ${verdict.findings.join('; ')}`);
  const source = authority(root, dir);
  const pr = prSchema.parse(readJson(join(dir, 'pr.json')));
  const current = currentSchema.parse(readJson(join(dir, 'current.json')));
  const remote = `https://github.com/${pr.headRepositoryOwner.login}/${pr.headRepository.name}.git`;
  const live = exec(root, 'gh', [
    'pr',
    'view',
    String(pr.number),
    '--repo',
    source.prRepo,
    '--json',
    'headRefOid,state',
    '--jq',
    '[.state,.headRefOid] | join(" ")',
  ]);
  ensure(live === `OPEN ${source.head}`, 'PR changed during verification; start a fresh run');
  const branch = `refs/heads/${pr.headRefName}`;
  ensure(
    git(root, ['ls-remote', remote, branch]).split(/\s+/)[0] === source.head,
    'Remote branch changed during verification'
  );
  const commit = git(root, [
    'commit-tree',
    current.candidate,
    '-p',
    source.head,
    '-m',
    `fix(web): satisfy UI acceptance for #${pr.number}`,
  ]);
  ensure(
    git(root, ['rev-parse', `${commit}^{tree}`]) === current.candidate,
    'Publication tree differs from verified tree'
  );
  pushVerifiedCommit(root, remote, branch, source.head, current.candidate, commit);
  ensure(
    exec(root, 'gh', [
      'pr',
      'view',
      String(pr.number),
      '--repo',
      source.prRepo,
      '--json',
      'headRefOid',
      '--jq',
      '.headRefOid',
    ]) === commit,
    'Published PR head cannot be confirmed'
  );
  save(join(dir, 'published.json'), {
    commit,
    candidate: current.candidate,
    round: current.round,
    pr: pr.url,
    issue: issueSchema.parse(readJson(join(dir, 'issue.json'))).url,
  });
  const manifest = manifestSchema.parse(readJson(join(dir, 'manifest.json')));
  const reviewed = reviewSchema.parse(readJson(join(current.directory, 'review.json')));
  const reportPath = join(dir, 'publication-report.md');
  const body = [
    `UI verification passed for ${pr.url}.`,
    `Issue: ${issueSchema.parse(readJson(join(dir, 'issue.json'))).url}`,
    `Archon run: ${source.runId}; evidence round: ${current.round}.`,
    `Verified tree: ${current.candidate}; published commit: ${commit}.`,
    `Repair: claude / claude-sonnet-5. Independent review: codex / gpt-5.6-sol.`,
    `All ${manifest.criteria.length} criteria passed browser review. All required image pairs were opened and checked.`,
    `Commands passed: ${COMMANDS.map(command => command.argv.join(' ')).join('; ')}.`,
    `Third-party anchors: ${reviewed.thirdParty.anchors.map(anchor => `${anchor.service}: ${anchor.paths.join(', ')}`).join('; ')}.`,
    `Full checks, images, review and process records remain at ${current.directory}.`,
    '',
    ...reviewed.criteria.map(row => `- ${row.id}: ${row.observations}`),
    '',
  ].join('\n\n');
  writeFileSync(reportPath, body);
  exec(root, 'gh', [
    'pr',
    'comment',
    String(pr.number),
    '--repo',
    source.prRepo,
    '--body-file',
    reportPath,
  ]);
  process.stdout.write(
    `${JSON.stringify({ published: true, commit, candidate: current.candidate, pr: pr.url })}\n`
  );
}

export async function main(): Promise<void> {
  const root = realpathSync(process.cwd());
  ensure(environment.ARTIFACTS_DIR, 'ARTIFACTS_DIR is required');
  const dir = join(resolve(environment.ARTIFACTS_DIR), 'ui-verification');
  switch (process.argv[2]) {
    case 'initialize':
      await initialize(root, dir);
      break;
    case 'freeze':
      freeze(root, dir);
      break;
    case 'checks':
      await checks(root, dir);
      break;
    case 'gate':
      process.stdout.write(`${JSON.stringify(gate(root, dir).passed)}\n`);
      break;
    case 'publish':
      publish(root, dir);
      break;
    case 'exhausted': {
      const current = currentSchema.parse(readJson(join(dir, 'current.json')));
      throw new Error(
        `Repair budget exhausted. No publication. Findings: ${join(current.directory, 'gate.json')}. Retain this worktree and evidence. Do not reset or bypass the route-loop budget. Report unresolved findings for an explicit continuation decision.`
      );
    }
    default:
      throw new Error('Expected initialize, freeze, checks, gate, publish or exhausted');
  }
}
if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
