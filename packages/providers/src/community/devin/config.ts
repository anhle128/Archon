import type { DevinProviderDefaults } from '../../types';

export type { DevinProviderDefaults };

/** Devin's own tool-permission mode for the spawned child. Fixed by design. */
export const DEVIN_PERMISSION_MODE = 'yolo' as const;

const AGENT_TYPES = ['summarizer', 'review'] as const;
type DevinAgentType = (typeof AGENT_TYPES)[number];

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'binaryPath'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.devin.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseAgentType(value: unknown): DevinAgentType | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value.trim())) {
    return value.trim() as DevinAgentType;
  }
  throw new Error("Invalid assistants.devin.agentType: expected 'summarizer' or 'review'.");
}

function parseRefusalFallback(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item): item is string => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new Error(
      'Invalid assistants.devin.refusalFallback: expected an array of non-empty strings.'
    );
  }
  return value.map(item => item.trim());
}

/**
 * Parse raw `assistants.devin` config into typed defaults. Keys that would
 * change Devin's permission posture are rejected instead of ignored so an
 * operator cannot believe a stricter mode is in effect.
 */
export function parseDevinConfig(raw: Record<string, unknown>): DevinProviderDefaults {
  if (raw.permissionMode !== undefined) {
    throw new Error(
      'assistants.devin.permissionMode is unsupported: Archon always runs Devin in yolo mode.'
    );
  }
  if (raw.sandbox !== undefined) {
    throw new Error(
      'assistants.devin.sandbox is unsupported: Devin sandbox mode is not part of the yolo contract.'
    );
  }

  const config: DevinProviderDefaults = {};
  const model = parseTrimmedString(raw, 'model');
  const binaryPath = parseTrimmedString(raw, 'binaryPath');
  const agentType = parseAgentType(raw.agentType);
  const refusalFallback = parseRefusalFallback(raw.refusalFallback);
  if (model !== undefined) config.model = model;
  if (binaryPath !== undefined) config.binaryPath = binaryPath;
  if (agentType !== undefined) config.agentType = agentType;
  if (refusalFallback !== undefined) config.refusalFallback = refusalFallback;
  return config;
}

/**
 * Child argv after the binary. The model is deliberately NOT passed here:
 * `--model` accepts aliases but silently keeps the default on an unknown name,
 * so the model is applied over ACP where an unknown id fails loudly.
 */
export function buildDevinSpawnArgs(config: DevinProviderDefaults): string[] {
  const args = ['--permission-mode', DEVIN_PERMISSION_MODE, 'acp'];
  if (config.agentType !== undefined) args.push('--agent-type', config.agentType);
  if (config.refusalFallback !== undefined && config.refusalFallback.length > 0) {
    args.push('--refusal-fallback', config.refusalFallback.join(','));
  }
  return args;
}
