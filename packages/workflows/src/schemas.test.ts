import { describe, test, expect } from 'bun:test';
import {
  isBashNode,
  isCancelNode,
  isRouteLoopNode,
  isScriptNode,
  isLoopNode,
  isLoopGroupNode,
  isIncludeNode,
  isTriggerRule,
  TRIGGER_RULES,
  SCRIPT_NODE_AI_FIELDS,
  LOOP_NODE_AI_FIELDS,
  LOOP_GROUP_NODE_AI_FIELDS,
  INCLUDE_NODE_IGNORED_FIELDS,
  BASH_NODE_AI_FIELDS,
  approvalOnRejectSchema,
  dagNodeSchema,
  routeLoopConfigSchema,
  routeLoopRuntimeMetadataSchema,
  routeOutcomeSchema,
  workflowRunSchema,
} from './schemas';
import type {
  WorkflowDefinition,
  DagNode,
  CommandNode,
  PromptNode,
  BashNode,
  CancelNode,
  ScriptNode,
  IncludeNode,
  TriggerRule,
  RouteLoopNode,
  RouteLoopConfig,
} from './schemas';
import { applyRouteLoopTransition } from './route-loop-state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const commandNode: CommandNode = { id: 'n1', command: 'build' };
const promptNode: PromptNode = { id: 'n2', prompt: 'Do this inline.' };
const bashNode: BashNode = { id: 'n3', bash: 'echo hello' };
const cancelNode: CancelNode = { id: 'n5', cancel: 'Precondition failed' };

const dagWorkflow: WorkflowDefinition = {
  name: 'dag-workflow',
  description: 'DAG execution',
  nodes: [commandNode, promptNode, bashNode],
};

// ---------------------------------------------------------------------------
// isBashNode
// ---------------------------------------------------------------------------

