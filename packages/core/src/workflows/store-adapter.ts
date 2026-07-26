/**
 * WorkflowStore adapter — bridges @archon/core DB modules to the
 * IWorkflowStore trait defined in @archon/workflows.
 */
import type { IWorkflowStore } from '@archon/workflows/store';
import type { WorkflowConfig, WorkflowDeps } from '@archon/workflows/deps';
import type { WorkflowRunStatus } from '@archon/workflows/schemas/workflow-run';
import type { MergedConfig } from '../config/config-types';
import * as workflowDb from '../db/workflows';
import * as workflowEventDb from '../db/workflow-events';
import * as workflowEventOutboxDb from '../db/workflow-event-outbox';
import * as workflowNodeSessionDb from '../db/workflow-node-sessions';
import * as workflowCheckpointDb from '../db/workflow-checkpoints';
import * as codebaseDb from '../db/codebases';
import * as envVarDb from '../db/env-vars';
import { resolveEventRoute, type NotRoutableReason } from '../events/binding-router';
import {
  buildWorkflowEventEnvelope,
  type ExternalWorkflowEventType,
} from '../events/workflow-event-envelope';
import { getAgentProvider } from '@archon/providers';
import { loadConfig as loadMergedConfig } from '../config/config-loader';
import { createLogger } from '@archon/paths';
import type { IGitHubAppAuthProvider } from '../github-auth';
import { isPerUserGitHubEnabled } from '../github-auth/config';
import { getDecryptedAccessToken } from '../db/user-github-token-store';
import { isPerUserProviderKeysEnabled } from '../credentials/config';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  deliverCredential,
  buildPiAuthJson,
  PI_AUTH_JSON_RELATIVE_PATH,
  PI_AUTH_PATH_ENV,
} from '../credentials/delivery';
import { listDecryptedUserProviderCredentials } from '../db/user-provider-key-store';
import { getUserAiPrefs, type UserAiPrefs } from '../db/user-ai-prefs-store';

// Compile-time assertion: MergedConfig must remain a structural subtype of WorkflowConfig.
// If MergedConfig drifts from WorkflowConfig, this line becomes a type error.
const assertConfigCompat: WorkflowConfig = {} as MergedConfig;
void assertConfigCompat;

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflow.store-adapter');
  return cachedLog;
}

const EXTERNAL_EVENT_TYPES = new Set<string>([
  'workflow.run.started',
  'workflow.run.completed',
  'workflow.run.failed',
  'workflow.approval.requested',
  'workflow.delivery.failed',
  'workflow.artifact.recorded',
]);

const INTERNAL_EVENT_TYPE_MAP = new Map<string, ExternalWorkflowEventType>([
  ['workflow_started', 'workflow.run.started'],
  ['workflow_completed', 'workflow.run.completed'],
  ['approval_requested', 'workflow.approval.requested'],
]);

