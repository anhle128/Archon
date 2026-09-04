import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MAX_CANDIDATE_FILES,
  MAX_FILE_BYTES,
  MAX_LINE_BYTES,
  MAX_TOTAL_BYTES,
  collectHiddenSessionUsage,
  encodeOmpSessionCwdDirName,
  enrichResultWithHiddenUsage,
  findMainTranscriptPath,
  parseTranscriptUsageEntries,
  resolveOmpSessionDir,
  setSessionUsageBoundsForTest,
  snapshotHiddenSessionFiles,
  type SessionUsageSnapshot,
} from './session-usage';

const tempRoots: string[] = [];

afterEach(async () => {
  setSessionUsageBoundsForTest(undefined);
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) break;
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeTempRoot(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `omp-session-usage-${label}-`));
  tempRoots.push(root);
  return root;
}

function sessionHeader(id: string, cwd: string): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: '2026-09-04T00:00:00.000Z',
    cwd,
  });
}

function assistantLine(opts: {
  provider?: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  text?: string;
}): string {
  const input = opts.input ?? 10;
  const output = opts.output ?? 4;
  const cacheRead = opts.cacheRead ?? 1;
  const cacheWrite = opts.cacheWrite ?? 0;
  return JSON.stringify({
    type: 'message',
    id: 'msg-1',
    parentId: null,
    timestamp: '2026-09-04T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? 'secret-prompt-should-not-leak' }],
      provider: opts.provider ?? 'openai-codex',
      model: opts.model ?? 'gpt-test',
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        cost: { total: opts.cost ?? 0.2 },
      },
      stopReason: 'stop',
    },
  });
}

