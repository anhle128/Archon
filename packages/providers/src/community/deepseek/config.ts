import type { DeepseekProviderDefaults } from '../../types';

export type { DeepseekProviderDefaults };

export const DEFAULT_DEEPSEEK_PROFILE = 'acp' as const;
export const DEFAULT_DEEPSEEK_PROVIDER_ROUTE = 'deepseek-official';
export const DEFAULT_DEEPSEEK_PERMISSION_MODE = 'workspace-write' as const;

type DeepseekReasoningEffort = 'off' | 'low' | 'high' | 'max';
type DeepseekPermissionMode = NonNullable<DeepseekProviderDefaults['permissionMode']>;

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'baseUrl' | 'providerRoute' | 'nodeBin'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.deepseek.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseBaseUrl(raw: Record<string, unknown>): string | undefined {
  const value = parseTrimmedString(raw, 'baseUrl');
  if (value === undefined) return undefined;
  try {
    const protocol = new URL(value).protocol;
    if (protocol === 'http:' || protocol === 'https:') return value;
  } catch {
    // Invalid absolute URL — reject below with the protocol constraint.
  }
  throw new Error('Invalid assistants.deepseek.baseUrl: expected an http: or https: URL.');
}

function parseProfile(value: unknown): 'acp' {
  if (value === undefined) return DEFAULT_DEEPSEEK_PROFILE;
  if (typeof value === 'string' && value.trim() === 'acp') return 'acp';
  throw new Error(
    "Invalid assistants.deepseek.profile: expected 'acp' because other DSH profiles speak a different protocol."
  );
}

function parsePermissionMode(value: unknown): DeepseekPermissionMode {
  if (value === undefined) return DEFAULT_DEEPSEEK_PERMISSION_MODE;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'workspace-write' || trimmed === 'danger-full-access') {
      return trimmed;
    }
  }
  throw new Error(
    "Invalid assistants.deepseek.permissionMode: expected 'workspace-write' or 'danger-full-access'."
  );
}

/**
 * Map Archon effort values onto pinned DSH `reasoning_effort` (`off`/`low`/`high`/`max`).
 * Unknown or blank values fail closed instead of being omitted.
 */
export function resolveDeepseekEffort(value: unknown): DeepseekReasoningEffort | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid assistants.deepseek.effort: expected a non-empty string.');
  }
  const effort = value.trim();
  switch (effort) {
    case 'minimal':
      return 'off';
    case 'medium':
      return 'low';
    case 'xhigh':
      return 'high';
    case 'off':
    case 'low':
    case 'high':
    case 'max':
      return effort;
    default:
      throw new Error(
        `Invalid assistants.deepseek.effort: unsupported value '${effort}'. Expected off, low, high, max, or a ladder rung (minimal, medium, xhigh).`
      );
  }
}

/**
 * Parse raw `assistants.deepseek` config into typed defaults.
 * Defaults are applied so callers have one source of truth.
 */
export function parseDeepseekConfig(raw: Record<string, unknown>): DeepseekProviderDefaults {
  if (raw.maxTokens !== undefined) {
    throw new Error(
      'assistants.deepseek.maxTokens is unsupported: pinned DSH ACP exposes only model and reasoning_effort.'
    );
  }

  const model = parseTrimmedString(raw, 'model');
  const baseUrl = parseBaseUrl(raw);
  const providerRoute = parseTrimmedString(raw, 'providerRoute');
  const nodeBin = parseTrimmedString(raw, 'nodeBin');
  const effort = resolveDeepseekEffort(raw.effort);

  if (providerRoute !== undefined && model === undefined) {
    throw new Error(
      "Invalid assistants.deepseek.providerRoute: a model is required because DSH's model value is an inseparable [route, model] pair."
    );
  }

  const config: DeepseekProviderDefaults = {
    profile: parseProfile(raw.profile),
    providerRoute: providerRoute ?? DEFAULT_DEEPSEEK_PROVIDER_ROUTE,
    permissionMode: parsePermissionMode(raw.permissionMode),
  };
  if (model !== undefined) config.model = model;
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (nodeBin !== undefined) config.nodeBin = nodeBin;
  if (effort !== undefined) config.effort = effort;
  return config;
}
