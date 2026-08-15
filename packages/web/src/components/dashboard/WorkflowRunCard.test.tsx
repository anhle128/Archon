import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import type { DashboardRunResponse } from '@/lib/api';
import { WorkflowRunCard } from './WorkflowRunCard';

function workflowRun(metadata: Record<string, unknown>): DashboardRunResponse {
  return {
    id: 'run-1',
    workflow_name: 'review-workflow',
    conversation_id: 'conversation-1',
    parent_conversation_id: null,
    codebase_id: 'codebase-1',
    status: 'paused',
    user_message: 'Review the plan',
    metadata,
    started_at: '2026-08-14T00:00:00.000Z',
    completed_at: null,
    last_activity_at: '2026-08-14T00:01:00.000Z',
    working_path: null,
    user_id: 'user-1',
    parent_run_id: null,
    output_root: null,
    codebase_name: 'archon',
    platform_type: 'web',
    worker_platform_id: 'worker-1',
    parent_platform_id: null,
    current_step_name: 'review',
    total_steps: 2,
    current_step_status: 'completed',
    agents_completed: 1,
    agents_failed: 0,
    agents_total: 1,
  };
}

function renderRun(run: DashboardRunResponse): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorkflowRunCard
        run={run}
        onCancel={(): void => undefined}
        onApprove={(): void => undefined}
      />
    </MemoryRouter>
  );
}

describe('WorkflowRunCard Plannotator review link', () => {
  test('renders an HTTPS review link for a paused Plannotator gate', () => {
    const markup = renderRun(
      workflowRun({
        approval: {
          type: 'plannotator_gate',
          reviewUrl: 'https://plannotator.example/reviews/run-1',
        },
      })
    );

    expect(markup).toContain('href="https://plannotator.example/reviews/run-1"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('Open Plannotator');
  });

  test('does not render the link for a standard approval', () => {
    const markup = renderRun(
      workflowRun({
        approval: {
          type: 'approval',
          reviewUrl: 'https://plannotator.example/reviews/run-1',
        },
      })
    );

    expect(markup).not.toContain('Open Plannotator');
  });

  test('does not render a link with an unsafe scheme', () => {
    const markup = renderRun(
      workflowRun({
        approval: {
          type: 'plannotator_gate',
          reviewUrl: 'javascript:alert(1)',
        },
      })
    );

    expect(markup).not.toContain('Open Plannotator');
    expect(markup).not.toContain('javascript:');
  });
});
