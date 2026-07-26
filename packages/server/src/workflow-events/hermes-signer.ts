import { createHmac } from 'node:crypto';

export interface HermesV2Signature {
  signature: string;
  timestamp: string;
}

export function signHermesV2(
  secret: string,
  timestampSeconds: number,
  rawBody: string
): HermesV2Signature {
  const timestamp = String(timestampSeconds);
  return {
    timestamp,
    signature: createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  };
}
