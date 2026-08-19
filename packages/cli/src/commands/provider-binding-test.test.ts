import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerBindingTestCommand } from './provider-binding-test';

function sampleEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 'workflow-event-envelope.v1',
    provider: 'archon',
    eventId: 'evt-test',
    eventType: 'workflow.run.started',
    occurredAt: '2026-08-18T00:00:00.000Z',
    bindingRef: {
      provider: 'archon',
      name: 'workflow-engine-primary',
      bindingId: 'wpb_archon::workflow_engine_primary',
      projectRef: 'project:cb-1',
    },
    workflowRunRef: {
      provider: 'archon',
      runId: 'run-1',
      workflowName: 'bmad-dev-story',
      projectRef: 'project:cb-1',
    },
    projectRef: {
      id: 'cb-1',
      codebaseRef: 'workflow-engine',
      repositoryPath: '/workspace/workflow-engine',
      defaultBranch: 'dev',
    },
    idempotencyKey: 'archon:workflow-engine-primary:evt-test',
    payload: { state: 'running', startedAt: '2026-08-18T00:00:00.000Z' },
  };
}

test('returns the exact transformed string, byte length, and sample bindingRef', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  writeFileSync(
    transformFile,
    JSON.stringify({ engine: 'jsonata', expression: '{ "eventType": eventType }' })
  );
  writeFileSync(envelopeFile, JSON.stringify(sampleEnvelope()));
  try {
    const logs: string[] = [];
    const exitCode = await providerBindingTestCommand(
      { transformFile, envelopeFile, correlationId: 'corr-test' },
      { json: true, log: line => logs.push(line) }
    );
    expect(exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      command: 'binding.test',
      success: true,
      correlationId: 'corr-test',
      bindingRef: sampleEnvelope().bindingRef as Record<string, unknown>,
      result: {
        operation: 'test',
        engine: 'jsonata',
        transformedBody: '{"eventType":"workflow.run.started"}',
        outputBytes: 36,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects missing and blank required file flags with safe field errors', async () => {
  for (const args of [{}, { transformFile: '  ', envelopeFile: '\t' }]) {
    const logs: string[] = [];
    const exitCode = await providerBindingTestCommand(args, {
      json: true,
      log: line => logs.push(line),
    });
    expect(exitCode).toBe(64);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      success: false,
      error: {
        code: 'MALFORMED_REQUEST',
        details: {
          fieldErrors: [
            { path: '/transform', code: 'required' },
            { path: '/envelope', code: 'required' },
          ],
        },
      },
    });
  }
});

test('uses safe errors for null config, invalid envelope, and scalar output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  try {
    for (const testCase of [
      { transform: null, envelope: sampleEnvelope(), code: 'TRANSFORM_CONFIG_INVALID' },
      {
        transform: { engine: 'jsonata', expression: '{}' },
        envelope: {},
        code: 'MALFORMED_REQUEST',
      },
      {
        transform: { engine: 'jsonata', expression: 'eventType' },
        envelope: sampleEnvelope(),
        code: 'TRANSFORM_RESULT_INVALID',
      },
    ]) {
      writeFileSync(transformFile, JSON.stringify(testCase.transform));
      writeFileSync(envelopeFile, JSON.stringify(testCase.envelope));
      const logs: string[] = [];
      const exitCode = await providerBindingTestCommand(
        { transformFile, envelopeFile },
        { json: true, log: line => logs.push(line) }
      );
      expect(exitCode).not.toBe(0);
      expect(JSON.parse(logs[0] as string)).toMatchObject({
        success: false,
        error: { code: testCase.code },
      });
      expect(logs[0]).not.toContain(dir);
      expect(logs[0]).not.toContain('workflow-event-envelope.v1');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a deterministic evaluator timeout to exit 69 without input leakage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archon-binding-test-'));
  const transformFile = join(dir, 'transform.json');
  const envelopeFile = join(dir, 'envelope.json');
  writeFileSync(
    transformFile,
    JSON.stringify({
      engine: 'jsonata',
      expression: '{ "n": [1..20] }',
      timeoutMs: 1,
      maxSequenceSize: 100,
    })
  );
  writeFileSync(envelopeFile, JSON.stringify(sampleEnvelope()));
  let now = 0;
  const dateNow = spyOn(Date, 'now').mockImplementation(() => {
    now += 10;
    return now;
  });
  try {
    const logs: string[] = [];
    const exitCode = await providerBindingTestCommand(
      { transformFile, envelopeFile },
      { json: true, log: line => logs.push(line) }
    );
    expect(exitCode).toBe(69);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      success: false,
      error: {
        code: 'TRANSFORM_TIMEOUT',
        category: 'timeout',
        retryable: false,
      },
      execution: { exitCode: 69, timedOut: true },
    });
    expect(logs[0]).not.toContain(dir);
    expect(logs[0]).not.toContain('[1..20]');
  } finally {
    dateNow.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source has no DB, outbox, or HTTP dependency', () => {
  const source = readFileSync(join(import.meta.dir, 'provider-binding-test.ts'), 'utf8');
  expect(source).not.toContain('@archon/core/db');
  expect(source).not.toContain('createBinding');
  expect(source).not.toContain('enqueueExternalWorkflowEvent');
  expect(source).not.toMatch(/\bfetch\s*\(/);
});