function userLine(text: string): string {
  return JSON.stringify({
    type: 'message',
    id: 'user-1',
    parentId: null,
    timestamp: '2026-09-04T00:00:00.500Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

async function writeTranscript(filePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function layoutFresh(opts?: {
  cwd?: string;
  sessionId?: string;
  withAdvisor?: boolean;
  withTask?: boolean;
  nestedAdvisor?: boolean;
}): Promise<{
  root: string;
  cwd: string;
  sessionId: string;
  sessionDir: string;
  mainPath: string;
  artifactDir: string;
  env: Record<string, string>;
}> {
  const root = await makeTempRoot('fresh');
  const cwd = opts?.cwd ?? path.join(root, 'project');
  await fs.mkdir(cwd, { recursive: true });
  const sessionId = opts?.sessionId ?? 'sess-fresh-1';
  const sessionDir = path.join(root, 'sessions');
  await fs.mkdir(sessionDir, { recursive: true });
  const mainPath = path.join(sessionDir, `2026-09-04T00-00-00-000Z_${sessionId}.jsonl`);
  const artifactDir = mainPath.slice(0, -'.jsonl'.length);
  await writeTranscript(mainPath, [
    sessionHeader(sessionId, cwd),
    userLine('primary user prompt must stay out of usage'),
    assistantLine({ input: 5, output: 2, cost: 0.05, text: 'primary' }),
  ]);
  await fs.mkdir(artifactDir, { recursive: true });
  if (opts?.withAdvisor !== false) {
    await writeTranscript(path.join(artifactDir, '__advisor.default.jsonl'), [
      sessionHeader(`${sessionId}-advisor`, cwd),
      userLine('advisor prompt content'),
      assistantLine({
        provider: 'anthropic',
        model: 'claude-advisor',
        input: 20,
        output: 3,
        cost: 0.3,
        text: 'advisor reply',
      }),
    ]);
  }
  if (opts?.withTask !== false) {
    await writeTranscript(path.join(artifactDir, 'ScoutTask.jsonl'), [
      sessionHeader(`${sessionId}-task`, cwd),
      userLine('task prompt content'),
      assistantLine({
        provider: 'openai-codex',
        model: 'gpt-task',
        input: 30,
        output: 6,
        cost: 0.4,
        text: 'task reply',
      }),
    ]);
  }
  if (opts?.nestedAdvisor) {
    const nestedDir = path.join(artifactDir, 'ScoutTask');
    await fs.mkdir(nestedDir, { recursive: true });
    await writeTranscript(path.join(nestedDir, '__advisor.jsonl'), [
      sessionHeader(`${sessionId}-nested-adv`, cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'nested-advisor',
        input: 7,
        output: 1,
        cost: 0.07,
        text: 'nested advisor',
      }),
    ]);
  }
  return {
    root,
    cwd,
    sessionId,
    sessionDir,
    mainPath,
    artifactDir,
    env: { PI_CODING_AGENT_SESSION_DIR: sessionDir },
  };
}

describe('resolveOmpSessionDir', () => {
  test('prefers exact PI_CODING_AGENT_SESSION_DIR', () => {
    const result = resolveOmpSessionDir({
      env: { PI_CODING_AGENT_SESSION_DIR: '/tmp/exact-session' },
      cwd: '/any',
    });
    expect(result).toEqual({
      ok: true,
      sessionDir: path.resolve('/tmp/exact-session'),
      source: 'session_dir_env',
    });
  });

  test('derives from PI_CODING_AGENT_DIR and encoded cwd', async () => {
    const root = await makeTempRoot('derive');
    const cwd = path.join(root, 'repo');
    await fs.mkdir(cwd, { recursive: true });
    const agentDir = path.join(root, 'agent');
    const result = resolveOmpSessionDir({
      env: { PI_CODING_AGENT_DIR: agentDir },
      cwd,
      homeDir: root,
      tmpDir: path.join(root, 'tmp'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('derived');
    expect(result.sessionDir).toBe(
      path.join(agentDir, 'sessions', encodeOmpSessionCwdDirName(cwd, root, path.join(root, 'tmp')))
    );
  });
});

describe('collectHiddenSessionUsage', () => {
  test('fresh session reads advisor, task, and nested advisor files once', async () => {
    const fx = await layoutFresh({ nestedAdvisor: true });
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeDefined();
    expect(
      hidden?.entries.map(e => ({ kind: e.kind, model: e.model, costUsd: e.costUsd }))
    ).toEqual([
      { kind: 'advisor', model: 'claude-advisor', costUsd: 0.3 },
      { kind: 'subagent', model: 'gpt-task', costUsd: 0.4 },
      { kind: 'advisor', model: 'nested-advisor', costUsd: 0.07 },
    ]);
    expect(hidden?.tokens.cost).toBeCloseTo(0.77);
    const serialized = JSON.stringify(hidden);
    expect(serialized).not.toContain('advisor reply');
    expect(serialized).not.toContain('task reply');
    expect(serialized).not.toContain('secret-prompt');
    expect(serialized).not.toContain('primary user prompt');
  });

  test('no-session skips transcript search', async () => {
    const fx = await layoutFresh();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      noSession: true,
    });
    expect(hidden).toBeUndefined();
  });

  test('wrong session header/cwd omits hidden usage', async () => {
    const fx = await layoutFresh();
    const wrongCwd = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: path.join(fx.root, 'other-cwd'),
      sessionId: fx.sessionId,
    });
    expect(wrongCwd).toBeUndefined();

    await writeTranscript(fx.mainPath, [
      sessionHeader('other-id', fx.cwd),
      assistantLine({ input: 1, output: 1, cost: 0.01 }),
    ]);
    const wrongId = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(wrongId).toBeUndefined();
  });

  test('resume parses only appended bytes and rejects mid-record snapshots', async () => {
    const fx = await layoutFresh({ withTask: false, nestedAdvisor: false });
    const advisorPath = path.join(fx.artifactDir, '__advisor.default.jsonl');
    const prior = await fs.readFile(advisorPath);
    const snapshot: SessionUsageSnapshot = {
      sessionDir: fx.sessionDir,
      artifactRoot: fx.artifactDir,
      files: [
        {
          relativePath: path.relative(fx.artifactDir, advisorPath),
          byteLength: prior.byteLength,
          prefixDigest: createHash('sha256').update(prior).digest('hex'),
          endsAtRecordBoundary: prior[prior.length - 1] === 0x0a,
          kind: 'advisor',
        },
      ],
    };

    await fs.appendFile(
      advisorPath,
      `${assistantLine({
        provider: 'anthropic',
        model: 'claude-advisor-2',
        input: 11,
        output: 2,
        cost: 0.11,
        text: 'new advisor turn',
      })}\n`
    );

    const delta = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot,
    });
    expect(delta?.entries).toEqual([
      expect.objectContaining({
        kind: 'advisor',
        model: 'claude-advisor-2',
        costUsd: 0.11,
        inputTokens: 11,
      }),
    ]);

    const cut = Math.max(1, prior.length - 3);
    const midRecord: SessionUsageSnapshot = {
      ...snapshot,
      files: snapshot.files.map(file => ({
        ...file,
        byteLength: cut,
        endsAtRecordBoundary: false,
        prefixDigest: createHash('sha256').update(prior.subarray(0, cut)).digest('hex'),
      })),
    };
    const rejected = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: midRecord,
    });
    expect(rejected?.entries ?? []).toEqual([]);
  });

  test('forked copied history is not counted; new files are', async () => {
    const source = await layoutFresh({ sessionId: 'source-sess', withTask: true });
    const dest = await layoutFresh({
      sessionId: 'dest-sess',
      cwd: source.cwd,
      withAdvisor: false,
      withTask: false,
    });
    const copiedAdvisor = path.join(dest.artifactDir, '__advisor.default.jsonl');
    await fs.copyFile(path.join(source.artifactDir, '__advisor.default.jsonl'), copiedAdvisor);
    const copiedBytes = await fs.readFile(copiedAdvisor);
    const snapshot: SessionUsageSnapshot = {
      sessionDir: source.sessionDir,
      artifactRoot: source.artifactDir,
      files: [
        {
          relativePath: '__advisor.default.jsonl',
          byteLength: copiedBytes.byteLength,
          prefixDigest: createHash('sha256').update(copiedBytes).digest('hex'),
          endsAtRecordBoundary: true,
          kind: 'advisor',
        },
      ],
    };
    await writeTranscript(path.join(dest.artifactDir, 'NewTask.jsonl'), [
      sessionHeader('dest-task', dest.cwd),
      assistantLine({
        provider: 'openai-codex',
        model: 'new-task',
        input: 9,
        output: 1,
        cost: 0.09,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: dest.env,
      cwd: dest.cwd,
      sessionId: dest.sessionId,
      snapshot,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['new-task']);
    expect(hidden?.entries.some(e => e.model === 'claude-advisor')).toBe(false);
  });

  test('changed prefix omits unsafe file rather than double-count', async () => {
    const fx = await layoutFresh({ withTask: false });
    const snapshot: SessionUsageSnapshot = {
      sessionDir: fx.sessionDir,
      files: [
        {
          relativePath: '__advisor.default.jsonl',
          byteLength: 32,
          prefixDigest: 'deadbeef',
          endsAtRecordBoundary: true,
          kind: 'advisor',
        },
      ],
    };
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('symlink path escape is rejected', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const outside = path.join(fx.root, 'outside.jsonl');
    await writeTranscript(outside, [
      sessionHeader('outside', fx.cwd),
      assistantLine({ input: 99, output: 9, cost: 9.9, model: 'escaped' }),
    ]);
    await fs.symlink(outside, path.join(fx.artifactDir, 'escape.jsonl'));

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('non-session JSONL artifacts are not treated as subagents', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, 'tool-dump.jsonl'), [
      JSON.stringify({ type: 'tool', name: 'bash', output: 'not a session' }),
      assistantLine({ model: 'should-not-count', input: 50, output: 50, cost: 5 }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });

  test('malformed JSONL lines are omitted without failing the run', async () => {
    const fx = await layoutFresh({ withTask: false });
    const advisorPath = path.join(fx.artifactDir, '__advisor.default.jsonl');
    await fs.appendFile(advisorPath, '{not-json\n');
    await fs.appendFile(
      advisorPath,
      `${assistantLine({ model: 'after-malformed', input: 2, output: 1, cost: 0.02 })}\n`
    );
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.some(e => e.model === 'after-malformed')).toBe(true);
    expect(hidden?.entries.some(e => e.model === 'claude-advisor')).toBe(true);
  });

  test('oversized line omits all hidden enrichment', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const huge = 'x'.repeat(MAX_LINE_BYTES + 10);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      `{"type":"message","message":{"role":"assistant","provider":"x","model":"y","usage":{"input":1,"output":1,"cost":{"total":1}},"content":[{"type":"text","text":"${huge}"}]}}`,
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('missing files and null snapshot skip enrichment safely', async () => {
    const fx = await layoutFresh();
    const missing = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: 'does-not-exist',
    });
    expect(missing).toBeUndefined();

    const nullSnap = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
      snapshot: null,
    });
    expect(nullSnap).toBeUndefined();
  });

  test('snapshotHiddenSessionFiles captures existing candidates', async () => {
    const fx = await layoutFresh({ withTask: true });
    const snap = await snapshotHiddenSessionFiles({
      env: fx.env,
      cwd: fx.cwd,
      resumeSessionId: fx.sessionId,
    });
    expect(snap).not.toBeNull();
    expect(snap?.files.some(f => f.relativePath.includes('__advisor'))).toBe(true);
    expect(snap?.files.some(f => f.relativePath.includes('ScoutTask'))).toBe(true);
    expect(snap?.files.every(f => f.endsAtRecordBoundary)).toBe(true);
    expect(snap?.files.every(f => f.kind === 'advisor' || f.kind === 'subagent')).toBe(true);
  });

  test('negative token rows are rejected by the normalizer', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-neg', fx.cwd),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: 'x',
          model: 'bad',
          content: [],
          usage: { input: -5, output: 1, cost: { total: 1 } },
        },
      }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries ?? []).toEqual([]);
  });
});

