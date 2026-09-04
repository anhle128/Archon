/**
 * Usage-ledger write helpers.
 *
 * Ledger rows are children of `node_usage_recorded` workflow events. Callers
 * insert them inside the same transaction as the owning event (see
 * workflows/usage-recorder.ts). Identity/timestamp columns live on the event
 * and run — never duplicated here.
 */
import type { QueryResult } from './adapters/types';
import type { UsageLedgerRow } from '../schemas/usage-ledger';
import { usageLedgerRowSchema } from '../schemas/usage-ledger';

/**
 * A query function scoped to a specific connection — pool or transaction.
 * Row type fixed to `unknown` so generic tx query is assignable.
 */
type LedgerInsertQuery = (sql: string, params?: unknown[]) => Promise<QueryResult<unknown>>;

const INSERT_SQL = `INSERT INTO remote_agent_usage_ledger (
  id, workflow_event_id, entry_index, agent_provider, provider, model, model_source, kind,
  tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
  requests, cost_usd, cost_estimated_usd, pricing_source
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13,
  $14, $15, $16, $17
)`;

/**
 * Insert one validated ledger row via `query`. Throws on failure so the
 * enclosing transaction can roll back both sinks.
 */
export async function insertUsageLedgerRow(
  query: LedgerInsertQuery,
  row: UsageLedgerRow
): Promise<void> {
  const validated = usageLedgerRowSchema.parse(row);
  await query(INSERT_SQL, [
    validated.id,
    validated.workflow_event_id,
    validated.entry_index,
    validated.agent_provider,
    validated.provider,
    validated.model,
    validated.model_source,
    validated.kind,
    validated.tokens_input,
    validated.tokens_output,
    validated.tokens_reasoning,
    validated.tokens_cache_read,
    validated.tokens_cache_write,
    validated.requests,
    validated.cost_usd,
    validated.cost_estimated_usd,
    validated.pricing_source,
  ]);
}

/**
 * Insert every ledger row for one usage event, preserving entry_index order.
 * Throws on the first failure so the transaction rolls back.
 */
export async function insertUsageLedgerRows(
  query: LedgerInsertQuery,
  rows: readonly UsageLedgerRow[]
): Promise<void> {
  for (const row of rows) {
    await insertUsageLedgerRow(query, row);
  }
}
