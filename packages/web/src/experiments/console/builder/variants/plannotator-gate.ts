import type { PlannotatorGateNodeData, WireDagNode } from '../types';

export function defaultPlannotatorGateData(): PlannotatorGateNodeData {
  return {
    document: 'review.html',
    rework: { prompt: 'Apply the reviewer annotations.' },
  };
}

export function plannotatorGateFromDag(
  variantSpecific: Partial<WireDagNode>
): PlannotatorGateNodeData {
  if (variantSpecific.plannotator_gate === undefined) {
    throw new Error(
      "plannotatorGateFromDag: wire node has no 'plannotator_gate' field — use defaultPlannotatorGateData() for new nodes"
    );
  }
  return variantSpecific.plannotator_gate;
}

export function plannotatorGateToDag(data: PlannotatorGateNodeData): Partial<WireDagNode> {
  return { plannotator_gate: data };
}
