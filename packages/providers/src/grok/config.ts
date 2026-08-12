import type { GrokProviderDefaults } from '../types';

export type { GrokProviderDefaults };

const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
  'plan',
] as const;

function parseString(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.grok.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

export function parseGrokConfig(raw: Record<string, unknown>): GrokProviderDefaults {
  const config: GrokProviderDefaults = {};
  const model = parseString(raw, 'model');
  const effort = parseString(raw, 'modelReasoningEffort');
  const binaryPath = parseString(raw, 'grokBinaryPath');
  if (model) config.model = model;
  if (effort) config.modelReasoningEffort = effort;
  if (binaryPath) config.grokBinaryPath = binaryPath;

  if (raw.permissionMode !== undefined) {
    if (
      typeof raw.permissionMode !== 'string' ||
      !PERMISSION_MODES.includes(raw.permissionMode as (typeof PERMISSION_MODES)[number])
    ) {
      throw new Error(
        `Invalid assistants.grok.permissionMode: expected one of ${PERMISSION_MODES.join(', ')}.`
      );
    }
    config.permissionMode = raw.permissionMode as GrokProviderDefaults['permissionMode'];
  }
  return config;
}
