import type { OmpProviderDefaults } from '../../types';

export type { OmpProviderDefaults };

function parseTrimmedString(
  raw: Record<string, unknown>,
  field: 'model' | 'ompBinaryPath'
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid assistants.omp.${field}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseRawEffort(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid assistants.omp.modelReasoningEffort: expected a non-empty string.');
  }
  return value;
}

function parseEnableExtensions(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error('Invalid assistants.omp.enableExtensions: expected a boolean.');
  }
  return value;
}

export function parseOmpConfig(raw: Record<string, unknown>): OmpProviderDefaults {
  const config: OmpProviderDefaults = {};
  const model = parseTrimmedString(raw, 'model');
  const ompBinaryPath = parseTrimmedString(raw, 'ompBinaryPath');
  const modelReasoningEffort = parseRawEffort(raw.modelReasoningEffort);
  const enableExtensions = parseEnableExtensions(raw.enableExtensions);

  if (model !== undefined) config.model = model;
  if (modelReasoningEffort !== undefined) config.modelReasoningEffort = modelReasoningEffort;
  if (ompBinaryPath !== undefined) config.ompBinaryPath = ompBinaryPath;
  if (enableExtensions !== undefined) config.enableExtensions = enableExtensions;
  return config;
}
