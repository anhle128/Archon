import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { ProjectProvider } from '@/contexts/ProjectContext';
import { WorkflowList } from './WorkflowList';

describe('WorkflowList', () => {
  test('keeps project selection available when the current scope has no workflows', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      ['codebases'],
      [
        {
          id: 'archon-project',
          name: 'OceanLabs/archon',
          default_cwd: '/workspace/archon',
        },
      ]
    );
    queryClient.setQueryData(['workflows', null], { workflows: [], recommended: [] });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProjectProvider>
          <MemoryRouter>
            <WorkflowList />
          </MemoryRouter>
        </ProjectProvider>
      </QueryClientProvider>
    );

    queryClient.clear();
    expect(markup).toContain('aria-label="Workflow project"');
    expect(markup).toContain('Select project');
    expect(markup).toContain('OceanLabs/archon');
  });
});
