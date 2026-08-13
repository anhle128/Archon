import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildAnnotateArgv,
  parseDocumentPathFromNodeOutput,
  parsePlannotatorGateDecisionJson,
  resolvePlannotatorBinary,
} from './plannotator-gate';

describe('parseDocumentPathFromNodeOutput', () => {
  test('returns a single-line trimmed path', () => {
    expect(parseDocumentPathFromNodeOutput('  /tmp/plan.html  ')).toBe('/tmp/plan.html');
  });

  test('throws when output contains trailing commentary', () => {
    expect(() =>
      parseDocumentPathFromNodeOutput('\n\n  /artifacts/runs/1/explain.html\ntrailing noise\n')
    ).toThrow(/one non-empty line/i);
  });

  test('preserves spaces inside a path', () => {
    expect(parseDocumentPathFromNodeOutput('/tmp/my plan/file.html\n')).toBe(
      '/tmp/my plan/file.html'
    );
  });

  test('throws when output is empty or whitespace-only', () => {
    expect(() => parseDocumentPathFromNodeOutput('')).toThrow(/empty/i);
    expect(() => parseDocumentPathFromNodeOutput('   \n\t\n  ')).toThrow(/empty/i);
  });
});

describe('parsePlannotatorGateDecisionJson', () => {
  test('parses approved without feedback', () => {
    expect(parsePlannotatorGateDecisionJson('{"decision":"approved"}')).toEqual({
      kind: 'approved',
      feedback: '',
    });
  });

  test('parses approved with feedback', () => {
    expect(
      parsePlannotatorGateDecisionJson('{"decision":"approved","feedback":"Looks good"}')
    ).toEqual({
      kind: 'approved',
      feedback: 'Looks good',
    });
  });

  test('parses annotated with feedback', () => {
    expect(
      parsePlannotatorGateDecisionJson(
        '{"decision":"annotated","feedback":"## Notes\\n- fix header"}'
      )
    ).toEqual({
      kind: 'annotated',
      feedback: '## Notes\n- fix header',
    });
  });

  test('parses dismissed', () => {
    expect(parsePlannotatorGateDecisionJson('{"decision":"dismissed"}')).toEqual({
      kind: 'dismissed',
    });
  });

  test('uses the last non-empty line when stdout has log noise', () => {
    const stdout = [
      'Starting annotate server on :8787',
      'Session ready',
      '',
      '{"decision":"approved","feedback":"ok"}',
      '',
    ].join('\n');
    expect(parsePlannotatorGateDecisionJson(stdout)).toEqual({
      kind: 'approved',
      feedback: 'ok',
    });
  });

  test('throws on empty stdout', () => {
    expect(() => parsePlannotatorGateDecisionJson('')).toThrow();
    expect(() => parsePlannotatorGateDecisionJson('  \n\n')).toThrow();
  });

  test('throws on non-JSON last line (no false approve)', () => {
    expect(() => parsePlannotatorGateDecisionJson('The user approved.')).toThrow(/json/i);
  });

  test('throws when decision field is missing', () => {
    expect(() => parsePlannotatorGateDecisionJson('{"feedback":"x"}')).toThrow(/decision/i);
  });

  test('throws when decision is unknown', () => {
    expect(() => parsePlannotatorGateDecisionJson('{"decision":"maybe"}')).toThrow(/decision/i);
  });

  test('throws when last line is a JSON array or primitive', () => {
    expect(() => parsePlannotatorGateDecisionJson('"approved"')).toThrow();
    expect(() => parsePlannotatorGateDecisionJson('["approved"]')).toThrow();
  });
});

describe('buildAnnotateArgv', () => {
  test('returns fixed annotate gate flags with the document path', () => {
    expect(buildAnnotateArgv('/tmp/doc.html')).toEqual([
      'annotate',
      '/tmp/doc.html',
      '--gate',
      '--json',
      '--persist-session',
    ]);
  });

  test('does not shell-escape the path (spawn argv is already tokenized)', () => {
    expect(buildAnnotateArgv('/tmp/my plan/doc.html')[1]).toBe('/tmp/my plan/doc.html');
  });
});

describe('resolvePlannotatorBinary', () => {
  const original = process.env.PLANNOTATOR_BIN;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLANNOTATOR_BIN;
    } else {
      process.env.PLANNOTATOR_BIN = original;
    }
  });

  test('defaults to plannotator when PLANNOTATOR_BIN is unset', () => {
    delete process.env.PLANNOTATOR_BIN;
    expect(resolvePlannotatorBinary()).toBe('plannotator');
  });

  test('returns PLANNOTATOR_BIN when set', () => {
    process.env.PLANNOTATOR_BIN = '/opt/bin/plannotator';
    expect(resolvePlannotatorBinary()).toBe('/opt/bin/plannotator');
  });
});
