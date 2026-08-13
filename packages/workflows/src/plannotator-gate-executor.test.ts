import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
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

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `plannotator-gate-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves $node.output path ref to existing file', () => {
    const html = join(dir, 'doc.html');
    writeFileSync(html, '<html></html>');
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: html }],
    ]);
    expect(resolveGateDocumentPath('$explain.output', outputs, dir)).toBe(html);
  });

  test('throws when file missing', () => {
    const outputs = new Map<string, NodeOutput>([
      ['explain', { state: 'completed', output: join(dir, 'nope.html') }],
    ]);
    expect(() => resolveGateDocumentPath('$explain.output', outputs, dir)).toThrow(
      /document not found/
    );
  });

  test('resolves relative path against cwd', () => {
    writeFileSync(join(dir, 'rel.html'), '<html></html>');
    const outputs = new Map<string, NodeOutput>();
    expect(resolveGateDocumentPath('rel.html', outputs, dir)).toBe(join(dir, 'rel.html'));
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
