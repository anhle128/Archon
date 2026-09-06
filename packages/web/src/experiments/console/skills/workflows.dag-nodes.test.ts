import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { K } from '../store/keys';
import { getWorkflowDagNodes, type DagNode } from './workflows';

type FetchSpy = ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

let fetchSpy: FetchSpy | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string) => Response): FetchSpy {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as typeof fetch);
  return fetchSpy;
}

describe('getWorkflowDagNodes', () => {
  test('requests the list endpoint and returns the matching workflow nodes unchanged', async () => {
    const nodes: DagNode[] = [
      { id: 'plan', prompt: 'plan the deploy' },
      { id: 'ship', bash: 'echo ship', depends_on: ['plan'] },
    ];

    stubFetch(url => {
      expect(url).toBe('/api/workflows?cwd=%2Frepo%20path');
      return jsonResponse({
        workflows: [
          {
            workflow: {
              name: 'other',
              description: 'nope',
              nodes: [{ id: 'ignored', prompt: 'ignore' }],
            },
            source: 'bundled',
          },
          {
            workflow: {
              name: 'deploy/workflow',
              description: 'deploy',
              nodes,
            },
            source: 'project',
          },
        ],
        recommended: [],
      });
    });

    const result = await getWorkflowDagNodes('deploy/workflow', '/repo path');

    expect(fetchSpy?.mock.calls[0]?.[0]).toBe('/api/workflows?cwd=%2Frepo%20path');
    expect(result).toEqual(nodes);
  });

  test('rejects a missing exact workflow name the same way getWorkflowGraph does', async () => {
    stubFetch(url => {
      expect(url).toBe('/api/workflows?cwd=%2Frepo%20path');
      return jsonResponse({
        workflows: [
          {
            workflow: { name: 'deploy', description: 'close but not exact', nodes: [] },
            source: 'project',
          },
        ],
        recommended: [],
      });
    });

    await expect(getWorkflowDagNodes('deploy/workflow', '/repo path')).rejects.toThrow(
      'Workflow not found: deploy/workflow'
    );
  });
});

describe('K.workflowDagNodes', () => {
  test('encodes cwd and workflow name independently', () => {
    expect(K.workflowDagNodes('/repo path', 'deploy/workflow')).toBe(
      'workflow-dag-nodes:%2Frepo%20path:deploy%2Fworkflow'
    );
    expect(K.workflowDagNodes(undefined, 'deploy/workflow')).toBe(
      'workflow-dag-nodes::deploy%2Fworkflow'
    );
  });
});
