import type { CopilotProviderDefaults } from '../../types';

export type { CopilotProviderDefaults };

/**
 * Parse raw `assistants.copilot` config into a typed `CopilotProviderDefaults`.
 *
 * Provider-owned effort values are preserved verbatim; the SDK/API validates
 * its current vocabulary.
 */
export function parseCopilotConfig(raw: Record<string, unknown>): CopilotProviderDefaults {
  const config: CopilotProviderDefaults = {};

  if (typeof raw.model === 'string') {
    config.model = raw.model;
  }

  if (raw.modelReasoningEffort !== undefined) {
    if (typeof raw.modelReasoningEffort !== 'string' || raw.modelReasoningEffort.length === 0) {
      throw new Error(
        'Invalid assistants.copilot.modelReasoningEffort: expected a non-empty string.'
      );
    }
    config.modelReasoningEffort = raw.modelReasoningEffort;
  }

  if (typeof raw.copilotCliPath === 'string') {
    config.copilotCliPath = raw.copilotCliPath;
  }

  if (typeof raw.configDir === 'string') {
    config.configDir = raw.configDir;
  }

  if (typeof raw.enableConfigDiscovery === 'boolean') {
    config.enableConfigDiscovery = raw.enableConfigDiscovery;
  }

  if (typeof raw.useLoggedInUser === 'boolean') {
    config.useLoggedInUser = raw.useLoggedInUser;
  }

  if (
    raw.logLevel === 'none' ||
    raw.logLevel === 'error' ||
    raw.logLevel === 'warning' ||
    raw.logLevel === 'info' ||
    raw.logLevel === 'debug' ||
    raw.logLevel === 'all'
  ) {
    config.logLevel = raw.logLevel;
  }

  return config;
}
