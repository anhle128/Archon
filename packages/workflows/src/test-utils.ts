/**
 * Test factories for workflow types.
 * Use these instead of inline fixture objects so schema changes update one file.
 */
import { workflowDefinitionSchema } from './schemas/workflow';
import type {
  DeclaredWorkflowConfig,
  WorkflowDefinition,
  WorkflowWithSource,
  WorkflowSource,
} from './schemas/workflow';
import { expandWorkflowIncludes } from './include-expander';

const DEFAULT_NODE = { id: 'default', command: 'test-command' };
const DEFAULT_ROUTE_LOOP_IDS: RouteLoopFixtureIds = {
  fix: 'fix',
  review: 'review',
  router: 'review-router',
  done: 'done',
  escalation: 'escalation',
};

type TestWorkflowOverrides = {
  name: string;
  nodes?: unknown[];
} & Partial<Omit<WorkflowDefinition, 'name' | 'nodes'>>;

export type RouteLoopFixtureNodeName = 'fix' | 'review' | 'router' | 'done' | 'escalation';

export type RouteLoopFixtureIds = Record<RouteLoopFixtureNodeName, string>;

export interface RouteLoopFixtureRoutes {
  positive: string;
  negative: string;
  exhausted: string;
}

export interface RouteLoopFixtureConfig {
  condition: string;
  routes: RouteLoopFixtureRoutes;
  max_iterations?: number;
}

export interface RouteLoopPromptFixtureNode {
  id: string;
  prompt: string;
  depends_on?: string[];
  output_format?: Record<string, unknown>;
  output_type?: string;
}

export interface RouteLoopControllerFixtureNode {
  id: string;
  depends_on: string[];
  route_loop: RouteLoopFixtureConfig;
}

export type RouteLoopWorkflowFixtureNode =
  | RouteLoopPromptFixtureNode
  | RouteLoopControllerFixtureNode;

export type RouteLoopWorkflowOverrides = {
  name?: string;
  description?: string;
  ids?: Partial<RouteLoopFixtureIds>;
  condition?: string;
  routes?: Partial<RouteLoopFixtureRoutes>;
  max_iterations?: number;
  nodes?: unknown[];
} & Partial<Omit<WorkflowDefinition, 'name' | 'description' | 'nodes'>>;

export type RouteLoopWorkflowFixture = Omit<WorkflowDefinition, 'nodes'> & { nodes: unknown[] };

export function makeTestWorkflow(overrides: TestWorkflowOverrides): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    description: `${overrides.name} test workflow`,
    nodes: [DEFAULT_NODE],
    ...overrides,
  });
}

export function makeTestWorkflowList(names: string[]): WorkflowDefinition[] {
  return names.map(name => makeTestWorkflow({ name }));
}

export function makeRouteLoopWorkflowNodes(
  overrides: RouteLoopWorkflowOverrides = {}
): RouteLoopWorkflowFixtureNode[] {
  const ids: RouteLoopFixtureIds = { ...DEFAULT_ROUTE_LOOP_IDS, ...overrides.ids };
  const routes: RouteLoopFixtureRoutes = {
    positive: ids.done,
    negative: ids.fix,
    exhausted: ids.escalation,
    ...overrides.routes,
  };
  const routeLoop: RouteLoopFixtureConfig = {
    condition: overrides.condition ?? `$${ids.review}.output.approved == true`,
    routes,
    ...(overrides.max_iterations !== undefined ? { max_iterations: overrides.max_iterations } : {}),
  };

  return [
    {
      id: ids.fix,
      prompt: 'Apply the requested fix and summarize the changes.',
      output_type: 'code',
    },
    {
      id: ids.review,
      depends_on: [ids.fix],
      prompt: 'Review the fix and emit JSON with an approved boolean.',
      output_format: {
        type: 'object',
        properties: {
          approved: { type: 'boolean' },
        },
        required: ['approved'],
      },
      output_type: 'review',
    },
    {
      id: ids.router,
      depends_on: [ids.review],
      route_loop: routeLoop,
    },
    {
      id: ids.done,
      depends_on: [ids.router],
      prompt: 'Summarize the accepted fix.',
      output_type: 'summary',
    },
    {
      id: ids.escalation,
      depends_on: [ids.router],
      prompt: 'Escalate because the review loop was exhausted.',
      output_type: 'escalation',
    },
  ];
}

export function makeRouteLoopWorkflow(
  overrides: RouteLoopWorkflowOverrides = {}
): RouteLoopWorkflowFixture {
  const {
    nodes,
    ids,
    condition,
    routes,
    max_iterations: maxIterations,
    ...workflowOverrides
  } = overrides;
  void ids;
  void condition;
  void routes;
  void maxIterations;

  return {
    name: 'route-loop-fixture',
    description: 'Fix, review, and route until accepted or exhausted.',
    nodes: nodes ?? makeRouteLoopWorkflowNodes(overrides),
    ...workflowOverrides,
  };
}

/**
 * Wrap a WorkflowDefinition as a WorkflowWithSource entry for test mocks.
 *
 * Runs the real expander, so the entry has the shape discovery actually produces: the
 * workflow's node-affecting config collapsed onto its nodes and removed from the
 * definition, with what the author declared carried alongside in `declared` (#1764). A
 * factory that skipped this would hand every consumer a `workflow.provider` that no real
 * discovery result has, and hide exactly the display bug the collapse introduces.
 */
export function makeTestWorkflowWithSource(
  overrides: TestWorkflowOverrides,
  source: WorkflowSource = 'bundled',
  parseWarnings?: readonly string[]
): WorkflowWithSource {
  const raw = makeTestWorkflow(overrides);
  const { workflows } = expandWorkflowIncludes(new Map([[raw.name, raw]]));
  const declared: DeclaredWorkflowConfig = {
    ...(raw.provider !== undefined ? { provider: raw.provider } : {}),
    ...(raw.model !== undefined ? { model: raw.model } : {}),
    ...(raw.effort !== undefined ? { effort: raw.effort } : {}),
  };
  return {
    workflow: workflows.get(raw.name) ?? raw,
    source,
    ...(parseWarnings ? { parseWarnings } : {}),
    ...(Object.keys(declared).length > 0 ? { declared } : {}),
  };
}

export function makeRouteLoopWorkflowWithSource(
  overrides: RouteLoopWorkflowOverrides = {},
  source: WorkflowSource = 'bundled'
): { workflow: RouteLoopWorkflowFixture; source: WorkflowSource } {
  return { workflow: makeRouteLoopWorkflow(overrides), source };
}

/**
 * Expand a set of in-memory workflows exactly as discovery does, and return one by name.
 *
 * For tests OUTSIDE this package that need a genuinely composed workflow — the expander
 * itself is not a public export, and composition is where several cross-package contracts
 * are decided (unioned `requires:`, collapsed node config, the composed-node stamp).
 * Throws on an expansion error so a broken fixture fails loudly at its own line.
 */
export function makeTestComposedWorkflow(
  defs: readonly WorkflowDefinition[],
  name: string
): WorkflowDefinition {
  const { workflows, errors } = expandWorkflowIncludes(new Map(defs.map(d => [d.name, d])));
  if (errors.length > 0) {
    throw new Error(`makeTestComposedWorkflow: expansion failed: ${JSON.stringify(errors)}`);
  }
  const expanded = workflows.get(name);
  if (!expanded) throw new Error(`makeTestComposedWorkflow: no workflow named '${name}'`);
  return expanded;
}