interface ExternalWorkflowEventInput {
  workflow_run_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

function toExternalEventType(value: string): ExternalWorkflowEventType | null {
  return EXTERNAL_EVENT_TYPES.has(value) ? (value as ExternalWorkflowEventType) : null;
}

function buildInternalEventPayload(input: {
  runId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  stepName?: string;
  data?: Record<string, unknown>;
}): Record<string, unknown> {
  if (input.eventType === 'workflow.run.started') {
    return { state: 'running', startedAt: input.occurredAt };
  }
  if (input.eventType === 'workflow.run.completed') {
    return {
      state: 'completed',
      result: {
        outcome: 'accepted',
        completedAt: input.occurredAt,
        ...(input.data ?? {}),
      },
    };
  }
  if (input.eventType === 'workflow.run.failed') {
    return {
      state: 'failed',
      failure: {
        code: 'WORKFLOW_FAILED',
        category: 'workflow_failure',
        retryable: false,
        details: input.data ?? {},
      },
    };
  }
  if (input.eventType === 'workflow.approval.requested') {
    return {
      state: 'waiting-for-approval',
      approval: {
        requestId: `approval:${input.runId}:${input.stepName ?? 'workflow'}`,
        requestedAction: 'approve-or-reject',
        phase: input.stepName ?? 'approval',
        ...(input.data ?? {}),
      },
    };
  }
  return input.data ?? {};
}

function buildNotRoutableBody(input: {
  eventId: string;
  eventType: ExternalWorkflowEventType;
  occurredAt: string;
  idempotencyKey: string;
  reason: NotRoutableReason;
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify({
    schemaVersion: 'workflow-event-envelope.v1',
    provider: 'archon',
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    notRoutableReason: input.reason,
    payload: input.payload,
  });
}

async function enqueueExternalWorkflowEvent(input: ExternalWorkflowEventInput): Promise<void> {
  try {
    const eventType = toExternalEventType(input.event_type);
    if (!eventType) {
      getLog().warn(
        { eventType: input.event_type, runId: input.workflow_run_id },
        'workflow_event_outbox_unsupported_event_type'
      );
      return;
    }

    const run = await workflowDb.getWorkflowRun(input.workflow_run_id);
    if (!run) {
      getLog().warn({ runId: input.workflow_run_id }, 'workflow_event_outbox_run_missing');
      return;
    }

    const eventId = `evt_${randomUUID()}`;
    const codebaseId = run.codebase_id;
    if (!codebaseId) {
      const reason: NotRoutableReason = 'missing-codebase';
      const idempotencyKey = `archon:not-routable:${eventId}`;
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: eventId,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        workflow_run_id: run.id,
        event_body: buildNotRoutableBody({
          eventId,
          eventType,
          occurredAt: input.occurred_at,
          idempotencyKey,
          reason,
          payload: input.payload,
        }),
        status: 'not-routable',
        not_routable_reason: reason,
      });
      return;
    }

    const resolution = await resolveEventRoute(codebaseId);
    if (!resolution.routable) {
      const idempotencyKey = resolution.binding
        ? `archon:${resolution.binding.name}:${eventId}`
        : `archon:not-routable:${eventId}`;
      const eventBody =
        resolution.codebase && resolution.binding
          ? JSON.stringify(
              buildWorkflowEventEnvelope({
                eventId,
                eventType,
                occurredAt: input.occurred_at,
                run,
                codebase: resolution.codebase,
                binding: resolution.binding,
                payload: input.payload,
              })
            )
          : buildNotRoutableBody({
              eventId,
              eventType,
              occurredAt: input.occurred_at,
              idempotencyKey,
              reason: resolution.reason,
              payload: input.payload,
            });
      await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
        event_id: eventId,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        workflow_run_id: run.id,
        codebase_id: resolution.codebase?.id ?? codebaseId,
        binding_id: resolution.binding?.id ?? null,
        event_body: eventBody,
        status: 'not-routable',
        not_routable_reason: resolution.reason,
      });
      return;
    }

    const envelope = buildWorkflowEventEnvelope({
      eventId,
      eventType,
      occurredAt: input.occurred_at,
      run,
      codebase: resolution.codebase,
      binding: resolution.binding,
      payload: input.payload,
    });
    await workflowEventOutboxDb.enqueueExternalWorkflowEvent({
      event_id: envelope.eventId,
      idempotency_key: envelope.idempotencyKey,
      event_type: envelope.eventType,
      workflow_run_id: run.id,
      codebase_id: resolution.codebase.id,
      binding_id: resolution.binding.id,
      event_route: resolution.route,
      event_body: JSON.stringify(envelope),
      status: 'pending',
      next_attempt_at: input.occurred_at,
    });
  } catch (err) {
    getLog().error(
      { err: err as Error, eventType: input.event_type, runId: input.workflow_run_id },
      'workflow_event_outbox_enqueue_unexpected_throw'
    );
  }
}

