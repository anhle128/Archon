import { DeepseekProviderError } from './errors';

export interface DeepseekChildEnvInput {
  ambient: Record<string, string | undefined>;
  request?: Record<string, string>;
  baseUrl?: string;
  permissionMode: 'workspace-write' | 'danger-full-access';
}

/**
 * Build the DSH child environment from isolated records.
 * Model route selection is sent over ACP, not through DSH environment overrides.
 * Does not trim or log `DEEPSEEK_API_KEY`.
 */
export function buildDeepseekChildEnv(input: DeepseekChildEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.ambient)) {
    if (value !== undefined) env[key] = value;
  }
  if (input.request !== undefined) {
    Object.assign(env, input.request);
  }
  if (input.baseUrl !== undefined) {
    env.DEEPSEEK_BASE_URL = input.baseUrl;
  }
  env.DSH_PERMISSION_MODE = input.permissionMode;

  const apiKey = env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new DeepseekProviderError(
      'deepseek_missing_api_key',
      'DEEPSEEK_API_KEY is missing. Connect a DeepSeek API key for the acting user or set DEEPSEEK_API_KEY in the environment.'
    );
  }
  return env;
}
