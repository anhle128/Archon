import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { DagNode } from '@/lib/api';
import { BACK_EDGE_GUTTER, NODE_WIDTH } from '@/lib/run-graph/constants';
import type { DagNodeState } from '@/lib/types';
import { layoutRunGraph } from './build-run-graph-input';
import { buildWorkflowDagViewModel } from './build-workflow-dag-view-model';

const YAML_PATH = join(
  import.meta.dir,
  '../../../../../.archon/workflows/defaults/speckit-ralph-native-no-hitl-feature.yaml'
);

interface YamlNode {
  id: string;
  depends_on?: string[] | string;
  when?: string;
  route_loop?: DagNode['route_loop'];
}

function toDagNodes(raw: { nodes: YamlNode[] }): DagNode[] {
  return raw.nodes.map(node => {
    const dag: DagNode = { id: node.id, prompt: node.id };
    if (node.depends_on !== undefined) {
      dag.depends_on = Array.isArray(node.depends_on) ? node.depends_on : [node.depends_on];
    }
    if (typeof node.when === 'string') {
      dag.when = node.when;
    }
    if (node.route_loop) {
      dag.route_loop = node.route_loop;
    }
    return dag;
  });
}

function live(nodeId: string, status: DagNodeState['status']): DagNodeState {
  return { nodeId, name: nodeId, status };
}

function clarifyBranchLiveStatus(dagNodes: readonly DagNode[]): DagNodeState[] {
  const statusById: Record<string, DagNodeState['status']> = {
    setup: 'completed',
    specify: 'completed',
    clarify: 'completed',
    'clarify-file-check': 'completed',
    'clarify-respond': 'skipped',
    'clarify-apply': 'skipped',
    'red-team': 'running',
  };
  return dagNodes.map(node => live(node.id, statusById[node.id] ?? 'pending'));
}

describe('speckit-ralph-native-no-hitl-feature clarify branch', () => {
  test('then stays on the spine and skip detours to the right of respond/apply', async () => {
    const raw = Bun.YAML.parse(await Bun.file(YAML_PATH).text()) as { nodes: YamlNode[] };
    const dagNodes = toDagNodes(raw);
    expect(dagNodes.map(node => node.id)).toContain('clarify-file-check');

    const liveStatus = clarifyBranchLiveStatus(dagNodes);
    const layout = layoutRunGraph(dagNodes, liveStatus);
    const model = buildWorkflowDagViewModel({
      dagNodes,
      liveStatus,
      selectedNodeId: 'clarify-file-check',
    });

    const thenRoute = layout.routes.find(
      route => route.source === 'clarify-file-check' && route.target === 'clarify-respond'
    );
    const skipRoute = layout.routes.find(
      route => route.source === 'clarify-file-check' && route.target === 'red-team'
    );
    expect(thenRoute).toBeDefined();
    expect(skipRoute).toBeDefined();
    if (thenRoute === undefined || skipRoute === undefined) return;

    expect(thenRoute.kind).toBe('conditional');
    expect(thenRoute.targetPort).toBe('top');
    expect(skipRoute.kind).toBe('dependency');
    expect(skipRoute.label).toBe('else');
    expect(skipRoute.outcome).toBe('negative');
    expect(skipRoute.targetPort).toBe('right');
    expect(skipRoute.path).not.toBe(thenRoute.path);
    expect(skipRoute.labelPosition).not.toEqual(thenRoute.labelPosition);

    const check = layout.positions['clarify-file-check'];
    const respond = layout.positions['clarify-respond'];
    const apply = layout.positions['clarify-apply'];
    expect(check).toBeDefined();
    expect(respond).toBeDefined();
    expect(apply).toBeDefined();
    const spineX = check.x + NODE_WIDTH / 2;
    const flankX = check.x + NODE_WIDTH + BACK_EDGE_GUTTER;
    expect(thenRoute.path.startsWith(`M ${spineX} `)).toBe(true);
    expect(skipRoute.path).toContain(`C ${flankX} `);
    expect(Math.abs(respond.x - check.x)).toBeLessThan(1);
    expect(Math.abs(apply.x - check.x)).toBeLessThan(1);

    const skipEdge = model.edges.find(edge => edge.id === skipRoute.edgeId);
    expect(skipEdge?.type).toBe('runGraphRoute');
    expect(skipEdge?.data?.route.path).toBe(skipRoute.path);
  });
});