export function createWorkflowStore(): IWorkflowStore {
  return {
    createWorkflowRun: workflowDb.createWorkflowRun,
    getWorkflowRun: workflowDb.getWorkflowRun,
    getActiveWorkflowRunByPath: workflowDb.getActiveWorkflowRunByPath,
    findResumableRun: workflowDb.findResumableRun,
    failOrphanedRuns: workflowDb.failOrphanedRuns,
    resumeWorkflowRun: workflowDb.resumeWorkflowRun,
    updateWorkflowRun: workflowDb.updateWorkflowRun,
    updateWorkflowActivity: workflowDb.updateWorkflowActivity,
    // DB returns string | null; IWorkflowStore declares WorkflowRunStatus | null.
    // The remote_agent_workflow_runs.status column is constrained to valid enum values
    // in SQL, so this cast is safe as long as the column constraint matches WorkflowRunStatus.
    getWorkflowRunStatus: id =>
      workflowDb.getWorkflowRunStatus(id) as Promise<WorkflowRunStatus | null>,
    completeWorkflowRun: workflowDb.completeWorkflowRun,
    failWorkflowRun: workflowDb.failWorkflowRun,
    pauseWorkflowRun: workflowDb.pauseWorkflowRun,
    claimWriteback: workflowDb.claimWriteback,
    releaseWritebackClaim: workflowDb.releaseWritebackClaim,
    cancelWorkflowRun: workflowDb.cancelWorkflowRun,
    persistRouteDecisionTransition: workflowDb.persistRouteDecisionTransition,
    createWorkflowEvent: async (data): Promise<void> => {
      try {
        await workflowEventDb.createWorkflowEvent(data);
        const eventType = INTERNAL_EVENT_TYPE_MAP.get(data.event_type);
        if (eventType) {
          const occurredAt = new Date().toISOString();
          await enqueueExternalWorkflowEvent({
            workflow_run_id: data.workflow_run_id,
            event_type: eventType,
            occurred_at: occurredAt,
            payload: buildInternalEventPayload({
              runId: data.workflow_run_id,
              eventType,
              occurredAt,
              stepName: data.step_name,
              data: data.data,
            }),
          });
        }
      } catch (err) {
        // Belt-and-suspenders: workflowEventDb.createWorkflowEvent already catches internally,
        // but this wrapper guarantees the IWorkflowStore non-throwing contract at the boundary.
        getLog().error(
          { err: err as Error, eventType: data.event_type, runId: data.workflow_run_id },
          'workflow_event_create_unexpected_throw'
        );
      }
    },
    enqueueExternalWorkflowEvent,
    getCompletedDagNodeOutputs: workflowEventDb.getCompletedDagNodeOutputs,
    upsertWorkflowNodeCheckpoint: workflowCheckpointDb.upsertWorkflowNodeCheckpoint,
    getLatestWorkflowNodeCheckpoint: workflowCheckpointDb.getLatestWorkflowNodeCheckpoint,
    getCodebase: codebaseDb.getCodebase,
    getCodebaseEnvVars: envVarDb.getCodebaseEnvVars,
    getWorkflowNodeSession: workflowNodeSessionDb.getWorkflowNodeSession,
    upsertWorkflowNodeSession: workflowNodeSessionDb.upsertWorkflowNodeSession,
    deleteWorkflowNodeSessions: workflowNodeSessionDb.deleteWorkflowNodeSessions,
  };
}

/**
 * Module-singleton registration for the GitHub App auth provider. Set by the
 * server bootstrap (`registerGitHubAppAuthProvider(provider)`) when App mode
 * is active; remains null in PAT mode and during CLI execution. The
 * workflow-deps factory reads this to decide whether to expose
 * `resolveBotGitHubToken` to the engine.
 *
 * Singleton because the provider is itself a process-singleton (one cache
 * shared by the GitHub adapter, the workflow executor, and the internal
 * credential-helper endpoint). Threading it through every createWorkflowDeps
 * caller would just smuggle a singleton through more arguments.
 */
let registeredGitHubAppAuthProvider: IGitHubAppAuthProvider | null = null;

export function registerGitHubAppAuthProvider(provider: IGitHubAppAuthProvider | null): void {
  registeredGitHubAppAuthProvider = provider;
}