describe('enrichResultWithHiddenUsage', () => {
  test('appends hidden rows and costs without changing numTurns', () => {
    const enriched = enrichResultWithHiddenUsage(
      {
        tokens: { input: 5, output: 2, total: 7, cost: 0.05 },
        cost: 0.05,
        numTurns: 2,
        usageBreakdown: [
          {
            provider: 'openai-codex',
            model: 'primary',
            modelSource: 'reported' as const,
            inputTokens: 5,
            outputTokens: 2,
            requests: 1,
            costUsd: 0.05,
          },
        ],
      },
      {
        entries: [
          {
            provider: 'anthropic',
            model: 'advisor',
            modelSource: 'reported',
            inputTokens: 20,
            outputTokens: 3,
            requests: 1,
            costUsd: 0.3,
            kind: 'advisor',
          },
        ],
        tokens: { input: 20, output: 3, total: 23, cost: 0.3 },
      }
    );
    expect(enriched.numTurns).toBe(2);
    expect(enriched.tokens).toEqual({ input: 25, output: 5, total: 30, cost: 0.35 });
    expect(enriched.usageBreakdown).toHaveLength(2);
    expect(enriched.usageBreakdown?.[1]?.kind).toBe('advisor');
  });
});

describe('bounds constants', () => {
  test('file byte bound is 64 MiB', () => {
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('hidden transcript missingness (US-017)', () => {
  test('omits blank/missing provider rows while keeping valid sibling order', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-miss', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'keep-first',
        input: 2,
        output: 1,
        cost: 0.2,
      }),
      // blank provider — must not become unknown
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: '',
          model: 'blank',
          content: [],
          usage: { input: 9, output: 9, cost: { total: 0.9 } },
        },
      }),
      // missing provider
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'missing',
          content: [],
          usage: { input: 4, output: 1, cost: { total: 0.04 } },
        },
      }),
      assistantLine({
        provider: 'openai-codex',
        model: 'keep-last',
        input: 3,
        output: 2,
        cost: 0.03,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => ({ provider: e.provider, model: e.model }))).toEqual([
      { provider: 'anthropic', model: 'keep-first' },
      { provider: 'openai-codex', model: 'keep-last' },
    ]);
    expect(hidden?.entries.some(e => e.provider === 'unknown')).toBe(false);
    expect(hidden?.entries[0]?.kind).toBe('advisor');
    expect(hidden?.entries[1]?.kind).toBe('advisor');
  });
});

