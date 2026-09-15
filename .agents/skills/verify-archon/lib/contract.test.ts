import { describe, expect, test } from 'bun:test';
import { buildCatalog, normalizeProposal, evaluatePlaywright } from './contract';

const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const feature = {
  version: 1,
  id: 'hitl',
  description: 'Answer pending workflow questions',
  impact_paths: ['packages/web/**'],
  behaviors: [
    {
      id: 'hitl.answer',
      description: 'Answer is retained',
      priority: 'P1',
      scenarios: ['hitl.submit'],
    },
    {
      id: 'hitl.history',
      description: 'Read complete history',
      priority: 'P1',
      scenarios: ['hitl.history'],
    },
  ],
  scenarios: [
    {
      id: 'hitl.submit',
      runner: { kind: 'playwright', file: 'ui/hitl.spec.ts' },
      proof_obligations: ['browser-action', 'persistence-read-back'],
    },
    {
      id: 'hitl.history',
      runner: { kind: 'playwright', file: 'ui/hitl.spec.ts' },
      proof_obligations: ['final-ui'],
    },
  ],
};
const snapshot = {
  base_sha: sha,
  head_sha: head,
  changed_paths: ['packages/web/Ask.tsx'],
  dirty: false,
};
const proposal = {
  version: 1,
  base_sha: sha,
  head_sha: head,
  changed_paths: snapshot.changed_paths,
  affected_behaviors: [
    { id: 'hitl.answer', confidence: 'high', rationale: 'The Submit handler changed.' },
  ],
  coverage_gaps: [],
};

describe('verification catalog', () => {
  test('rejects a behavior without runnable scenarios', () => {
    expect(() => buildCatalog([{ ...feature, scenarios: [] }])).toThrow('hitl.submit');
    expect(() =>
      buildCatalog([{ ...feature, behaviors: [{ ...feature.behaviors[0], scenarios: [] }] }])
    ).toThrow();
  });

  test('rejects globally duplicated behavior and scenario IDs', () => {
    expect(() => buildCatalog([feature, { ...feature, id: 'other' }])).toThrow('Duplicate');
  });

  test('rejects scenario descriptors that escape the suite', () => {
    expect(() =>
      buildCatalog([
        {
          ...feature,
          scenarios: [
            { ...feature.scenarios[0], runner: { kind: 'playwright', file: '../outside.spec.ts' } },
          ],
        },
      ])
    ).toThrow();
  });
});

describe('selection normalization', () => {
  const catalog = buildCatalog([feature]);

  test('derives scenarios from behavior links', () => {
    const selected = normalizeProposal(catalog, proposal, snapshot);
    expect(selected.scenario_ids).toEqual(['hitl.submit']);
    expect(selected.behavior_ids).toEqual(['hitl.answer']);
  });

  test('broadens uncertain impact to every behavior in the feature', () => {
    const selected = normalizeProposal(
      catalog,
      {
        ...proposal,
        affected_behaviors: [{ ...proposal.affected_behaviors[0], confidence: 'low' }],
      },
      snapshot
    );
    expect(selected.scenario_ids).toEqual(['hitl.history', 'hitl.submit']);
    expect(selected.behavior_ids).toEqual(['hitl.answer', 'hitl.history']);
  });

  test('rejects an unknown behavior rather than choosing an unrelated smoke', () => {
    expect(() =>
      normalizeProposal(
        catalog,
        {
          ...proposal,
          affected_behaviors: [{ ...proposal.affected_behaviors[0], id: 'unknown.behavior' }],
        },
        snapshot
      )
    ).toThrow('Unknown behavior');
  });

  test('rejects an empty selection', () => {
    expect(() =>
      normalizeProposal(catalog, { ...proposal, affected_behaviors: [] }, snapshot)
    ).toThrow();
  });

  test('rejects an empty change diff unless historical mode is explicit', () => {
    const unchanged = {
      ...snapshot,
      base_sha: head,
      changed_paths: [],
    };
    const historicalProposal = {
      ...proposal,
      base_sha: head,
      changed_paths: [],
    };
    expect(() => normalizeProposal(catalog, historicalProposal, unchanged)).toThrow('empty diff');
    expect(normalizeProposal(catalog, historicalProposal, unchanged, 'historical').mode).toBe(
      'historical'
    );
  });

  test('rejects unknown changed paths and explicit coverage gaps', () => {
    const changed_paths = ['packages/providers/src/claude/native-tools.ts'];
    expect(() =>
      normalizeProposal(catalog, { ...proposal, changed_paths }, { ...snapshot, changed_paths })
    ).toThrow('Unmapped');
    expect(() =>
      normalizeProposal(
        catalog,
        { ...proposal, coverage_gaps: ['No unowned-run scenario'] },
        snapshot
      )
    ).toThrow('coverage');
  });

  test('rejects stale SHA, omitted paths, and a dirty product checkout', () => {
    expect(() =>
      normalizeProposal(catalog, proposal, { ...snapshot, head_sha: 'c'.repeat(40) })
    ).toThrow('SHA');
    expect(() =>
      normalizeProposal(catalog, proposal, {
        ...snapshot,
        changed_paths: [...snapshot.changed_paths, 'packages/web/Other.tsx'],
      })
    ).toThrow('paths');
    expect(() => normalizeProposal(catalog, proposal, { ...snapshot, dirty: true })).toThrow(
      'dirty'
    );
  });

  test('broadens to another path-impacted feature even if the agent omitted it', () => {
    const second = {
      ...feature,
      id: 'console',
      behaviors: [{ ...feature.behaviors[0], id: 'console.shell', scenarios: ['console.shell'] }],
      scenarios: [{ ...feature.scenarios[0], id: 'console.shell' }],
    };
    const selected = normalizeProposal(buildCatalog([feature, second]), proposal, snapshot);
    expect(selected.scenario_ids).toEqual(['console.shell', 'hitl.submit']);
  });

  test('a high-confidence history proposal cannot omit the mapped Ask action', () => {
    const mapped = buildCatalog([
      {
        ...feature,
        behaviors: [
          { ...feature.behaviors[0], impact_paths: ['packages/web/Ask.tsx'] },
          feature.behaviors[1],
        ],
      },
    ]);
    const selected = normalizeProposal(
      mapped,
      {
        ...proposal,
        affected_behaviors: [
          { id: 'hitl.history', confidence: 'high', rationale: 'The room still opens.' },
        ],
      },
      snapshot
    );
    expect(selected.scenario_ids).toEqual(['hitl.history', 'hitl.submit']);
  });
});