/**
 * Create the canonical WorkflowDeps for the workflow engine.
 * Single construction point — avoids duplicating the wiring across callers.
 */
export function createWorkflowDeps(): WorkflowDeps {
  const provider = registeredGitHubAppAuthProvider;
  return {
    store: createWorkflowStore(),
    getAgentProvider,
    loadConfig: loadMergedConfig,
    // App mode: resolve fresh installation tokens for subprocess env. PAT mode:
    // undefined → engine falls back to env inheritance, preserving legacy
    // behaviour for solo installs.
    resolveBotGitHubToken: provider
      ? async (owner: string, repo: string): Promise<string | undefined> => {
          try {
            return await provider.getInstallationToken(owner, repo);
          } catch (err) {
            getLog().warn(
              { err: err as Error, owner, repo },
              'workflow_deps.bot_token_resolve_failed'
            );
            return undefined;
          }
        }
      : undefined,
    // Per-user token policy (PR-C): when per-user mode is on, route a run's
    // gh/git through the originating user's personal token (decrypted, refreshed
    // on read), or scrub the org/bot token when they haven't connected.
    isPerUserGitHubEnabled: () => isPerUserGitHubEnabled(),
    getUserGithubToken: async (userId: string): Promise<string | undefined> => {
      try {
        return (await getDecryptedAccessToken(userId)) ?? undefined;
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.user_token_resolve_failed');
        return undefined;
      }
    },
    // Per-user AI-provider credentials (Phase 2): list the user's decrypted
    // credentials and translate each through the delivery map into an env bag
    // (and optional file deliveries) for the run. Engine-facing contract is
    // env+files only — the delivery map is owned here, not in @archon/workflows,
    // so the workflow engine stays free of provider-specific knowledge.
    isPerUserProviderKeysEnabled: () => isPerUserProviderKeysEnabled(),
    getUserProviderEnv: async (
      userId: string,
      artifactsDir: string
    ): Promise<{
      env: Record<string, string>;
      files: { path: string; contents: string }[];
    }> => {
      try {
        const creds = await listDecryptedUserProviderCredentials(userId);
        const env: Record<string, string> = {};
        const files: { path: string; contents: string }[] = [];
        for (const { provider, cred } of creds) {
          try {
            const result = deliverCredential(provider, cred, { artifactsDir });
            Object.assign(env, result.env);
            if (result.files) files.push(...result.files);
          } catch (err) {
            // Unknown provider / shape mismatch — log at ERROR (no per-credential
            // user-facing skip event yet) and skip this credential rather than
            // abort all delivery.
            getLog().error(
              { err: err as Error, userId, provider },
              'workflow_deps.provider_creds_deliver_failed'
            );
          }
        }
        // Aggregate Pi auth.json (the user's keys + subscriptions) so a `pi` node
        // consumes them via AuthStorage(authPath) without moving Pi's home. Needs
        // a real artifactsDir (file delivery); the chat path is env-only.
        if (artifactsDir) {
          const piAuthJson = buildPiAuthJson(creds);
          if (piAuthJson) {
            const piAuthPath = join(artifactsDir, PI_AUTH_JSON_RELATIVE_PATH);
            files.push({ path: piAuthPath, contents: piAuthJson });
            env[PI_AUTH_PATH_ENV] = piAuthPath;
          }
        }
        return { env, files };
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.provider_creds_resolve_failed');
        return { env: {}, files: [] };
      }
    },
    // Per-user AI prefs (Phase 3): personal tiers/aliases/default-provider,
    // folded into buildAiProfile as the highest-precedence layer. Non-throwing —
    // a DB failure means the run falls back to install-wide config.
    getUserAiPrefs: async (userId: string): Promise<UserAiPrefs> => {
      try {
        return await getUserAiPrefs(userId);
      } catch (err) {
        getLog().warn({ err: err as Error, userId }, 'workflow_deps.user_ai_prefs_resolve_failed');
        return {};
      }
    },
  };
}
