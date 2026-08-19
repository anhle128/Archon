import type { Codebase } from '../schemas/codebase';
import type { WorkflowProviderBindingForRouting } from '../db/provider-bindings';
import { getCodebase } from '../db/codebases';
import { getBindingByCodebase } from '../db/provider-bindings';

export type NotRoutableReason =
  | 'missing-codebase'
  | 'missing-binding'
  | 'binding-conflicting'
  | 'wrong-codebase'
  | 'binding-disabled'
  | 'missing-route'
  | 'missing-secret';

export type EventRouteResolution =
  | {
      routable: true;
      codebase: Codebase;
      binding: WorkflowProviderBindingForRouting;
      route: string;
      secret: string;
    }
  | {
      routable: false;
      codebase: Codebase | null;
      binding: WorkflowProviderBindingForRouting | null;
      reason: NotRoutableReason;
    };

export async function resolveEventRoute(codebaseId: string): Promise<EventRouteResolution> {
  const codebase = await getCodebase(codebaseId);
  if (!codebase) {
    return { routable: false, codebase: null, binding: null, reason: 'missing-codebase' };
  }

  const bindings = await getBindingByCodebase('archon', codebaseId);
  if (bindings.length === 0) {
    return { routable: false, codebase, binding: null, reason: 'missing-binding' };
  }
  if (bindings.length > 1) {
    return { routable: false, codebase, binding: null, reason: 'binding-conflicting' };
  }

  const binding = bindings[0];
  if (!binding) {
    return { routable: false, codebase, binding: null, reason: 'missing-binding' };
  }
  if (binding.codebase_id !== codebaseId) {
    return { routable: false, codebase, binding, reason: 'wrong-codebase' };
  }
  if (binding.state !== 'active' && binding.state !== 'rotated') {
    return { routable: false, codebase, binding, reason: 'binding-disabled' };
  }
  const route = binding.event_route.trim();
  if (!route) {
    return { routable: false, codebase, binding, reason: 'missing-route' };
  }
  const secret = binding.signing_secret?.trim();
  if (!secret) {
    return { routable: false, codebase, binding, reason: 'missing-secret' };
  }

  return { routable: true, codebase, binding, route, secret };
}
