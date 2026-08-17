import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildAnnotateArgv,
  buildPlannotatorSpawnArgv,
  parseDocumentPathFromNodeOutput,
  parsePlannotatorGateDecisionJson,
  resolvePlannotatorBinary,
} from './plannotator-gate';

describe('parseDocumentPathFromNodeOutput', () => {
  test('returns a single-line trimmed path', () => {
    expect(parseDocumentPathFromNodeOutput('  /tmp/plan.html  ')).toBe('/tmp/plan.html');
  });

  test('returns the final path when a provider adds leading commentary', () => {
    expect(
      parseDocumentPathFromNodeOutput(
        'File written, non-empty, self-contained.\n\n  /artifacts/runs/1/explain.html\n'
      )
    ).toBe('/artifacts/runs/1/explain.html');
  });

  test('unwraps a final path formatted as inline Markdown code', () => {
    expect(
      parseDocumentPathFromNodeOutput(
        'Existing explainer HTML is already up to date.\n\n**Final output:**\n`/artifacts/runs/1/explain.html`\n'
      )
    ).toBe('/artifacts/runs/1/explain.html');
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

  test('allows surrounding whitespace around the JSON object', () => {
    expect(
      parsePlannotatorGateDecisionJson(' \t\n  {"decision":"approved","feedback":"ok"}\r\n\t ')
    ).toEqual({
      kind: 'approved',
      feedback: 'ok',
    });
  });

  test('rejects non-whitespace before or after the JSON object', () => {
    expect(() => parsePlannotatorGateDecisionJson('log\n{"decision":"approved"}')).toThrow(/json/i);
    expect(() => parsePlannotatorGateDecisionJson('{"decision":"approved"}\nlog')).toThrow(/json/i);
  });

  test('throws on an empty result-file payload', () => {
    expect(() => parsePlannotatorGateDecisionJson('')).toThrow();
    expect(() => parsePlannotatorGateDecisionJson('  \n\n')).toThrow();
  });

  test('throws on a non-JSON payload (no false approve)', () => {
    expect(() => parsePlannotatorGateDecisionJson('The user approved.')).toThrow(/json/i);
  });

  test('throws when decision field is missing', () => {
    expect(() => parsePlannotatorGateDecisionJson('{"feedback":"x"}')).toThrow(/decision/i);
  });

  test('throws when decision is unknown', () => {
    expect(() => parsePlannotatorGateDecisionJson('{"decision":"maybe"}')).toThrow(/decision/i);
  });

  test('throws when the payload is a JSON array or primitive', () => {
    expect(() => parsePlannotatorGateDecisionJson('"approved"')).toThrow();
    expect(() => parsePlannotatorGateDecisionJson('["approved"]')).toThrow();
  });
});

describe('buildAnnotateArgv', () => {
  test('returns fixed annotate gate flags with the document path', () => {
    expect(buildAnnotateArgv('/tmp/doc.html', '/tmp/result.json')).toEqual([
      'annotate',
      '/tmp/doc.html',
      '--gate',
      '--json',
      '--persist-session',
      '--result-file',
      '/tmp/result.json',
    ]);
  });

  test('does not shell-escape the path (spawn argv is already tokenized)', () => {
    expect(buildAnnotateArgv('/tmp/my plan/doc.html', '/tmp/my results/result.json')).toEqual([
      'annotate',
      '/tmp/my plan/doc.html',
      '--gate',
      '--json',
      '--persist-session',
      '--result-file',
      '/tmp/my results/result.json',
    ]);
  });
});

describe('buildPlannotatorSpawnArgv', () => {
  test('runs Windows command shims through cmd.exe', () => {
    expect(
      buildPlannotatorSpawnArgv('C:\\tools\\plannotator.CMD', ['annotate', '--help'], 'win32')
    ).toEqual(['cmd.exe', '/d', '/s', '/c', 'C:\\tools\\plannotator.CMD', 'annotate', '--help']);
  });

  test('runs native executables directly', () => {
    expect(buildPlannotatorSpawnArgv('/usr/bin/plannotator', ['annotate'], 'linux')).toEqual([
      '/usr/bin/plannotator',
      'annotate',
    ]);
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