function report(status = 'expected', attempts = ['passed'], expectedStatus = 'passed'): unknown {
  return {
    suites: [
      {
        suites: [
          {
            specs: [
              {
                title: '[P1] [V:hitl.submit] Submit',
                tests: [{ status, expectedStatus, results: attempts.map(status => ({ status })) }],
              },
            ],
          },
        ],
      },
    ],
    errors: [],
  };
}

describe('executable verdict', () => {
  test('accepts a single successful required scenario', () => {
    expect(evaluatePlaywright(report(), ['hitl.submit'])[0]?.status).toBe('passed');
  });

  test('fails missing, skipped, flaky, failed, and expected-to-fail scenarios', () => {
    expect(evaluatePlaywright(report(), ['hitl.missing'])[0]?.status).toBe('missing');
    expect(evaluatePlaywright(report('skipped', ['skipped']), ['hitl.submit'])[0]?.status).toBe(
      'skipped'
    );
    expect(
      evaluatePlaywright(report('flaky', ['failed', 'passed']), ['hitl.submit'])[0]?.status
    ).toBe('flaky');
    expect(evaluatePlaywright(report('unexpected', ['failed']), ['hitl.submit'])[0]?.status).toBe(
      'failed'
    );
    expect(
      evaluatePlaywright(report('expected', ['failed'], 'failed'), ['hitl.submit'])[0]?.status
    ).toBe('failed');
  });

  test('does not turn an unrelated passing scenario into required proof', () => {
    expect(evaluatePlaywright(report(), ['hitl.history'])).toMatchObject([
      { id: 'hitl.history', status: 'missing' },
    ]);
  });

  test('rejects duplicate executions of one scenario identity', () => {
    const item = report() as { suites: unknown[]; errors: unknown[] };
    expect(
      evaluatePlaywright({ ...item, suites: [...item.suites, ...item.suites] }, ['hitl.submit'])[0]
        ?.status
    ).toBe('failed');
  });

  test('reports an unsupported setup separately from a product assertion failure', () => {
    const input = {
      suites: [
        {
          specs: [
            {
              title: '[V:hitl.submit] Submit',
              tests: [
                {
                  status: 'unexpected',
                  expectedStatus: 'passed',
                  results: [{ status: 'failed' }],
                  annotations: [{ type: 'verification-setup', description: 'unsupported' }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    };
    expect(evaluatePlaywright(input, ['hitl.submit'])[0]?.status).toBe('unsupported');
  });
});
