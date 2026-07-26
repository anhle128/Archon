import { createLogger } from '@archon/paths';
import {
  claimDueOutboxEvents,
  completeAttempt,
  insertPendingAttempt,
  updateOutboxAfterAttempt,
} from '@archon/core/db/workflow-event-outbox';
import { getBindingByIdWithSecret } from '@archon/core/db/provider-bindings';
import { createWorkflowStore } from '@archon/core/workflows';
import type { WorkflowEventOutboxRow, WorkflowEventOutboxStatus } from '@archon/core/schemas';
import { signHermesV2 } from './hermes-signer';

const log = createLogger('workflow-events.dispatcher');

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 32, 60] as const;

export interface WorkflowEventDispatcherOptions {
  intervalMs?: number;
  batchSize?: number;
  requestTimeoutMs?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  enqueueDeliveryFailed?: (data: {
    workflow_run_id: string;
    event_type: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

type EnqueueDeliveryFailed = NonNullable<WorkflowEventDispatcherOptions['enqueueDeliveryFailed']>;

interface AttemptResult {
  outcome: 'succeeded' | 'failed';
  responseStatus?: number | null;
  responseHeaders?: Record<string, string> | null;
  responseBody?: string | null;
  transportError?: string | null;
}

export class WorkflowEventDispatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private redrainRequested = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly enqueueDeliveryFailed: EnqueueDeliveryFailed;

  constructor(options: WorkflowEventDispatcherOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.now = options.now ?? ((): Date => new Date());
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (options.enqueueDeliveryFailed) {
      this.enqueueDeliveryFailed = options.enqueueDeliveryFailed;
    } else {
      const workflowStore = createWorkflowStore();
      this.enqueueDeliveryFailed = (data: Parameters<EnqueueDeliveryFailed>[0]): Promise<void> =>
        workflowStore.enqueueExternalWorkflowEvent(data);
    }
  }

  start(): void {
    if (this.intervalId) return;
    void this.drain();
    this.intervalId = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
    const timer = this.intervalId as unknown as { unref?: () => void };
    if (typeof timer.unref === 'function') timer.unref();
    log.info({ intervalMs: this.intervalMs, batchSize: this.batchSize }, 'workflow_events.started');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  drainNow(): Promise<void> {
    return this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      this.redrainRequested = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.redrainRequested = false;
        await this.drainOnce();
      } while (this.redrainRequested);
    } catch (err) {
      log.warn({ err }, 'workflow_events.drain_failed');
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    const rows = await claimDueOutboxEvents(this.batchSize, this.now());
    for (const row of rows) {
      await this.deliver(row);
    }
  }

  private async deliver(row: WorkflowEventOutboxRow): Promise<void> {
    if (!row.event_route || !row.binding_id) {
      await updateOutboxAfterAttempt(row.id, {
        status: 'terminal-failure',
        attempt_count: row.attempt_count,
        last_attempt_at: this.now(),
        next_attempt_at: null,
        last_error: 'missing-route',
      });
      return;
    }

    const binding = await getBindingByIdWithSecret(row.binding_id);
    const secret = binding?.signing_secret?.trim();
    if (!secret) {
      await updateOutboxAfterAttempt(row.id, {
        status: 'terminal-failure',
        attempt_count: row.attempt_count,
        last_attempt_at: this.now(),
        next_attempt_at: null,
        last_error: 'missing-secret',
      });
      return;
    }

    const startedAt = this.now();
    const attemptNumber = row.attempt_count + 1;
    const { timestamp, signature } = signHermesV2(
      secret,
      Math.floor(startedAt.getTime() / 1000),
      row.event_body
    );
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature-V2': signature,
      'X-Webhook-Timestamp': timestamp,
      'X-Request-ID': row.idempotency_key,
    };

    let attemptId: string;
    try {
      const attempt = await insertPendingAttempt(row.id, attemptNumber, {
        url: row.event_route,
        method: 'POST',
        headers,
        body: row.event_body,
        startedAt,
      });
      attemptId = attempt.id;
    } catch (err) {
      log.warn({ err, outboxEventId: row.id }, 'workflow_events.attempt_insert_failed');
      return;
    }

    const result = await this.post(row.event_route, headers, row.event_body);
    const completedAt = this.now();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    const attempt = await completeAttempt({
      attemptId,
      outcome: result.outcome,
      completedAt,
      durationMs,
      responseStatus: result.responseStatus ?? null,
      responseHeaders: result.responseHeaders ?? null,
      responseBody: result.responseBody ?? null,
      transportError: result.transportError ?? null,
    });

    const nextState = this.nextState(attemptNumber, completedAt, result);
    await updateOutboxAfterAttempt(row.id, nextState);

    if (result.outcome === 'failed' && row.event_type !== 'workflow.delivery.failed') {
      await this.enqueueDeliveryFailed({
        workflow_run_id: row.workflow_run_id,
        event_type: 'workflow.delivery.failed',
        occurred_at: completedAt.toISOString(),
        payload: {
          deliveryOnly: true,
          mutationIntent: 'none',
          deliveryStatus: nextState.status,
          failedDeliveryId: attempt.id,
          nextStatus: nextState.status,
          diagnosticRef: `workflow-event-outbox:${row.id}`,
        },
      });
    }
  }

  private async post(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);
    const timer = timeout as unknown as { unref?: () => void };
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      return {
        outcome: response.ok ? 'succeeded' : 'failed',
        responseStatus: response.status,
        responseHeaders: headersToRecord(response.headers),
        responseBody,
      };
    } catch (err) {
      return {
        outcome: 'failed',
        transportError: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private nextState(
    attemptNumber: number,
    completedAt: Date,
    result: AttemptResult
  ): {
    status: WorkflowEventOutboxStatus;
    attempt_count: number;
    last_attempt_at: Date;
    next_attempt_at: Date | null;
    last_error: string | null;
  } {
    if (result.outcome === 'succeeded') {
      return {
        status: 'delivered',
        attempt_count: attemptNumber,
        last_attempt_at: completedAt,
        next_attempt_at: null,
        last_error: null,
      };
    }

    if (attemptNumber >= 8) {
      return {
        status: 'terminal-failure',
        attempt_count: attemptNumber,
        last_attempt_at: completedAt,
        next_attempt_at: null,
        last_error: attemptError(result),
      };
    }

    const delayMinutes = BACKOFF_MINUTES[attemptNumber - 1];
    return {
      status: 'retrying',
      attempt_count: attemptNumber,
      last_attempt_at: completedAt,
      next_attempt_at: new Date(completedAt.getTime() + delayMinutes * 60_000),
      last_error: attemptError(result),
    };
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function attemptError(result: AttemptResult): string {
  if (result.transportError) return 'transport-error';
  return result.responseStatus === undefined || result.responseStatus === null
    ? 'unknown'
    : `http-${String(result.responseStatus)}`;
}
