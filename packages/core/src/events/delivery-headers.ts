import { z } from '@hono/zod-openapi';

export const deliveryHeadersSchema = z.record(z.string(), z.string());
export type DeliveryHeaders = z.infer<typeof deliveryHeadersSchema>;

export const UNSAFE_DELIVERY_HEADERS = 'unsafe-delivery-headers';
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED = new Set(
  [
    'Content-Type',
    'X-Webhook-Signature-V2',
    'X-Webhook-Timestamp',
    'X-Request-ID',
    'Host',
    'Content-Length',
    'Connection',
    'Keep-Alive',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'Proxy-Connection',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
  ].map(name => name.toLowerCase())
);

function fail(): never {
  throw new Error(UNSAFE_DELIVERY_HEADERS);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateDeliveryHeaders(headers: DeliveryHeaders): void {
  const entries = Object.entries(headers);
  if (entries.length > 16) fail();
  let totalValueBytes = 0;
  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (
      !HEADER_TOKEN.test(name) ||
      name.includes('\r') ||
      name.includes('\n') ||
      value.includes('\r') ||
      value.includes('\n') ||
      RESERVED.has(lowerName) ||
      utf8Bytes(name) > 128 ||
      utf8Bytes(value) > 8_192
    ) {
      fail();
    }
    totalValueBytes += utf8Bytes(value);
  }
  if (totalValueBytes > 32_768) fail();
}

export function normalizeDeliveryHeaders(value: unknown): DeliveryHeaders {
  const parsed = deliveryHeadersSchema.safeParse(value);
  if (!parsed.success) fail();
  validateDeliveryHeaders(parsed.data);
  return parsed.data;
}

export function mergeDeliveryHeaders(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string> {
  validateDeliveryHeaders(receiverHeaders);
  return { ...archonHeaders, ...receiverHeaders };
}

export function buildDeliveryHeaderEvidence(
  archonHeaders: Record<string, string>,
  receiverHeaders: DeliveryHeaders
): Record<string, string> {
  validateDeliveryHeaders(receiverHeaders);
  return {
    ...archonHeaders,
    ...Object.fromEntries(Object.keys(receiverHeaders).map(name => [name, '[REDACTED]'])),
  };
}
