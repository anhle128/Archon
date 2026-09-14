import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  AskHumanPauseFailedError,
  type AskHumanControlError,
  type MessageChunk,
} from '../../types';

export type DevinErrorSubtype =
  | 'devin_binary_missing'
  | 'devin_not_logged_in'
  | 'devin_unsupported_config'
  | 'devin_spawn_failed'
  | 'devin_child_exited'
  | 'devin_protocol_error'
  | 'devin_session_load_failed'
  | 'devin_unsupported_model'
  | 'devin_permission_blocked'
  | 'devin_aborted'
  | 'devin_acp_error';

export class DevinProviderError extends Error {
  readonly name = 'DevinProviderError';
  constructor(
    readonly subtype: DevinErrorSubtype,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

/** JSON-RPC code ACP reserves for "authentication required". */
export const ACP_AUTH_REQUIRED_CODE = -32000;

export function isAskHumanControlError(error: unknown): error is AskHumanControlError {
  return (
    error instanceof AskHumanAwaitingError ||
    error instanceof AskHumanNoStarterError ||
    error instanceof AskHumanPauseFailedError
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function acpCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

function acpData(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error.data)) return undefined;
  return error.data;
}

/**
 * Turn an ACP request failure into a typed provider error. AskHuman control
 * errors pass through untouched because the executor branches on their class;
 * wrapping them would turn a deliberate pause into a node failure.
 */
export function classifyDevinAcpError(error: unknown, fallback: DevinErrorSubtype): Error {
  if (error instanceof DevinProviderError) return error;
  if (isAskHumanControlError(error)) return error;

  const code = acpCode(error);
  const data = acpData(error);
  if (code === ACP_AUTH_REQUIRED_CODE) {
    return new DevinProviderError(
      'devin_not_logged_in',
      'Devin CLI is not logged in. Run `devin auth login` on the Archon host, then retry.',
      { cause: error }
    );
  }
  if (data?.['cognition.ai/errorKind'] === 'session_not_found') {
    return new DevinProviderError('devin_session_load_failed', errorMessage(error), {
      cause: error,
    });
  }
  const uri = data?.uri;
  if (code === -32002 && typeof uri === 'string' && uri.startsWith('Model not found')) {
    return new DevinProviderError('devin_unsupported_model', uri, { cause: error });
  }
  return new DevinProviderError(fallback, errorMessage(error), { cause: error });
}

const SENSITIVE_ENV_NAME_PATTERN =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH(?:ORIZATION)?|COOKIE)/i;
const MIN_SECRET_LENGTH = 4;

/** Values shorter than the floor match ordinary output and would shred it. */
export function isRedactableSecretValue(value: string | undefined): value is string {
  return value !== undefined && value.length >= MIN_SECRET_LENGTH;
}

export function isDevinSecretName(name: string): boolean {
  return SENSITIVE_ENV_NAME_PATTERN.test(name);
}

export function collectDevinSecretValues(env: Record<string, string | undefined>): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isDevinSecretName(name) && isRedactableSecretValue(value) && !secrets.includes(value)) {
      secrets.push(value);
    }
  }
  return secrets;
}

export function redactDevinSecrets(message: string, secrets: readonly string[]): string {
  let redacted = message;
  // Longest first so a shorter secret that prefixes a longer one cannot leave a tail.
  for (const secret of [...secrets].sort((a: string, b: string) => b.length - a.length)) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

/** Terminal result chunk for a failed turn. Never synthesizes usage or a session id. */
export function toDevinErrorResult(
  error: unknown,
  secrets: readonly string[]
): Extract<MessageChunk, { type: 'result' }> {
  const subtype = error instanceof DevinProviderError ? error.subtype : 'devin_acp_error';
  return {
    type: 'result',
    isError: true,
    errorSubtype: subtype,
    errors: [redactDevinSecrets(errorMessage(error), secrets)],
  };
}
