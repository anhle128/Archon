import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env as processEnvironment } from 'node:process';

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Caller {
  on: {
    pull_request: { branches: string[] };
    workflow_dispatch: { inputs: Record<string, unknown> };
  };
  jobs: { verify: { name: string; steps: Step[] } };
}
const root = join(import.meta.dir, '..');
const source = readFileSync(join(root, '.github/workflows/pr-e2e-verify.yml'), 'utf8');
const caller = Bun.YAML.parse(source) as Caller;
const scratch: string[] = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});
function temporary(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'archon-ci-contract-')));
  scratch.push(path);
  return path;
}
function script(name: string): string {
  const value = caller.jobs.verify.steps.find(step => step.name === name)?.run;
  if (!value) throw new Error(`Missing caller step: ${name}`);
  return value;
}
function shell(
  command: string,
  cwd: string,
  environment: Record<string, string>
): ReturnType<typeof spawnSync> {
  return spawnSync('bash', ['-c', command], {
    cwd,
    env: { ...processEnvironment, ...environment },
    encoding: 'utf8',
  });
}
function put(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

test('PR UI caller retains one check and pins the trusted source with named inputs', () => {
  expect(caller.on.pull_request.branches).toEqual(['dev', 'develop']);
  expect(caller.on).not.toHaveProperty('pull_request_target');
  expect(caller.on.pull_request).not.toHaveProperty('paths');
  expect(Object.keys(caller.jobs)).toEqual(['verify']);
  expect(caller.jobs.verify.name).toBe('PR E2E Verify');
  expect(caller.on.workflow_dispatch.inputs).toHaveProperty('issue_url');
  const checkout = caller.jobs.verify.steps.find(step => step.uses === 'actions/checkout@v4');
  expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.base.sha || github.sha }}');
  expect(checkout?.with?.['persist-credentials']).toBe(false);
  const run = script('Run pr-e2e-verify');
  expect(run).toContain('--from "$(git rev-parse HEAD)" --base "$BASE_REF"');
  expect(run).toContain('--input "pr=$PR_URL" --input "issue=$ISSUE_URL"');
  expect(run).not.toContain('--no-worktree');
  for (const obsolete of [
    'comment-pr',
    'e2e-status.txt',
    'XAI_API_KEY',
    'REQUIRE_AXI_SCREENSHOTS',
  ]) {
    expect(source).not.toContain(obsolete);
  }
  const steps = caller.jobs.verify.steps.map(step => step.name);
  expect(steps.indexOf('Resolve trusted PR and issue inputs')).toBeLessThan(
    steps.indexOf('Install dependencies')
  );
  expect(steps.indexOf('Check trusted workflow contract')).toBeLessThan(
    steps.indexOf('Install dependencies')
  );
});

const prUrl = 'https://github.com/anhle128/Archon/pull/999';
const issueUrl = 'https://github.com/anhle128/Archon/issues/144';
const head = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const candidate = 'c'.repeat(40);

// This Actions caller targets Ubuntu; these fixtures use native POSIX shell paths.
test.skipIf(process.platform === 'win32')(
  'input resolution accepts one typed issue or explicit dispatch and rejects unsafe inputs',
  () => {
    const path = temporary();
    const output = join(path, 'outputs');
    const cases = [
      {
        links: [issueUrl],
        event: 'pull_request',
        owner: 'anhle128',
        explicit: '',
        eventHead: head,
        pass: true,
      },
      {
        links: [],
        event: 'pull_request',
        owner: 'anhle128',
        explicit: '',
        eventHead: head,
        pass: false,
      },
      {
        links: [issueUrl, issueUrl + '0'],
        event: 'pull_request',
        owner: 'anhle128',
        explicit: '',
        eventHead: head,
        pass: false,
      },
      {
        links: [],
        event: 'workflow_dispatch',
        owner: 'anhle128',
        explicit: issueUrl,
        eventHead: '',
        pass: true,
      },
      {
        links: [issueUrl],
        event: 'pull_request',
        owner: 'untrusted-fork',
        explicit: '',
        eventHead: head,
        pass: false,
      },
      {
        links: [],
        event: 'workflow_dispatch',
        owner: 'anhle128',
        explicit: '144',
        eventHead: '',
        pass: false,
      },
      {
        links: [issueUrl],
        event: 'pull_request',
        owner: 'anhle128',
        explicit: '',
        eventHead: commit,
        pass: false,
      },
    ];
    for (const explicit of [
      'https://github.com/anhle128\nextra=value/Archon/issues/144',
      issueUrl + '?query=1',
      'https://github.com/$(command)/Archon/issues/144',
    ]) {
      cases.push({
        links: [],
        event: 'workflow_dispatch',
        owner: 'anhle128',
        explicit,
        eventHead: '',
        pass: false,
      });
    }
    for (const fixture of cases) {
      writeFileSync(output, '');
      const result = shell(
        'gh() { printf "%s\\n" "$PR_STUB_JSON"; };\n' +
          script('Resolve trusted PR and issue inputs'),
        path,
        {
          GITHUB_REPOSITORY: 'anhle128/Archon',
          GITHUB_OUTPUT: output,
          PR_NUMBER: '999',
          EVENT_NAME: fixture.event,
          EVENT_HEAD: fixture.eventHead,
          ISSUE_URL: fixture.explicit,
          PR_STUB_JSON: JSON.stringify({
            url: prUrl,
            state: 'OPEN',
            headRepository: { name: 'Archon' },
            headRepositoryOwner: { login: fixture.owner },
            headRefOid: head,
            baseRefName: 'develop',
            closingIssuesReferences: fixture.links.map(url => ({ url })),
          }),
        }
      );
      expect(result.status, String(result.stderr)).toBe(fixture.pass ? 0 : 1);
      if (fixture.pass)
        expect(readFileSync(output, 'utf8')).toContain(`pr_url=${prUrl}\nissue_url=${issueUrl}\n`);
    }
  }
);

