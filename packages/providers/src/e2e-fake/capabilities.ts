import type { ProviderCapabilities } from '../types';

/**
 * Capabilities for the E2E fake provider.
 *
 * Deliberately minimal: the fake exists only to drive the workflow usage-record
 * path deterministically without a paid AI call. It advertises no optional
 * feature, so a workflow node that relies on one is warned by the dag-executor
 * exactly as it would be for any provider lacking that capability. `structuredOutput`
 * is `false` — the fake does not honor `output_format`; usage is supplied through
 * the prompt directive, not a schema.
 */
export const E2E_FAKE_CAPABILITIES: ProviderCapabilities = {
  sessionResume: false,
  mcp: false,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: false,
  envInjection: false,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
  settingSources: false,
  nativeTools: false,
  containerExec: false,
};
