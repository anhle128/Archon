import { z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    value => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'),
    'Expected a path within the checkout'
  );
export const featureSchema = z
  .object({
    version: z.literal(1),
    id: idSchema,
    description: z.string().min(1),
    impact_paths: z.array(relativePathSchema).min(1),
    behaviors: z
      .array(
        z
          .object({
            id: idSchema,
            description: z.string().min(1),
            priority: z.enum(['P0', 'P1', 'P2']),
            impact_paths: z.array(relativePathSchema).optional(),
            scenarios: z.array(idSchema).min(1),
          })
          .strict()
      )
      .min(1),
    scenarios: z.array(
      z
        .object({
          id: idSchema,
          runner: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('playwright'), file: relativePathSchema }).strict(),
            z.object({ kind: z.enum(['cli', 'api']), recipe: idSchema }).strict(),
          ]),
          proof_obligations: z
            .array(
              z.enum([
                'browser-action',
                'cli-action',
                'first-party-write',
                'persistence-read-back',
                'transition',
                'final-ui',
                'screenshot',
                'api-response',
              ])
            )
            .min(1),
        })
        .strict()
    ),
  })
  .strict();
export type Feature = z.infer<typeof featureSchema>;
export type Scenario = Feature['scenarios'][number];

export const proposalSchema = z
  .object({
    version: z.literal(1),
    base_sha: shaSchema,
    head_sha: shaSchema,
    changed_paths: z.array(relativePathSchema),
    affected_behaviors: z
      .array(
        z
          .object({
            id: idSchema,
            confidence: z.enum(['high', 'medium', 'low']),
            rationale: z.string().trim().min(1),
          })
          .strict()
      )
      .min(1),
    coverage_gaps: z.array(z.string().min(1)),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export const snapshotSchema = z
  .object({
    base_sha: shaSchema,
    head_sha: shaSchema,
    changed_paths: z.array(relativePathSchema),
    dirty: z.boolean(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const selectionSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['change', 'historical']),
    proposal: proposalSchema,
    catalog_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    behavior_ids: z.array(idSchema).min(1),
    scenario_ids: z.array(idSchema).min(1),
    broadened_features: z.array(idSchema),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;

export interface Catalog {
  features: Feature[];
  sha256: string;
  behaviors: Map<string, { feature: Feature; behavior: Feature['behaviors'][number] }>;
  scenarios: Map<string, Scenario>;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildCatalog(input: unknown[]): Catalog {
  const features = input
    .map(value => featureSchema.parse(value))
    .sort((a, b) => a.id.localeCompare(b.id));
  const behaviors: Catalog['behaviors'] = new Map();
  const scenarios: Catalog['scenarios'] = new Map();
  const featureIds = new Set<string>();
  for (const feature of features) {
    if (featureIds.has(feature.id)) throw new Error(`Duplicate feature: ${feature.id}`);
    featureIds.add(feature.id);
    for (const scenario of feature.scenarios) {
      if (scenarios.has(scenario.id)) throw new Error(`Duplicate scenario: ${scenario.id}`);
      scenarios.set(scenario.id, scenario);
    }
    for (const behavior of feature.behaviors) {
      if (behaviors.has(behavior.id)) throw new Error(`Duplicate behavior: ${behavior.id}`);
      behaviors.set(behavior.id, { feature, behavior });
    }
  }
  for (const { behavior } of behaviors.values()) {
    for (const id of behavior.scenarios) {
      if (!scenarios.has(id))
        throw new Error(`Behavior ${behavior.id} requires missing scenario ${id}`);
    }
  }
  for (const id of scenarios.keys()) {
    if (![...behaviors.values()].some(({ behavior }) => behavior.scenarios.includes(id))) {
      throw new Error(`Scenario ${id} has no behavior`);
    }
  }
  return { features, sha256: digest(features), behaviors, scenarios };
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function normalizeProposal(
  catalog: Catalog,
  input: unknown,
  snapshot: Snapshot,
  mode: Selection['mode'] = 'change'
): Selection {
  const proposal = proposalSchema.parse(input);
  if (snapshot.dirty)
    throw new Error(
      'Product checkout is dirty; commit the intended changes or select a clean worktree.'
    );
  if (proposal.base_sha !== snapshot.base_sha || proposal.head_sha !== snapshot.head_sha) {
    throw new Error('Selection SHA is stale; read the current diff and select again.');
  }
  if (
    JSON.stringify(sorted(proposal.changed_paths)) !==
    JSON.stringify(sorted(snapshot.changed_paths))
  ) {
    throw new Error('Proposed changed paths do not match the complete git diff.');
  }
  if (mode === 'change' && snapshot.changed_paths.length === 0)
    throw new Error(
      'Change selection has an empty diff; use explicit historical mode for a named regression.'
    );
  if (proposal.coverage_gaps.length)
    throw new Error(`Unresolved coverage gaps: ${proposal.coverage_gaps.join('; ')}`);
  const behaviorIds = new Set<string>();
  const proposedFeatures = new Set<string>();
  const broadened = new Set<string>();
  const broaden = (feature: Feature): void => {
    broadened.add(feature.id);
    for (const behavior of feature.behaviors) behaviorIds.add(behavior.id);
  };
  for (const item of proposal.affected_behaviors) {
    const entry = catalog.behaviors.get(item.id);
    if (!entry) throw new Error(`Unknown behavior: ${item.id}`);
    behaviorIds.add(item.id);
    proposedFeatures.add(entry.feature.id);
    if (item.confidence !== 'high') broaden(entry.feature);
  }
  // Path matches are a conservative expansion, never a replacement for interpretation.
  for (const path of snapshot.changed_paths) {
    const impacted = catalog.features.filter(feature =>
      feature.impact_paths.some(pattern => new Bun.Glob(pattern).match(path))
    );
    if (!impacted.length)
      throw new Error(
        `Unmapped changed path: ${path}. Add its behavior/scenario coverage before proving this change.`
      );
    for (const feature of impacted) {
      if (!proposedFeatures.has(feature.id)) broaden(feature);
      for (const behavior of feature.behaviors) {
        if (behavior.impact_paths?.some(pattern => new Bun.Glob(pattern).match(path))) {
          behaviorIds.add(behavior.id);
        }
      }
    }
  }
  const scenarioIds = [...behaviorIds].flatMap(
    id => catalog.behaviors.get(id)?.behavior.scenarios ?? []
  );
  return {
    version: 1,
    mode,
    proposal,
    catalog_sha256: catalog.sha256,
    behavior_ids: sorted(behaviorIds),
    scenario_ids: sorted(scenarioIds),
    broadened_features: sorted(broadened),
  };
}

export interface ScenarioResult {
  id: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped' | 'missing' | 'unsupported';
  errors: string[];
  attachments: { name: string; path: string }[];
}

const errorSchema = z
  .object({ message: z.string().optional(), value: z.string().optional() })
  .passthrough();
const playwrightTestSchema = z
  .object({
    status: z.string().optional(),
    expectedStatus: z.string().optional(),
    annotations: z
      .array(z.object({ type: z.string(), description: z.string().optional() }).passthrough())
      .default([]),
    results: z
      .array(
        z
          .object({
            status: z.string(),
            errors: z.array(errorSchema).optional(),
            attachments: z
              .array(z.object({ name: z.string(), path: z.string().optional() }).passthrough())
              .optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();
const suiteSchema = z
  .object({
    suites: z.array(z.unknown()).default([]),
    specs: z
      .array(
        z
          .object({
            title: z.string(),
            tests: z.array(playwrightTestSchema),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();
export const playwrightReportSchema = z
  .object({
    suites: z.array(z.unknown()),
    errors: z.array(errorSchema).default([]),
  })
  .passthrough();

export function collectPlaywright(
  report: unknown
): Map<string, z.infer<typeof playwrightTestSchema>[]> {
  const parsed = playwrightReportSchema.parse(report);
  const queue = [...parsed.suites];
  const byId = new Map<string, z.infer<typeof playwrightTestSchema>[]>();
  for (const queuedSuite of queue) {
    const suite = suiteSchema.parse(queuedSuite);
    queue.push(...suite.suites);
    for (const spec of suite.specs) {
      for (const match of spec.title.matchAll(/\[V:([a-z0-9][a-z0-9.-]*)\]/g)) {
        const id = match[1];
        if (id) byId.set(id, [...(byId.get(id) ?? []), ...spec.tests]);
      }
    }
  }
  return byId;
}

export function evaluatePlaywright(report: unknown, required: string[]): ScenarioResult[] {
  const byId = collectPlaywright(report);
  return required.map((id): ScenarioResult => {
    const tests = byId.get(id) ?? [];
    if (tests.length === 0)
      return { id, status: 'missing', errors: ['Required scenario did not run'], attachments: [] };
    if (tests.length !== 1)
      return { id, status: 'failed', errors: ['Scenario identity is duplicated'], attachments: [] };
    const test = tests[0];
    if (!test) throw new Error('Required test disappeared');
    const attempts = test.results;
    const errors = attempts.flatMap(attempt =>
      (attempt.errors ?? []).map(error => error.message ?? error.value ?? 'Unknown test error')
    );
    const attachments = attempts.flatMap(attempt =>
      (attempt.attachments ?? []).flatMap(item =>
        item.path ? [{ name: item.name, path: item.path }] : []
      )
    );
    let status: ScenarioResult['status'] = 'failed';
    if (
      test.annotations.some(
        item => item.type === 'verification-setup' && item.description === 'unsupported'
      )
    )
      status = 'unsupported';
    else if (test.status === 'skipped' || attempts.some(attempt => attempt.status === 'skipped'))
      status = 'skipped';
    else if (
      test.status === 'flaky' ||
      (attempts.length > 1 && attempts.some(attempt => attempt.status === 'passed'))
    )
      status = 'flaky';
    else if (
      test.status === 'expected' &&
      test.expectedStatus === 'passed' &&
      attempts.length === 1 &&
      attempts[0]?.status === 'passed'
    )
      status = 'passed';
    if (status !== 'passed' && errors.length === 0)
      errors.push(
        `Required scenario is ${status} (expected status: ${test.expectedStatus ?? 'missing'})`
      );
    return { id, status, errors, attachments };
  });
}
