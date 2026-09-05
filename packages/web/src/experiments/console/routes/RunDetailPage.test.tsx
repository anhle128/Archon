import { createElement, Fragment } from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { RunDetailHeader } from '../components/RunDetailHeader';
import { WorkflowEnvResolvedTable } from '../components/WorkflowEnvResolvedTable';
import { toRun, type Run } from '../primitives/run';
import { hasRunEnvOverlayUi } from './RunDetailPage';
import type { UsageReport } from '../skills/usage';

function emptyMetrics(): UsageReport['totals'] {
  return {
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: null,
    estimatedUsd: null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
  };
}

function usage(): UsageReport {
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'node',
    totals: emptyMetrics(),
    groups: [],
    coverage: {
      usageEventCount: 0,
      ledgeredEventCount: 0,
      unledgeredEventCount: 0,
      hasRecordedUsage: false,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
    },
  };
}

/**
 * Mirrors RunDetailPage's ENV surfaces (header chip + resolved table gate)
 * without mounting the full hook-heavy page (console tests avoid mock.module).
 */
function renderRunDetailEnvSurfaces(run: Run): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        Fragment,
        null,
        createElement(RunDetailHeader, {
          run,
          projectName: 'demo',
          projectId: 'proj-1',
          usage: usage(),
        }),
        hasRunEnvOverlayUi(run)
          ? createElement(WorkflowEnvResolvedTable, { overlay: run.envOverlay })
          : null,
        // Stand-in for the rest of the log column (started line / stream).
        createElement(
          'div',
          { 'data-testid': 'run-detail-rest' },
          `workflow:${run.workflow} status:${run.status} msg:${run.userMessage}`
        )
      )
    )
  );
}

function rawRun(metadata: Record<string, unknown> | undefined): Run {
  return toRun({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    workflow_name: 'archon-dev',
    status: 'completed',
    codebase_id: 'proj-1',
    started_at: '2026-09-04T10:00:00Z',
    completed_at: '2026-09-04T10:05:00Z',
    user_message: 'ship it',
    platform_type: 'cli',
    metadata,
  });
}

describe('RunDetailPage ENV surfaces', () => {
  test('malformed envOverlay metadata omits chip and table; rest of detail still renders', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        // missing patches + non-array skipped + corrupt resolved → hybrid
        skippedNodeIds: 'not-array',
        resolved: 'not-object',
      },
      total_cost_usd: 1.25,
    });

    expect(run.envOverlay).toBeNull();
    expect(hasRunEnvOverlayUi(run)).toBe(false);

    const html = renderRunDetailEnvSurfaces(run);
    expect(html).not.toContain('run-env-chip');
    expect(html).not.toContain('workflow-env-resolved-table');
    expect(html).not.toContain('No provider-turn request rows');
    expect(html).not.toContain('env: fast');
    // Non-ENV run detail content remains.
    expect(html).toContain('archon-dev');
    expect(html).toContain('ship it');
    expect(html).toContain('data-testid="run-detail-rest"');
    expect(html).toContain('workflow:archon-dev');
  });

  test('valid complete overlay still shows chip + resolved table via the same gate', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        patches: {},
        skippedNodeIds: [],
        latestMissingNodeIds: [],
        resolved: {
          plan: { provider: 'claude', model: 'sonnet' },
        },
      },
    });

    expect(hasRunEnvOverlayUi(run)).toBe(true);
    const html = renderRunDetailEnvSurfaces(run);
    expect(html).toContain('run-env-chip');
    expect(html).toContain('env: fast');
    expect(html).toContain('workflow-env-resolved-table');
    expect(html).toContain('sonnet');
    expect(html).toContain('data-testid="run-detail-rest"');
  });

  test('corrupt frozen patch metadata hides only ENV surfaces and never leaks bodies', () => {
    const run = rawRun({
      envOverlay: {
        envId: 'e1',
        envName: 'fast',
        workflowName: 'archon-dev',
        // Valid-looking identity + lifecycle keys, corrupt per-node patch shape.
        patches: { plan: { prompt: 42, typo: 'SECRET_PATCH_BODY' } },
        skippedNodeIds: [],
        latestMissingNodeIds: [],
        resolved: {
          plan: { provider: 'claude', model: 'sonnet' },
        },
      },
      total_cost_usd: 0.5,
    });

    expect(run.envOverlay).toBeNull();
    expect(hasRunEnvOverlayUi(run)).toBe(false);

    const html = renderRunDetailEnvSurfaces(run);
    expect(html).not.toContain('run-env-chip');
    expect(html).not.toContain('workflow-env-resolved-table');
    expect(html).not.toContain('env: fast');
    expect(html).not.toContain('sonnet');
    expect(html).not.toContain('SECRET_PATCH_BODY');
    expect(html).not.toContain('typo');
    // Rest of run detail remains usable.
    expect(html).toContain('archon-dev');
    expect(html).toContain('ship it');
    expect(html).toContain('data-testid="run-detail-rest"');
    expect(html).toContain('workflow:archon-dev status:completed');
  });
});
