import type { MessageChunk } from '../../types';

export type DeepseekErrorSubtype =
  | 'deepseek_missing_api_key'
  | 'deepseek_unsupported_config'
  | 'deepseek_runtime_unavailable'
  | 'deepseek_spawn_failed'
  | 'deepseek_resume_failed'
  | 'deepseek_mcp_config_error'
  | 'deepseek_protocol_error'
  | 'deepseek_aborted'
  | 'deepseek_acp_error';

export class DeepseekProviderError extends Error {
  readonly name = 'DeepseekProviderError';
  constructor(
    readonly subtype: DeepseekErrorSubtype,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

const SENSITIVE_ENV_NAME_PATTERN =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH(?:ORIZATION)?|COOKIE)/i;
const MIN_SECRET_LENGTH = 4;

function isRedactableSecret(value: string | undefined): value is string {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH;
}

export function isDeepseekSecretName(name: string): boolean {
  return SENSITIVE_ENV_NAME_PATTERN.test(name);
}

export function collectDeepseekSecretValues(env: Record<string, string | undefined>): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isDeepseekSecretName(name) && isRedactableSecret(value) && !secrets.includes(value)) {
      secrets.push(value);
    }
  }
  return secrets;
}

export function redactDeepseekSecrets(message: string, secrets: readonly string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Convert a thrown DeepSeek failure into a terminal result chunk.
 * Does not synthesize tokens, usage, cost, or a session id.
 */
export function toDeepseekErrorResult(
  error: unknown,
  secrets: readonly string[]
): Extract<MessageChunk, { type: 'result' }> {
  const subtype = error instanceof DeepseekProviderError ? error.subtype : 'deepseek_acp_error';
  return {
    type: 'result',
    isError: true,
    errorSubtype: subtype,
    errors: [redactDeepseekSecrets(errorMessage(error), secrets)],
  };
}