describe('US-018 harden OMP hidden-session discovery', () => {
  test('multiple matching main transcripts fail closed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(
      path.join(fx.sessionDir, `2026-09-04T01-00-00-000Z_${fx.sessionId}.jsonl`),
      [sessionHeader(fx.sessionId, fx.cwd), assistantLine({ input: 1, output: 1, cost: 0.01 })]
    );
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv', fx.cwd),
      assistantLine({ model: 'should-not-run', input: 9, output: 9, cost: 9 }),
    ]);

    await expect(findMainTranscriptPath(fx.sessionDir, fx.sessionId)).resolves.toBeUndefined();
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden).toBeUndefined();
  });

  test('unrelated valid session-shaped JSONL under artifact is never billed', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    // Main-transcript constructor dropped into the artifact dir.
    await writeTranscript(
      path.join(fx.artifactDir, `2026-09-04T00-00-00-000Z_${fx.sessionId}.jsonl`),
      [
        sessionHeader('foreign-main', fx.cwd),
        assistantLine({
          model: 'foreign-main',
          input: 40,
          output: 4,
          cost: 4,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]
    );
    // Reserved non-advisor dump.
    await writeTranscript(path.join(fx.artifactDir, '__debug.jsonl'), [
      sessionHeader('debug', fx.cwd),
      assistantLine({
        model: 'debug-model',
        input: 11,
        output: 1,
        cost: 1.1,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Orphan nested dir without a sibling task-agent transcript.
    await writeTranscript(path.join(fx.artifactDir, 'orphan-dir', 'Nested.jsonl'), [
      sessionHeader('orphan', fx.cwd),
      assistantLine({
        model: 'orphan-nested',
        input: 22,
        output: 2,
        cost: 2.2,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    // Valid advisor still bills.
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('adv-ok', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'advisor-ok',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);

    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries.map(e => e.model)).toEqual(['advisor-ok']);
    expect(hidden?.entries.some(e => e.model === 'foreign-main')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'debug-model')).toBe(false);
    expect(hidden?.entries.some(e => e.model === 'orphan-nested')).toBe(false);
  });

  test('pathname swap after prefix verify cannot redirect the open handle', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const artifactRoot = await fs.realpath(fx.artifactDir);
    const goodPath = path.join(artifactRoot, '__advisor.jsonl');
    const priorLines = [
      sessionHeader('adv-swap', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'history',
        input: 5,
        output: 1,
        cost: 0.05,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ];
    await writeTranscript(goodPath, priorLines);
    const prior = await fs.readFile(goodPath);
    const delta = `${assistantLine({
      provider: 'anthropic',
      model: 'delta-good',
      input: 7,
      output: 2,
      cost: 0.07,
      cacheRead: 0,
      cacheWrite: 0,
      text: 'good-delta',
    })}\n`;
    await fs.appendFile(goodPath, delta);

    const evilPath = path.join(artifactRoot, 'evil-tmp.jsonl');
    await writeTranscript(evilPath, [
      sessionHeader('evil', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'evil-model',
        input: 99,
        output: 9,
        cost: 9.9,
        cacheRead: 0,
        cacheWrite: 0,
        text: 'evil-bytes',
      }),
    ]);

    const parsed = await parseTranscriptUsageEntries(
      goodPath,
      artifactRoot,
      'advisor',
      prior.byteLength,
      {
        requireSessionHeader: false,
        expectedPrefix: {
          byteLength: prior.byteLength,
          digest: createHash('sha256').update(prior).digest('hex'),
        },
        afterPrefixVerified: async () => {
          // Replace the pathname with a different inode after verification.
          await fs.rename(goodPath, `${goodPath}.bak`);
          await fs.rename(evilPath, goodPath);
        },
      }
    );

    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.entries.map(e => e.model)).toEqual(['delta-good']);
    expect(parsed.entries.some(e => e.model === 'evil-model')).toBe(false);
    expect(JSON.stringify(parsed.entries)).not.toContain('evil-bytes');
  });

  test('chunked JSONL parsing handles records split across read chunks and UTF-8 boundaries', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const artifactRoot = await fs.realpath(fx.artifactDir);
    const filePath = path.join(artifactRoot, '__advisor.jsonl');
    // Build a multi-kilobyte line so a 64KiB chunk boundary falls mid-record, and include
    // a multi-byte UTF-8 character that can straddle an arbitrary byte split.
    const pad = '字'.repeat(40_000); // 3 bytes each → ~120KiB payload
    const lines = [
      sessionHeader('chunked', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'chunk-model',
        input: 2,
        output: 1,
        cost: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
        text: pad,
      }),
      assistantLine({
        provider: 'anthropic',
        model: 'after-chunk',
        input: 3,
        output: 1,
        cost: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
        text: 'tail',
      }),
    ];
    await writeTranscript(filePath, lines);

    const parsed = await parseTranscriptUsageEntries(filePath, artifactRoot, 'advisor', 0);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.entries.map(e => e.model)).toEqual(['chunk-model', 'after-chunk']);
    // Content is never returned — only usage rows.
    expect(JSON.stringify(parsed.entries)).not.toContain(pad.slice(0, 32));
  });

  test('exact file count bound succeeds and one-over omits all hidden enrichment', async () => {
    // Seam shrinks the production 1_000-file ceiling so the test stays cheap while
    // exercising the same exclusive comparison used at MAX_CANDIDATE_FILES.
    expect(MAX_CANDIDATE_FILES).toBe(1_000);
    setSessionUsageBoundsForTest({ maxCandidateFiles: 3 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    for (let i = 0; i < 3; i++) {
      const name = i === 0 ? '__advisor.jsonl' : `Task${i}.jsonl`;
      await writeTranscript(path.join(fx.artifactDir, name), [
        sessionHeader(`id-${i}`, fx.cwd),
        assistantLine({
          model: `m-${i}`,
          input: 1,
          output: 0,
          cost: 0.001,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ]);
    }
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries).toHaveLength(3);

    await writeTranscript(path.join(fx.artifactDir, 'TaskOverflow.jsonl'), [
      sessionHeader('overflow', fx.cwd),
      assistantLine({
        model: 'overflow',
        input: 1,
        output: 0,
        cost: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ]);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('exact and one-over file byte bound', async () => {
    expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
    setSessionUsageBoundsForTest({ maxFileBytes: 2_000 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const header = sessionHeader('file-bound', fx.cwd);
    const body = assistantLine({
      model: 'exact-file',
      input: 1,
      output: 1,
      cost: 0.01,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const exactContent = `${header}\n${body}\n`;
    const pad = 2_000 - Buffer.byteLength(exactContent, 'utf8') - 1;
    expect(pad).toBeGreaterThan(0);
    const content = `${exactContent}${' '.repeat(pad)}\n`;
    expect(Buffer.byteLength(content, 'utf8')).toBe(2_000);
    await fs.writeFile(path.join(fx.artifactDir, '__advisor.jsonl'), content);

    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.some(e => e.model === 'exact-file')).toBe(true);

    await fs.writeFile(path.join(fx.artifactDir, '__advisor.jsonl'), `${content}x`);
    expect((await fs.stat(path.join(fx.artifactDir, '__advisor.jsonl'))).size).toBe(2_001);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('exact and one-over total byte bound', async () => {
    expect(MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
    setSessionUsageBoundsForTest({ maxTotalBytes: 4_000 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });

    const makeSized = async (name: string, model: string, targetSize: number) => {
      const header = sessionHeader(`s-${model}`, fx.cwd);
      const body = assistantLine({
        model,
        input: 1,
        output: 0,
        cost: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
      });
      const base = `${header}\n${body}\n`;
      const pad = targetSize - Buffer.byteLength(base, 'utf8') - 1;
      expect(pad).toBeGreaterThanOrEqual(0);
      const content = `${base}${' '.repeat(pad)}\n`;
      expect(Buffer.byteLength(content, 'utf8')).toBe(targetSize);
      await fs.writeFile(path.join(fx.artifactDir, name), content);
    };

    await makeSized('TaskA.jsonl', 'a', 2_000);
    await makeSized('TaskB.jsonl', 'b', 2_000);
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.map(e => e.model).sort()).toEqual(['a', 'b']);

    await makeSized('TaskB.jsonl', 'b', 2_001);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('exact line bound succeeds and one-over omits all hidden enrichment', async () => {
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
    setSessionUsageBoundsForTest({ maxLineBytes: 300 });
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    const header = sessionHeader('line-bound', fx.cwd);
    const prefix =
      '{"type":"message","message":{"role":"assistant","provider":"x","model":"exact-line","usage":{"input":1,"output":1,"cost":{"total":1}},"content":[{"type":"text","text":"';
    const suffix = '"}]}}';
    const fill = 300 - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8');
    expect(fill).toBeGreaterThan(0);
    const exactLine = `${prefix}${'a'.repeat(fill)}${suffix}`;
    expect(Buffer.byteLength(exactLine, 'utf8')).toBe(300);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [header, exactLine]);
    const exact = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(exact?.entries.some(e => e.model === 'exact-line')).toBe(true);

    const overLine = `${prefix}${'a'.repeat(fill + 1)}${suffix}`;
    expect(Buffer.byteLength(overLine, 'utf8')).toBe(301);
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [header, overLine]);
    const over = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(over).toBeUndefined();
  });

  test('hidden legacy totals include cache-read and cache-write dimensions', async () => {
    const fx = await layoutFresh({ withAdvisor: false, withTask: false });
    await writeTranscript(path.join(fx.artifactDir, '__advisor.jsonl'), [
      sessionHeader('cache-adv', fx.cwd),
      assistantLine({
        provider: 'anthropic',
        model: 'cache-model',
        input: 10,
        output: 4,
        cacheRead: 6,
        cacheWrite: 2,
        cost: 0.5,
      }),
    ]);
    const hidden = await collectHiddenSessionUsage({
      env: fx.env,
      cwd: fx.cwd,
      sessionId: fx.sessionId,
    });
    expect(hidden?.entries[0]).toEqual(
      expect.objectContaining({
        model: 'cache-model',
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 6,
        cacheWriteTokens: 2,
        costUsd: 0.5,
      })
    );
    // Pi totalTokens = input + output + cacheRead + cacheWrite
    expect(hidden?.tokens).toEqual({ input: 10, output: 4, total: 22, cost: 0.5 });

    const enriched = enrichResultWithHiddenUsage(
      {
        tokens: { input: 1, output: 1, total: 2, cost: 0.01 },
        cost: 0.01,
        numTurns: 3,
        usageBreakdown: [],
      },
      hidden!
    );
    expect(enriched.numTurns).toBe(3);
    expect(enriched.tokens).toEqual({ input: 11, output: 5, total: 24, cost: 0.51 });
  });
});
