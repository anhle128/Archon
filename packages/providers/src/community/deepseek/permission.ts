import type { RequestPermissionResponse } from '@agentclientprotocol/sdk';

/**
 * Auto-cancel every DSH ACP permission prompt. Never select an option id.
 */
export function answerDeepseekPermissionRequest(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}
