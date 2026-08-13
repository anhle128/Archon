import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, realpathSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildReworkPrompt,
  resolveGateDocumentPath,
  preflightPlannotatorBinary,
  resolvePlannotatorGateId,
} from './plannotator-gate-executor';
import type { NodeOutput, WorkflowRun } from './schemas';

function makeRun(approval: Record<string, unknown>): WorkflowRun {
  return {
    id: 'run-1',
    workflow_name: 'wf',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'go',
    metadata: { approval },
    started_at: new Date(),
    completed_at: null,
    last_activity_at: new Date(),
    working_path: '/tmp',
    user_id: null,
    parent_run_id: null,
    output_root: null,
  };
}

describe('resolveGateDocumentPath', () => {
  let dir: string;
  let cwd: string;
  let artifactsDir: string;
  let outsideDir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `plannotator-gate-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    cwd = join(dir, 'cwd');
    artifactsDir = join(dir, 'artifacts');
    outsideDir = join(dir, 'outside');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves $node.output path ref to a readable HTML file under cwd', () => {
    const html = join(cwd, 'doc.html');
    writeFileSync(html, '<html></html>');
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: html }],
    ]);
    expect(resolveGateDocumentPath('$explain.output', outputs, cwd, artifactsDir)).toBe(
      realpathSync(html)
    );
  });

  test('throws when file missing', () => {
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: join(cwd, 'nope.html') }],
    ]);
    expect(() => resolveGateDocumentPath('$explain.output', outputs, cwd, artifactsDir)).toThrow();
  });

  test('resolves a relative readable HTML file against cwd', () => {
    writeFileSync(join(cwd, 'rel.html'), '<html></html>');
    const outputs = new Map<string, NodeOutput>();
    expect(resolveGateDocumentPath('rel.html', outputs, cwd, artifactsDir)).toBe(
      realpathSync(join(cwd, 'rel.html'))
    );
  });

  test('allows a readable HTML file under artifactsDir', () => {
    const html = join(artifactsDir, 'plan.htm');
    writeFileSync(html, '<html></html>');
    expect(resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toBe(realpathSync(html));
  });

  test('rejects a directory named with an HTML extension', () => {
    const directory = join(cwd, 'directory.html');
    mkdirSync(directory);
    expect(() => resolveGateDocumentPath(directory, new Map(), cwd, artifactsDir)).toThrow(/file/i);
  });

  test('rejects an unreadable HTML file', () => {
    const html = join(cwd, 'unreadable.html');
    writeFileSync(html, '<html></html>');
    chmodSync(html, 0o000);
    expect(() => resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toThrow(/readable/i);
    chmodSync(html, 0o600);
  });

  test('rejects a non-HTML file', () => {
    const markdown = join(cwd, 'plan.md');
    writeFileSync(markdown, '# Plan');
    expect(() => resolveGateDocumentPath(markdown, new Map(), cwd, artifactsDir)).toThrow(/html/i);
  });

  test('rejects a relative path escaping cwd and both allowed roots', () => {
    const html = join(outsideDir, 'escaped.html');
    writeFileSync(html, '<html></html>');
    expect(() =>
      resolveGateDocumentPath('../outside/escaped.html', new Map(), cwd, artifactsDir)
    ).toThrow(/outside/i);
  });

  test('rejects an absolute path outside both allowed roots', () => {
    const html = join(outsideDir, 'absolute.html');
    writeFileSync(html, '<html></html>');
    expect(() => resolveGateDocumentPath(html, new Map(), cwd, artifactsDir)).toThrow(/outside/i);
  });

  test('rejects a symlink under cwd whose real target escapes both roots', () => {
    const target = join(outsideDir, 'target.html');
    const link = join(cwd, 'linked.html');
    writeFileSync(target, '<html></html>');
    symlinkSync(target, link);
    expect(() => resolveGateDocumentPath(link, new Map(), cwd, artifactsDir)).toThrow(/outside/i);
  });
});

describe('buildReworkPrompt', () => {
  test('preserves placeholder text inside inserted reviewer annotations', () => {
    const annotations = 'Keep $REVIEW_DOCUMENT and $REVIEW_ANNOTATIONS literal.';
    expect(
      buildReworkPrompt(
        'Document: $REVIEW_DOCUMENT\nAnnotations: $REVIEW_ANNOTATIONS',
        '/tmp/plan.html',
        annotations
      )
    ).toBe(`Document: /tmp/plan.html\nAnnotations: ${annotations}`);
  });

  test('preserves placeholder text inside the document path', () => {
    const documentPath = '/tmp/$REVIEW_ANNOTATIONS/plan.html';
    expect(
      buildReworkPrompt(
        'Document: $REVIEW_DOCUMENT\nAnnotations: $REVIEW_ANNOTATIONS',
        documentPath,
        'Fix the heading.'
      )
    ).toBe(`Document: ${documentPath}\nAnnotations: Fix the heading.`);
  });
});

describe('preflightPlannotatorBinary', () => {
  test('throws a clear error when binary is missing', () => {
    const prev = process.env.PLANNOTATOR_BIN;
    process.env.PLANNOTATOR_BIN = '/nonexistent/plannotator-binary-xyz';
    try {
      expect(() => preflightPlannotatorBinary()).toThrow(/binary not found/);
    } finally {
      if (prev === undefined) delete process.env.PLANNOTATOR_BIN;
      else process.env.PLANNOTATOR_BIN = prev;
    }
  });
});

describe('resolvePlannotatorGateId', () => {
  test('reuses an unresolved opening token for the same node', () => {
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'gate',
      gateId: 'gate-b',
      phase: 'opening',
      resolved: null,
    });

    expect(resolvePlannotatorGateId(run, 'gate')).toBe('gate-b');
  });

  test('creates a fresh token for a different or non-opening gate', () => {
    const run = makeRun({
      type: 'plannotator_gate',
      nodeId: 'other',
      gateId: 'gate-a',
      phase: 'waiting_decision',
      resolved: null,
    });

    expect(resolvePlannotatorGateId(run, 'gate')).not.toBe('gate-a');
  });
});