describe('isBashNode', () => {
  test('returns true for a BashNode', () => {
    expect(isBashNode(bashNode)).toBe(true);
  });

  test('returns true for a BashNode with timeout', () => {
    const withTimeout: BashNode = { id: 'b', bash: 'npm test', timeout: 60000 };
    expect(isBashNode(withTimeout)).toBe(true);
  });

  test('returns true for a BashNode with depends_on', () => {
    const withDeps: BashNode = { id: 'b', bash: 'echo done', depends_on: ['n1'] };
    expect(isBashNode(withDeps)).toBe(true);
  });

  test('returns false for a CommandNode', () => {
    expect(isBashNode(commandNode)).toBe(false);
  });

  test('returns false for a PromptNode', () => {
    expect(isBashNode(promptNode)).toBe(false);
  });

  test('returns false when bash field is missing', () => {
    const noCmd = { id: 'x', command: 'build' } as DagNode;
    expect(isBashNode(noCmd)).toBe(false);
  });

  test('returns false when bash is not a string (malformed node)', () => {
    // Deliberately violate the type to ensure the runtime check catches it
    const malformed = { id: 'x', bash: 42 } as unknown as DagNode;
    expect(isBashNode(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCancelNode
// ---------------------------------------------------------------------------

describe('isCancelNode', () => {
  test('returns true for a CancelNode', () => {
    expect(isCancelNode(cancelNode)).toBe(true);
  });

  test('returns false for a CommandNode', () => {
    expect(isCancelNode(commandNode)).toBe(false);
  });

  test('returns false for a PromptNode', () => {
    expect(isCancelNode(promptNode)).toBe(false);
  });

  test('returns false for a BashNode', () => {
    expect(isCancelNode(bashNode)).toBe(false);
  });

  test('returns false when cancel is not a string (malformed node)', () => {
    const malformed = { id: 'x', cancel: 42 } as unknown as DagNode;
    expect(isCancelNode(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTriggerRule
// ---------------------------------------------------------------------------

describe('isTriggerRule', () => {
  test('returns true for all canonical trigger rules', () => {
    const rules: string[] = [...TRIGGER_RULES];
    for (const rule of rules) {
      expect(isTriggerRule(rule)).toBe(true);
    }
  });

  test('returns true for "all_success"', () => {
    expect(isTriggerRule('all_success')).toBe(true);
  });

  test('returns true for "one_success"', () => {
    expect(isTriggerRule('one_success')).toBe(true);
  });

  test('returns true for "none_failed_min_one_success"', () => {
    expect(isTriggerRule('none_failed_min_one_success')).toBe(true);
  });

  test('returns true for "all_done"', () => {
    expect(isTriggerRule('all_done')).toBe(true);
  });

  test('returns false for an unknown string', () => {
    expect(isTriggerRule('any_success')).toBe(false);
  });

  test('returns false for an empty string', () => {
    expect(isTriggerRule('')).toBe(false);
  });

  test('returns false for a number', () => {
    expect(isTriggerRule(1)).toBe(false);
  });

  test('returns false for null', () => {
    expect(isTriggerRule(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isTriggerRule(undefined)).toBe(false);
  });

  test('returns false for an object', () => {
    expect(isTriggerRule({})).toBe(false);
  });

  test('is used as a TriggerRule type after guard (compile-time verification)', () => {
    const value: unknown = 'all_success';
    if (isTriggerRule(value)) {
      // TypeScript should narrow value to TriggerRule here
      const rule: TriggerRule = value;
      expect(rule).toBe('all_success');
    } else {
      // Should not reach here
      expect(true).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TRIGGER_RULES constant
// ---------------------------------------------------------------------------

describe('TRIGGER_RULES', () => {
  test('contains exactly four entries', () => {
    expect(TRIGGER_RULES).toHaveLength(4);
  });

  test('all entries are strings', () => {
    for (const rule of TRIGGER_RULES) {
      expect(typeof rule).toBe('string');
    }
  });

  test('is readonly (does not expose mutation methods at runtime)', () => {
    // The readonly modifier is enforced at compile time; at runtime it's a plain array.
    // Verify the values are stable and match expectations.
    expect(TRIGGER_RULES).toContain('all_success');
    expect(TRIGGER_RULES).toContain('one_success');
    expect(TRIGGER_RULES).toContain('none_failed_min_one_success');
    expect(TRIGGER_RULES).toContain('all_done');
  });
});

// ---------------------------------------------------------------------------
// approvalOnRejectSchema
// ---------------------------------------------------------------------------

describe('approvalOnRejectSchema', () => {
  test('accepts valid on_reject config', () => {
    const result = approvalOnRejectSchema.safeParse({
      prompt: 'Fix: $REJECTION_REASON',
      max_attempts: 3,
    });
    expect(result.success).toBe(true);
  });

  test('accepts on_reject without max_attempts (uses default)', () => {
    const result = approvalOnRejectSchema.safeParse({ prompt: 'Please revise' });
    expect(result.success).toBe(true);
  });

  test('rejects empty prompt', () => {
    const result = approvalOnRejectSchema.safeParse({ prompt: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('on_reject.prompt');
  });

  test('rejects max_attempts: 0', () => {
    const result = approvalOnRejectSchema.safeParse({ prompt: 'Fix it', max_attempts: 0 });
    expect(result.success).toBe(false);
  });

  test('rejects max_attempts: 11', () => {
    const result = approvalOnRejectSchema.safeParse({ prompt: 'Fix it', max_attempts: 11 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema — empty bash/prompt validation
// ---------------------------------------------------------------------------

describe('dagNodeSchema — empty bash/prompt', () => {
  test('emits "bash script cannot be empty" for bash: ""', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1', bash: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('bash script cannot be empty');
    }
  });

  test('emits "bash script cannot be empty" for whitespace-only bash', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1', bash: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('bash script cannot be empty');
    }
  });

  test('emits "prompt cannot be empty" for prompt: ""', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1', prompt: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('prompt cannot be empty');
    }
  });

  test('emits "prompt cannot be empty" for whitespace-only prompt', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1', prompt: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('prompt cannot be empty');
    }
  });

  test('passes for bash: "echo hello"', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1', bash: 'echo hello' });
    expect(result.success).toBe(true);
  });

  test('still emits generic error when no mode field is present', () => {
    const result = dagNodeSchema.safeParse({ id: 'n1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('must have either');
    }
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema - RouteLoopNode
// ---------------------------------------------------------------------------

describe('dagNodeSchema - RouteLoopNode', () => {
  const routeLoopNode = {
    id: 'review-router',
    depends_on: ['review'],
    route_loop: {
      condition: '$review.output.approved == true',
      routes: {
        positive: 'done',
        negative: 'fix',
        exhausted: 'escalation',
      },
    },
  };

  test('parses a valid route_loop node and defaults max_iterations to 10', () => {
    const result = dagNodeSchema.safeParse(routeLoopNode);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(isRouteLoopNode(result.data)).toBe(true);
      const node = result.data as RouteLoopNode;
      expect(node.route_loop).toEqual({
        condition: '$review.output.approved == true',
        max_iterations: 10,
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalation',
        },
      });
    }
  });

  test('keeps explicit max_iterations inside the bounded route budget range', () => {
    const result = routeLoopConfigSchema.safeParse({
      condition: "$review.output == 'ok'",
      max_iterations: 1,
      routes: {
        positive: 'done',
        negative: 'fix',
        exhausted: 'escalation',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_iterations).toBe(1);
    }
  });

  test('rejects legacy route_loop.from', () => {
    const result = routeLoopConfigSchema.safeParse({
      from: 'review',
      condition: "$review.output == 'ok'",
      routes: {
        positive: 'done',
        negative: 'fix',
        exhausted: 'escalation',
      },
    });

    expect(result.success).toBe(false);
  });

  test('rejects route_loop combined with another execution mode', () => {
    const result = dagNodeSchema.safeParse({
      ...routeLoopNode,
      prompt: 'This must not be accepted.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
    }
  });

  test('rejects unsafe node ids and route target ids', () => {
    const unsafeIds = ['1review', 'review.router', '__proto__', 'a'.repeat(65)];

    for (const id of unsafeIds) {
      expect(dagNodeSchema.safeParse({ ...routeLoopNode, id }).success).toBe(false);
      expect(
        routeLoopConfigSchema.safeParse({
          condition: "$review.output == 'ok'",
          routes: {
            positive: id,
            negative: 'fix',
            exhausted: 'escalation',
          },
        }).success
      ).toBe(false);
    }
  });

  test('exposes exactly the supported route outcomes', () => {
    expect(routeOutcomeSchema.options).toEqual(['positive', 'negative', 'exhausted']);
    expect(routeOutcomeSchema.safeParse('retry').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema — Claude SDK options
// ---------------------------------------------------------------------------

describe('dagNodeSchema — provider options', () => {
  test('parses a future raw effort on prompt node unchanged', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', effort: '  ultra  ' });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as PromptNode).effort).toBe('  ultra  ');
  });

  test('rejects an empty effort value', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', effort: '' });
    expect(result.success).toBe(false);
  });

  test('parses thinking string shorthand: adaptive', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', thinking: 'adaptive' });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as PromptNode).thinking).toEqual({ type: 'adaptive' });
  });

  test('parses thinking string shorthand: disabled', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', thinking: 'disabled' });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as PromptNode).thinking).toEqual({ type: 'disabled' });
  });

  test('parses thinking object form with budgetTokens', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      thinking: { type: 'enabled', budgetTokens: 8000 },
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as PromptNode).thinking).toEqual({
        type: 'enabled',
        budgetTokens: 8000,
      });
  });

  test('rejects invalid thinking value', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', thinking: 'quantum' });
    expect(result.success).toBe(false);
  });

  test('parses maxBudgetUsd as positive number', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', maxBudgetUsd: 2.5 });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as PromptNode).maxBudgetUsd).toBe(2.5);
  });

  test('rejects negative maxBudgetUsd', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', maxBudgetUsd: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects zero maxBudgetUsd', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', maxBudgetUsd: 0 });
    expect(result.success).toBe(false);
  });

  test('parses betas array', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      betas: ['context-1m-2025-08-07'],
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as PromptNode).betas).toEqual(['context-1m-2025-08-07']);
  });

  test('rejects empty betas array', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', betas: [] });
    expect(result.success).toBe(false);
  });

  test('parses sandbox object', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      sandbox: { enabled: true, filesystem: { allowWrite: ['src/'] } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as PromptNode).sandbox?.enabled).toBe(true);
    }
  });

  test('parses systemPrompt string', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      systemPrompt: 'You are a security reviewer',
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as PromptNode).systemPrompt).toBe('You are a security reviewer');
  });

  test('rejects empty systemPrompt string', () => {
    const result = dagNodeSchema.safeParse({ id: 'n', prompt: 'do it', systemPrompt: '' });
    expect(result.success).toBe(false);
  });

  test('parses fallbackModel string', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      fallbackModel: 'claude-haiku-4-5-20251001',
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as PromptNode).fallbackModel).toBe('claude-haiku-4-5-20251001');
  });

  test('parses settingSources array of valid sources', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      settingSources: ['project'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as PromptNode).settingSources).toEqual(['project']);
  });

  test('rejects settingSources with invalid source value', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      settingSources: ['project', 'global'],
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-array settingSources', () => {
    const result = dagNodeSchema.safeParse({
      id: 'n',
      prompt: 'do it',
      settingSources: 'project',
    });
    expect(result.success).toBe(false);
  });

  test('strips settingSources from bash nodes', () => {
    const result = dagNodeSchema.safeParse({
      id: 'b',
      bash: 'echo hi',
      settingSources: ['project'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect('settingSources' in result.data).toBe(false);
  });

  test('strips AI-only fields from bash nodes', () => {
    const result = dagNodeSchema.safeParse({
      id: 'b',
      bash: 'echo hi',
      effort: 'high',
      thinking: 'adaptive',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // bash nodes don't get AI-only fields in the transform
      expect('effort' in result.data).toBe(false);
      expect('thinking' in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// workflowRunSchema - route-loop runtime metadata
// ---------------------------------------------------------------------------

describe('workflowRunSchema - route-loop runtime metadata', () => {
  const baseRun = {
    id: 'run-1',
    workflow_name: 'route-loop-workflow',
    conversation_id: 'conv-1',
    parent_conversation_id: null,
    codebase_id: null,
    status: 'running',
    user_message: 'Run the workflow',
    started_at: new Date('2026-06-27T00:00:00.000Z'),
    completed_at: null,
    last_activity_at: null,
    working_path: null,
    user_id: null,
    parent_run_id: null,
  };

  const reviewRouteLoop: RouteLoopConfig = {
    condition: "$review.output.result == 'positive'",
    max_iterations: 10,
    routes: {
      positive: 'done',
      negative: 'fix',
      exhausted: 'escalation',
    },
  };

  test('defaults missing route-loop runtime metadata to empty state', () => {
    expect(routeLoopRuntimeMetadataSchema.parse({})).toEqual({
      loopCounters: {},
      nodeAttempts: {},
      executionSeq: 0,
      routeActivations: {},
    });
  });

  test('accepts typed route-loop runtime metadata on workflow runs', () => {
    const result = workflowRunSchema.safeParse({
      ...baseRun,
      metadata: {
        approval: { nodeId: 'gate', message: 'Approve?' },
        loopCounters: { 'review-router': 2 },
        nodeAttempts: { fix: 3, review: 3, 'review-router': 2 },
        executionSeq: 8,
        routeActivations: {
          fix: {
            route_loop_node_id: 'review-router',
            outcome: 'negative',
            target_node_id: 'fix',
            attempt: 2,
            execution_seq: 6,
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test('keeps legacy effort metadata on old workflow-run records', () => {
    const result = workflowRunSchema.safeParse({
      ...baseRun,
      metadata: {
        modelReasoningEffort: 'xhigh',
        effort: 'future-ultra',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.modelReasoningEffort).toBe('xhigh');
      expect(result.data.metadata.effort).toBe('future-ultra');
    }
  });

  test('rejects malformed route-loop runtime metadata before route decisions mutate state', () => {
    const malformedRuns = [
      { loopCounters: { router: -1 } },
      { nodeAttempts: { review: 0 } },
      { executionSeq: 1.5 },
      {
        routeActivations: {
          fix: {
            route_loop_node_id: 'router',
            outcome: 'retry',
            target_node_id: 'fix',
            attempt: 1,
            execution_seq: 4,
          },
        },
      },
    ];

    for (const metadata of malformedRuns) {
      const result = workflowRunSchema.safeParse({
        ...baseRun,
        metadata,
      });

      expect(result.success).toBe(false);
    }
  });

  test('increments loop counter when a negative transition is selected', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: { 'review-router': 2 },
        nodeAttempts: {},
        executionSeq: 0,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: false,
      routeLoop: reviewRouteLoop,
    });

    expect(transition.metadata.loopCounters['review-router']).toBe(3);
  });

  test('resets only the selected loop counter when a positive transition is selected', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: { 'review-router': 3, 'other-router': 2 },
        nodeAttempts: {},
        executionSeq: 0,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: true,
      routeLoop: reviewRouteLoop,
    });

    expect(transition.metadata.loopCounters).toEqual({
      'review-router': 0,
      'other-router': 2,
    });
  });

  test('increments route-loop attempt when any transition is selected', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: {},
        nodeAttempts: { 'review-router': 4 },
        executionSeq: 0,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: true,
      routeLoop: reviewRouteLoop,
    });

    expect(transition.metadata.nodeAttempts['review-router']).toBe(5);
  });

  test('increments execution sequence when any transition is selected', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: {},
        nodeAttempts: {},
        executionSeq: 7,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: false,
      routeLoop: reviewRouteLoop,
    });

    expect(transition.metadata.executionSeq).toBe(8);
  });

  test('computes negative transition metadata with counter, attempt, activation, and sequence increments', () => {
    const transition = applyRouteLoopTransition({
      metadata: {},
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: false,
      routeLoop: {
        condition: "$review.output.result == 'positive'",
        max_iterations: 10,
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalation',
        },
      },
    });

    expect(transition.metadata).toMatchObject({
      loopCounters: { 'review-router': 1 },
      nodeAttempts: { 'review-router': 1 },
      executionSeq: 1,
      routeActivations: {
        fix: {
          route_loop_node_id: 'review-router',
          outcome: 'negative',
          target_node_id: 'fix',
          attempt: 1,
          execution_seq: 1,
        },
      },
    });
    expect(transition.eventData).toEqual({
      sources: ['review'],
      outcome: 'negative',
      to: 'fix',
      condition: "$review.output.result == '<redacted>'",
      condition_result: false,
      negative_count: 1,
      max_iterations: 10,
      attempt: 1,
      execution_seq: 1,
    });
  });

  test('computes positive transition metadata by resetting only the selected loop counter', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: { 'review-router': 3, 'other-router': 2 },
        nodeAttempts: { 'review-router': 1 },
        executionSeq: 4,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: true,
      routeLoop: {
        condition: '$review.output.score >= 80',
        max_iterations: 10,
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalation',
        },
      },
    });

    expect(transition.metadata.loopCounters).toEqual({
      'review-router': 0,
      'other-router': 2,
    });
    expect(transition.metadata.nodeAttempts).toEqual({ 'review-router': 2 });
    expect(transition.metadata.executionSeq).toBe(5);
    expect(transition.eventData).toMatchObject({
      outcome: 'positive',
      to: 'done',
      condition: '$review.output.score >= <redacted>',
      condition_result: true,
      negative_count: 3,
      attempt: 2,
      execution_seq: 5,
    });
  });

  test('computes exhausted transition after the incremented negative counter exceeds the limit', () => {
    const transition = applyRouteLoopTransition({
      metadata: {
        loopCounters: { 'review-router': 1 },
        nodeAttempts: { 'review-router': 1 },
        executionSeq: 1,
        routeActivations: {},
      },
      routeLoopNodeId: 'review-router',
      sourceNodeIds: ['review'],
      conditionResult: false,
      routeLoop: {
        condition: "$review.output.result == 'positive'",
        max_iterations: 1,
        routes: {
          positive: 'done',
          negative: 'fix',
          exhausted: 'escalation',
        },
      },
    });

    expect(transition.metadata.loopCounters).toEqual({ 'review-router': 2 });
    expect(transition.metadata.routeActivations).toMatchObject({
      escalation: {
        route_loop_node_id: 'review-router',
        outcome: 'exhausted',
        target_node_id: 'escalation',
        attempt: 2,
        execution_seq: 2,
      },
    });
    expect(transition.eventData).toMatchObject({
      outcome: 'exhausted',
      to: 'escalation',
      condition_result: false,
      negative_count: 2,
      max_iterations: 1,
      attempt: 2,
      execution_seq: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema — per-node Pi extension posture (`pi:`, #2133)
// ---------------------------------------------------------------------------

describe('dagNodeSchema — per-node Pi posture (pi:)', () => {
  test('accepts and preserves a pi: block on a prompt node', () => {
    const result = dagNodeSchema.safeParse({
      id: 'plan',
      prompt: 'plan it',
      pi: { interactive: true, extensionFlags: { plan: true, 'plan-file': 'PLAN.md' } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as PromptNode).pi).toEqual({
        interactive: true,
        extensionFlags: { plan: true, 'plan-file': 'PLAN.md' },
      });
    }
  });

  test('preserves pi posture and exact raw effort on a loop node', () => {
    // Loops drop model/provider in the transform, but pi and raw effort MUST survive
    // because the loop itself owns the per-iteration sendQuery call.
    const result = dagNodeSchema.safeParse({
      id: 'implement',
      loop: { prompt: 'do work', until: 'DONE', max_iterations: 5 },
      pi: { interactive: false, extensionFlags: { plan: false } },
      effort: '  future-loop  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isLoopNode(result.data)).toBe(true);
      expect((result.data as DagNode & { pi?: unknown }).pi).toEqual({
        interactive: false,
        extensionFlags: { plan: false },
      });
      expect(result.data.effort).toBe('  future-loop  ');
    }
  });

  test('drops pi: from a bash node in the transform', () => {
    const result = dagNodeSchema.safeParse({
      id: 'sh',
      bash: 'echo hi',
      pi: { interactive: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('pi' in result.data).toBe(false);
    }
  });

  test('rejects a non-boolean/string extensionFlags value', () => {
    const result = dagNodeSchema.safeParse({
      id: 'plan',
      prompt: 'plan it',
      pi: { extensionFlags: { plan: 42 } },
    });
    expect(result.success).toBe(false);
  });

  test('pi is warned-ignored on non-AI + loop_group nodes but supported on loop', () => {
    // loop uses its per-iteration sendQuery, so pi must NOT be in its ignore list;
    // loop_group never sendQuerys (body nodes carry their own pi), so it warns.
    expect(LOOP_NODE_AI_FIELDS).not.toContain('pi');
    expect(LOOP_GROUP_NODE_AI_FIELDS).toContain('pi');
    expect(SCRIPT_NODE_AI_FIELDS).toContain('pi');
  });
});

// ---------------------------------------------------------------------------
// isScriptNode
// ---------------------------------------------------------------------------

describe('isScriptNode', () => {
  const scriptNode: ScriptNode = { id: 's1', script: 'console.log("hi")', runtime: 'bun' };
  const commandNode: CommandNode = { id: 'n1', command: 'build' };
  const promptNode: PromptNode = { id: 'n2', prompt: 'Do this inline.' };
  const bashNode: BashNode = { id: 'n3', bash: 'echo hello' };

  test('returns true for a ScriptNode', () => {
    expect(isScriptNode(scriptNode)).toBe(true);
  });

  test('returns true for a ScriptNode with deps', () => {
    const withDeps: ScriptNode = {
      id: 's',
      script: 'import zod from "zod"',
      runtime: 'bun',
      deps: ['zod'],
    };
    expect(isScriptNode(withDeps)).toBe(true);
  });

  test('returns false for a CommandNode', () => {
    expect(isScriptNode(commandNode)).toBe(false);
  });

  test('returns false for a PromptNode', () => {
    expect(isScriptNode(promptNode)).toBe(false);
  });

  test('returns false for a BashNode', () => {
    expect(isScriptNode(bashNode)).toBe(false);
  });

  test('returns false when script is not a string (malformed node)', () => {
    const malformed = { id: 'x', script: 42 } as unknown as DagNode;
    expect(isScriptNode(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dagNodeSchema — ScriptNode parsing and validation
// ---------------------------------------------------------------------------

describe('dagNodeSchema — ScriptNode', () => {
  test('parses a bun script node with inline script', () => {
    const result = dagNodeSchema.safeParse({
      id: 'fetch',
      script: 'console.log("hello")',
      runtime: 'bun',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isScriptNode(result.data)).toBe(true);
      const node = result.data as ScriptNode;
      expect(node.script).toBe('console.log("hello")');
      expect(node.runtime).toBe('bun');
    }
  });

  test('parses a uv script node with inline script', () => {
    const result = dagNodeSchema.safeParse({
      id: 'py',
      script: 'print("hello")',
      runtime: 'uv',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isScriptNode(result.data)).toBe(true);
      const node = result.data as ScriptNode;
      expect(node.runtime).toBe('uv');
    }
  });

  test('parses a script node with deps', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'import httpx',
      runtime: 'uv',
      deps: ['httpx', 'beautifulsoup4'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const node = result.data as ScriptNode;
      expect(node.deps).toEqual(['httpx', 'beautifulsoup4']);
    }
  });

  test('parses a script node with timeout', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      runtime: 'bun',
      timeout: 30000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const node = result.data as ScriptNode;
      expect(node.timeout).toBe(30000);
    }
  });

  test('parses a script node with depends_on', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      runtime: 'bun',
      depends_on: ['prev'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const node = result.data as ScriptNode;
      expect(node.depends_on).toEqual(['prev']);
    }
  });

  test('rejects script node without runtime', () => {
    const result = dagNodeSchema.safeParse({ id: 's', script: 'console.log("hi")' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('runtime');
    }
  });

  test('rejects invalid runtime value', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      runtime: 'node',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty script string', () => {
    const result = dagNodeSchema.safeParse({ id: 's', script: '', runtime: 'bun' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('script cannot be empty');
    }
  });

  test('rejects whitespace-only script', () => {
    const result = dagNodeSchema.safeParse({ id: 's', script: '   ', runtime: 'bun' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('script cannot be empty');
    }
  });

  test('rejects negative timeout on script node', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      runtime: 'bun',
      timeout: -1,
    });
    expect(result.success).toBe(false);
  });

  test('rejects script + bash (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      bash: 'echo hi',
      runtime: 'bun',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
    }
  });

  test('rejects script + prompt (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      prompt: 'Do something',
      runtime: 'bun',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
    }
  });

  test('rejects script + command (mutually exclusive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      command: 'some-command',
      runtime: 'bun',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
    }
  });

  test('strips AI-only fields from script nodes', () => {
    const result = dagNodeSchema.safeParse({
      id: 's',
      script: 'console.log("hi")',
      runtime: 'bun',
      effort: 'high',
      thinking: 'adaptive',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('effort' in result.data).toBe(false);
      expect('thinking' in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// SCRIPT_NODE_AI_FIELDS constant
// ---------------------------------------------------------------------------

describe('SCRIPT_NODE_AI_FIELDS', () => {
  test('contains provider and model fields', () => {
    expect(SCRIPT_NODE_AI_FIELDS).toContain('provider');
    expect(SCRIPT_NODE_AI_FIELDS).toContain('model');
  });

  test('contains all AI-specific fields', () => {
    const expectedFields = [
      'provider',
      'model',
      'context',
      'output_format',
      'allowed_tools',
      'denied_tools',
      'hooks',
      'mcp',
      'skills',
      'effort',
      'thinking',
      'maxBudgetUsd',
      'systemPrompt',
      'fallbackModel',
      'betas',
      'sandbox',
    ];
    for (const field of expectedFields) {
      expect(SCRIPT_NODE_AI_FIELDS).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// LOOP_NODE_AI_FIELDS constant
// ---------------------------------------------------------------------------

describe('LOOP_NODE_AI_FIELDS', () => {
  test('excludes model, provider, pi, and effort because loop nodes support them', () => {
    expect(LOOP_NODE_AI_FIELDS).not.toContain('model');
    expect(LOOP_NODE_AI_FIELDS).not.toContain('provider');
    expect(LOOP_NODE_AI_FIELDS).not.toContain('pi');
    expect(LOOP_NODE_AI_FIELDS).not.toContain('effort');
  });

  test('contains all other AI-specific fields from BASH_NODE_AI_FIELDS', () => {
    const expectedFields = [
      'context',
      'output_format',
      'allowed_tools',
      'denied_tools',
      'hooks',
      'mcp',
      'skills',
      'thinking',
      'maxBudgetUsd',
      'systemPrompt',
      'fallbackModel',
      'betas',
      'sandbox',
    ];
    for (const field of expectedFields) {
      expect(LOOP_NODE_AI_FIELDS).toContain(field);
    }
  });
});

describe('dagNodeSchema — loop_group', () => {
  test('parses a valid loop_group node with a recursive body', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      loop_group: {
        until: 'DONE',
        max_iterations: 5,
        fresh_context: false,
        nodes: [
          { id: 'a', prompt: 'do a', depends_on: [] },
          { id: 'b', bash: 'echo hi', depends_on: ['a'] },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isLoopGroupNode(result.data)).toBe(true);
      const grp = result.data as { loop_group?: { nodes: unknown[] } };
      expect(grp.loop_group?.nodes).toHaveLength(2);
    }
  });

  test('loop_group + prompt are mutually exclusive', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      prompt: 'inline',
      loop_group: { until: 'DONE', max_iterations: 3, nodes: [{ id: 'x', prompt: 'x' }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
      expect(result.error.issues[0].message).toContain('loop_group');
    }
  });

  test('loop_group + loop are mutually exclusive', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      loop: { prompt: 'p', until: 'DONE', max_iterations: 3 },
      loop_group: { until: 'DONE', max_iterations: 3, nodes: [{ id: 'x', prompt: 'x' }] },
    });
    expect(result.success).toBe(false);
  });

  test('loop_group rejects retry (loop manages its own iteration)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      retry: { max_attempts: 2, delay_ms: 1000 },
      loop_group: { until: 'DONE', max_iterations: 3, nodes: [{ id: 'x', prompt: 'x' }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const retryIssue = result.error.issues.find(i => i.message.includes('retry'));
      expect(retryIssue).toBeDefined();
      expect(retryIssue?.message).toContain('loop_group');
    }
  });

  test('loop_group requires at least one body node', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      loop_group: { until: 'DONE', max_iterations: 3, nodes: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('at least one node'))).toBe(true);
    }
  });

  test('loop_group requires until (completion signal)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'grp',
      loop_group: { max_iterations: 3, nodes: [{ id: 'x', prompt: 'x' }] },
    });
    expect(result.success).toBe(false);
  });

  test('nested loop_group body parses (loop_group inside loop_group)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'outer',
      loop_group: {
        until: 'OUTER_DONE',
        max_iterations: 3,
        nodes: [
          {
            id: 'inner',
            loop_group: {
              until: 'INNER_DONE',
              max_iterations: 2,
              nodes: [{ id: 'inner-work', prompt: 'work', depends_on: [] }],
            },
            depends_on: [],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const outer = result.data as {
        loop_group?: { nodes: Array<{ loop_group?: { nodes: unknown[] } }> };
      };
      const inner = outer.loop_group?.nodes[0];
      expect(isLoopGroupNode(inner as never)).toBe(true);
      expect(inner?.loop_group?.nodes).toHaveLength(1);
    }
  });
});

describe('LOOP_GROUP_NODE_AI_FIELDS', () => {
  test('excludes model/provider (forwarded to body AI nodes)', () => {
    expect(LOOP_GROUP_NODE_AI_FIELDS).not.toContain('model');
    expect(LOOP_GROUP_NODE_AI_FIELDS).not.toContain('provider');
  });

  test('differs from LOOP_NODE_AI_FIELDS on per-sendQuery pi and effort fields', () => {
    // A plain loop calls sendQuery itself, so pi and effort are honored there.
    // A loop_group never calls sendQuery — body nodes carry their own values — so
    // both fields remain warned-ignored on the group.
    expect(LOOP_NODE_AI_FIELDS).not.toContain('pi');
    expect(LOOP_NODE_AI_FIELDS).not.toContain('effort');
    expect(LOOP_GROUP_NODE_AI_FIELDS).toContain('pi');
    expect(LOOP_GROUP_NODE_AI_FIELDS).toContain('effort');
    expect(LOOP_GROUP_NODE_AI_FIELDS.filter(f => f !== 'pi' && f !== 'effort')).toEqual([
      ...LOOP_NODE_AI_FIELDS,
    ]);
  });
});

describe('dagNodeSchema — include', () => {
  test('parses a valid include node (only structural fields survive)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'review',
      include: 'archon-review-block',
      depends_on: ['finalize-pr'],
      when: 'always',
      trigger_rule: 'all_success',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isIncludeNode(result.data)).toBe(true);
      const node = result.data as IncludeNode;
      expect(node.include).toBe('archon-review-block');
      expect(node.depends_on).toEqual(['finalize-pr']);
      expect(node.when).toBe('always');
      expect(node.trigger_rule).toBe('all_success');
    }
  });

  test('trims surrounding whitespace on the target name', () => {
    const result = dagNodeSchema.safeParse({ id: 'r', include: '  archon-review-block  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as IncludeNode).include).toBe('archon-review-block');
    }
  });

  test('include + command are mutually exclusive', () => {
    const result = dagNodeSchema.safeParse({
      id: 'r',
      command: 'build',
      include: 'archon-review-block',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('mutually exclusive');
      expect(result.error.issues[0].message).toContain('include');
    }
  });

  test('empty include is rejected', () => {
    const result = dagNodeSchema.safeParse({ id: 'r', include: '' });
    expect(result.success).toBe(false);
  });

  test("include with 'with:' is rejected (not yet supported)", () => {
    const result = dagNodeSchema.safeParse({
      id: 'r',
      include: 'archon-review-block',
      with: { pr: '$create.output' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const withIssue = result.error.issues.find(i => i.message.includes('with:'));
      expect(withIssue).toBeDefined();
      expect(withIssue?.message).toContain('not yet supported');
      expect(withIssue?.path).toEqual(['with']);
    }
  });

  test('include node drops AI/exec fields (they are ignored)', () => {
    const result = dagNodeSchema.safeParse({
      id: 'r',
      include: 'archon-review-block',
      model: 'opus',
      always_run: true,
      output_type: 'code',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const node = result.data as Record<string, unknown>;
      expect(node.model).toBeUndefined();
      expect(node.always_run).toBeUndefined();
      expect(node.output_type).toBeUndefined();
    }
  });
});

describe('INCLUDE_NODE_IGNORED_FIELDS', () => {
  test('is a superset of BASH_NODE_AI_FIELDS plus exec-only fields', () => {
    for (const f of BASH_NODE_AI_FIELDS) {
      expect(INCLUDE_NODE_IGNORED_FIELDS).toContain(f);
    }
    for (const f of ['retry', 'output_type', 'always_run', 'idle_timeout', 'timeout']) {
      expect(INCLUDE_NODE_IGNORED_FIELDS).toContain(f);
    }
    // Structural fields the include node legitimately carries are NOT ignored.
    for (const f of ['id', 'depends_on', 'when', 'trigger_rule', 'include', 'description']) {
      expect(INCLUDE_NODE_IGNORED_FIELDS).not.toContain(f);
    }
  });
});
