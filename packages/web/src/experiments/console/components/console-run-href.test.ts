import { describe, expect, test } from 'bun:test';
import { consoleRunHref } from './console-run-href';

describe('consoleRunHref', () => {
  test('encodes reserved characters in project, run, and node ids', () => {
    const projectId = 'proj/a b?x';
    const runId = 'run/id&z#1';
    const nodeId = 'node a&=b';
    expect(consoleRunHref(projectId, runId, nodeId)).toBe(
      `/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(runId)}?${new URLSearchParams({ node: nodeId }).toString()}`
    );
  });

  test('omits the node query when nodeId is null', () => {
    expect(consoleRunHref('proj 1', 'run/2', null)).toBe(
      `/console/p/${encodeURIComponent('proj 1')}/r/${encodeURIComponent('run/2')}`
    );
  });
});
