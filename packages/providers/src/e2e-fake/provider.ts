import { z } from 'zod';

import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ModelUsageEntry,
  ProviderCapabilities,
  SendQueryOptions,
  UsageBreakdown,
} from '../types';

import { E2E_FAKE_CAPABILITIES } from './capabilities';

const log = createLogger('provider.e2e-fake');

const DIRECTIVE_OPEN = '<<E2E_USAGE>>';
const DIRECTIVE_CLOSE = '<</E2E_USAGE>>';

// ---------------------------------------------------------------------------
// Usage directive schema
//
// Faithful mirror of `modelUsageEntrySchema`
// (packages/workflows/src/schemas/usage-breakdown.ts). @archon/providers is
// UPSTREAM of @archon/workflows, so the canonical schema cannot be imported
// here. Two guards keep this honest:
//   1. The `ExactMatch` type assertion below fails the build if the entry's
//      inferred TYPE drifts from the provider contract (`ModelUsageEntry`).
//   2. The refinements are replicated so a directive that this fake accepts is
//      one the downstream recorder also accepts — a directive typo THROWS here
//      instead of silently producing zero ledger rows (which would be
//      indistinguishable from the intentional "no usage" scenario, where the
//      directive block is simply absent).
// ---------------------------------------------------------------------------

const nonNegativeSafeIntegerSchema = z
  .number()
  .refine(n => Number.isSafeInteger(n) && n >= 0, 'must be a non-negative safe integer');

const positiveSafeIntegerSchema = z
  .number()
  .refine(n => Number.isSafeInteger(n) && n > 0, 'must be a positive safe integer');

const finiteNonNegativeSchema = z
  .number()
  .refine(n => Number.isFinite(n) && n >= 0, 'must be a finite non-negative number');

const usageEntrySchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().nullable(),
    modelSource: z.enum(['reported', 'requested', 'unknown']),
    inputTokens: nonNegativeSafeIntegerSchema.optional(),
    outputTokens: nonNegativeSafeIntegerSchema.optional(),
    reasoningTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheReadTokens: nonNegativeSafeIntegerSchema.optional(),
    cacheWriteTokens: nonNegativeSafeIntegerSchema.optional(),
    requests: positiveSafeIntegerSchema.optional(),
    costUsd: finiteNonNegativeSchema.optional(),
    kind: z.enum(['advisor', 'subagent']).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.modelSource === 'unknown') {
      if (entry.model !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['model'],
          message: 'model_source_unknown_requires_null_model',
        });
      }
    } else if (typeof entry.model !== 'string' || entry.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'model_required_for_known_source',
      });
    } else if (entry.model !== entry.model.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'model_untrimmed' });
    }

    if (entry.provider !== entry.provider.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'provider_untrimmed',
      });
    }

    if (
      entry.reasoningTokens !== undefined &&
      entry.outputTokens !== undefined &&
      entry.reasoningTokens > entry.outputTokens
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasoningTokens'],
        message: 'reasoning_exceeds_output',
      });
    }

    const hasMeasure =
      entry.inputTokens !== undefined ||
      entry.outputTokens !== undefined ||
      entry.reasoningTokens !== undefined ||
      entry.cacheReadTokens !== undefined ||
      entry.cacheWriteTokens !== undefined ||
      entry.requests !== undefined ||
      entry.costUsd !== undefined;

    if (!hasMeasure) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'missing_numeric_measure' });
    }
  });

const usageBreakdownSchema = z.array(usageEntrySchema).min(1);

// Drift guard: the fake's entry output type must match the provider contract
// both ways. `ExactMatch` returns `false` (not `never`) on mismatch — a
// never-based assert would silently accept drift. `AssertTrue<false>` violates
// its `extends true` bound, so a divergence is a compile error.
type ExactMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
type EntryTypeMatchesContract = AssertTrue<
  ExactMatch<z.infer<typeof usageEntrySchema>, ModelUsageEntry>
>;
// Exported so `noUnusedLocals` cannot drop the assertion silently.
export type E2eFakeContractChecks = [EntryTypeMatchesContract];

/**
 * Extract the usage directive JSON from a node prompt.
 * Returns `undefined` when no `<<E2E_USAGE>>...<</E2E_USAGE>>` block is present
 * — the caller reads that as the intentional "emit no usage" scenario.
 */
function extractUsageDirective(prompt: string): string | undefined {
  const start = prompt.indexOf(DIRECTIVE_OPEN);
  if (start === -1) return undefined;
  const from = start + DIRECTIVE_OPEN.length;
  const end = prompt.indexOf(DIRECTIVE_CLOSE, from);
  if (end === -1) {
    throw new Error(
      `e2e-fake: found ${DIRECTIVE_OPEN} without a closing ${DIRECTIVE_CLOSE} in the prompt`
    );
  }
  return prompt.slice(from, end).trim();
}

/**
 * Parse + validate a usage directive, throwing loudly on any malformed input.
 * A throw here is the whole point: it prevents a directive typo from silently
 * degrading into zero recorded rows.
 */
function parseUsageDirective(directive: string): UsageBreakdown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(directive);
  } catch (err) {
    throw new Error(
      `e2e-fake: usage directive is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const result = usageBreakdownSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`e2e-fake: usage directive failed validation: ${result.error.message}`);
  }
  return result.data;
}

/**
 * A net-new, env-gated fake agent provider used only by end-to-end tests that
 * must exercise the real workflow usage-record path (executor -> usage recorder
 * -> usage_ledger) without a paid AI call. It emits exactly the usage the test
 * asks for through a prompt directive, and nothing else.
 *
 * Registered ONLY when `ARCHON_E2E_FAKE_PROVIDER` is set (see registration.ts),
 * so production never sees it.
 */
export class E2eFakeProvider implements IAgentProvider {
  getType(): string {
    return 'e2e-fake';
  }

  getCapabilities(): ProviderCapabilities {
    return E2E_FAKE_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    _cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const directive = extractUsageDirective(prompt);
    const sessionId = resumeSessionId ?? `e2e-fake-${Date.now().toString(36)}`;

    yield { type: 'assistant', content: '[e2e-fake] deterministic response' };

    if (directive === undefined) {
      // No directive block -> intentional "no usage" scenario: emit a terminal
      // result with no usageBreakdown so the recorder writes zero rows.
      log.info({ sessionId }, 'e2e-fake.query_completed_no_usage');
      yield {
        type: 'result',
        sessionId,
        resumed: resumeSessionId !== undefined ? true : undefined,
      };
      return;
    }

    const usageBreakdown = parseUsageDirective(directive);
    log.info({ sessionId, entries: usageBreakdown.length }, 'e2e-fake.query_completed');
    yield {
      type: 'result',
      sessionId,
      usageBreakdown,
      resumed: resumeSessionId !== undefined ? true : undefined,
    };
  }
}