test('trusted bootstrap check accepts the current contract and rejects the old base', () => {
  const code = script('Check trusted workflow contract').match(/bun -e '([\s\S]*)'/)?.[1];
  if (!code) throw new Error('Missing trusted bootstrap program');
  const current = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8' });
  expect(current.status, current.stderr).toBe(0);
  const path = temporary();
  mkdirSync(join(path, '.archon/workflows'), { recursive: true });
  writeFileSync(
    join(path, '.archon/workflows/pr-e2e-verify.yaml'),
    'name: pr-e2e-verify\nnodes: []\n'
  );
  const old = spawnSync(process.execPath, ['-e', code], { cwd: path, encoding: 'utf8' });
  expect(old.status).toBe(1);
  expect(old.stderr).toContain('Trusted workflow upgrade is not present');
});

for (const scenario of [
  'passed',
  'non-terminal',
  'exhausted',
  'stale-candidate',
  'wrong-run',
] as const) {
  test.skipIf(process.platform === 'win32')(
    `publication gate checks the exact current run: ${scenario}`,
    () => {
      const path = temporary();
      const storage = join(path, 'workspaces/anhle128/Archon');
      const artifacts = join(storage, 'artifacts/runs/run-ci');
      const evidence = join(artifacts, 'ui-verification');
      const round = join(evidence, 'rounds/round-ci');
      mkdirSync(round, { recursive: true });
      const current = { candidate, round: 'round-ci', directory: round };
      put(join(evidence, 'current.json'), current);
      put(join(evidence, 'authority.json'), {
        runId: scenario === 'wrong-run' ? 'other' : 'run-ci',
        head,
      });
      put(join(round, 'gate.json'), { ...current, passed: true });
      put(join(evidence, 'published.json'), {
        ...current,
        candidate: scenario === 'stale-candidate' ? head : candidate,
        commit,
        pr: prUrl,
        issue: issueUrl,
      });
      const result = shell(
        `bun() {
        case "$4" in
          run) return "$WORKFLOW_EXIT" ;;
          runs) printf '%s\\n' "$RUNS_STUB_JSON" ;;
          get) printf '%s\\n' "$GET_STUB_JSON" ;;
          *) return 99 ;;
        esac
      }
      git() { printf '%s\\n' "$EXPECTED_HEAD"; }
      gh() {
        if [ "$1" = api ]; then printf '%s\\n' "$COMMIT_STUB_JSON";
        else printf '%s\\n' "$PUBLISHED_COMMIT"; fi
      }
      ` + script('Run pr-e2e-verify'),
        path,
        {
          ARCHON_HOME: path,
          GITHUB_OUTPUT: join(path, 'outputs'),
          GITHUB_REPOSITORY: 'anhle128/Archon',
          PR_URL: prUrl,
          ISSUE_URL: issueUrl,
          BASE_REF: 'develop',
          EXPECTED_HEAD: head,
          PUBLISHED_COMMIT: commit,
          WORKFLOW_EXIT: scenario === 'exhausted' ? '1' : '0',
          RUNS_STUB_JSON: JSON.stringify({
            runs: [{ id: 'run-ci', workflow_name: 'pr-e2e-verify', output_root: storage }],
          }),
          GET_STUB_JSON: JSON.stringify({
            result: {
              terminal: scenario !== 'non-terminal',
              state: scenario === 'exhausted' ? 'failed' : 'completed',
              nodes: [
                { nodeId: 'publish', state: scenario === 'exhausted' ? 'pending' : 'completed' },
              ],
            },
          }),
          COMMIT_STUB_JSON: JSON.stringify({ tree: { sha: candidate }, parents: [{ sha: head }] }),
        }
      );
      expect(result.status, String(result.stderr)).toBe(scenario === 'passed' ? 0 : 1);
      expect(readFileSync(join(path, 'outputs'), 'utf8')).toContain(`artifact_dir=${artifacts}`);
    }
  );
}
