import { describe, test, expect } from 'bun:test';
import { validateContent } from './content';
import { wf } from './test-helpers';

describe('validateContent', () => {
  test('valid upstream output ref passes', () => {
    const issues = validateContent(
      wf([
        { id: 'classify', variant: 'prompt', base: {}, data: { prompt: 'classify it' } },
        {
          id: 'use',
          variant: 'prompt',
          base: { depends_on: ['classify'] },
          data: { prompt: 'Given $classify.output, proceed.' },
        },
      ])
    );
    expect(issues.filter(i => i.rule === 'content.var.unknown')).toEqual([]);
  });

  test('reference to a non-upstream node warns', () => {
    const issues = validateContent(
      wf([
        { id: 'classify', variant: 'prompt', base: {}, data: { prompt: 'classify it' } },
        {
          id: 'use',
          variant: 'prompt',
          base: {},
          data: { prompt: 'Given $classify.output, proceed.' },
        },
      ])
    );
    expect(issues.some(i => i.rule === 'content.var.unknown')).toBe(true);
  });

  test('refs inside code spans are ignored', () => {
    const issues = validateContent(
      wf([
        {
          id: 'use',
          variant: 'prompt',
          base: {},
          data: { prompt: 'Example: `$ghost.output` and ```\n$other.output\n``` are docs.' },
        },
      ])
    );
    expect(issues.filter(i => i.rule === 'content.var.unknown')).toEqual([]);
  });

  test('self-reference warns (a node is not its own upstream)', () => {
    const issues = validateContent(
      wf([{ id: 'me', variant: 'prompt', base: {}, data: { prompt: 'loop on $me.output' } }])
    );
    expect(issues.some(i => i.rule === 'content.var.unknown')).toBe(true);
  });

  test('body scanning covers bash, script, loop, approval, and plannotator text bodies', () => {
    const issues = validateContent(
      wf([
        { id: 'b', variant: 'bash', base: {}, data: { bash: 'echo $ghostA.output' } },
        {
          id: 's',
          variant: 'script',
          base: {},
          data: { script: 'console.log("$ghostB.output")', runtime: 'bun' },
        },
        {
          id: 'l',
          variant: 'loop',
          base: {},
          data: {
            prompt: 'iterate on $ghostC.output',
            until: 'COMPLETE',
            max_iterations: 3,
            fresh_context: false,
          },
        },
        {
          id: 'a',
          variant: 'approval',
          base: {},
          data: { message: 'Approve $ghostD.output?' },
        },
        {
          id: 'g',
          variant: 'plannotator_gate',
          base: {},
          data: {
            prepare: { prompt: 'Build $ghostE.output.' },
            message: 'Review $ghostF.output.',
            rework: { prompt: 'Apply $ghostG.output.' },
          },
        },
      ])
    );
    const flagged = issues
      .filter(i => i.rule === 'content.var.unknown')
      .map(i => i.path.nodeId)
      .sort();
    expect(flagged).toEqual(['a', 'b', 'g', 'g', 'g', 'l', 's']);
  });

  test('upstream refs in non-prompt bodies pass', () => {
    const issues = validateContent(
      wf([
        { id: 'gen', variant: 'prompt', base: {}, data: { prompt: 'make a thing' } },
        {
          id: 'b',
          variant: 'bash',
          base: { depends_on: ['gen'] },
          data: { bash: 'echo $gen.output' },
        },
      ])
    );
    expect(issues.filter(i => i.rule === 'content.var.unknown')).toEqual([]);
  });

  test('route targets can reference nodes upstream of their route controller', () => {
    const issues = validateContent(
      wf([
        { id: 'review', variant: 'prompt', base: {}, data: { prompt: 'Review it.' } },
        {
          id: 'router',
          variant: 'route_loop',
          base: { depends_on: ['review'] },
          data: {
            condition: "$review.output.status == 'approved'",
            max_iterations: 3,
            routes: { positive: 'done', negative: 'gate', exhausted: 'abort' },
          },
        },
        {
          id: 'gate',
          variant: 'plannotator_gate',
          base: {},
          data: {
            document: 'review.html',
            message: 'Review $review.output.',
            rework: { prompt: 'Apply annotations to $review.output.' },
          },
        },
      ])
    );

    expect(issues.filter(i => i.rule === 'content.var.unknown')).toEqual([]);
  });

  test('cancel nodes have no scannable body', () => {
    const issues = validateContent(
      wf([{ id: 'c', variant: 'cancel', base: {}, data: { reason: 'stop: $ghost.output' } }])
    );
    expect(issues.filter(i => i.rule === 'content.var.unknown')).toEqual([]);
  });

  test('valid when expression passes; malformed when errors', () => {
    const ok = validateContent(
      wf([
        { id: 'a', variant: 'prompt', base: {}, data: { prompt: 'x' } },
        {
          id: 'b',
          variant: 'prompt',
          base: { depends_on: ['a'], when: "$a.output == 'YES'" },
          data: { prompt: 'y' },
        },
      ])
    );
    expect(ok.filter(i => i.rule === 'content.when.parse')).toEqual([]);

    const bad = validateContent(
      wf([
        {
          id: 'b',
          variant: 'prompt',
          base: { when: 'not a valid expression' },
          data: { prompt: 'y' },
        },
      ])
    );
    expect(bad.some(i => i.rule === 'content.when.parse')).toBe(true);
  });
});
