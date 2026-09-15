/**
 * Regression test: @agentclientprotocol/sdk must not load at module-import time.
 * Devin talks ACP over stdio through a dynamically imported client; a static SDK
 * value import in the registration or provider graph would evaluate ACP during
 * registerCommunityProviders() and in binaries that never run a Devin turn.
 * Runs in its own `bun test` invocation because mock.module is process-wide.
 */
import { expect, mock, test } from 'bun:test';

let acpSdkLoadCount = 0;

mock.module('@agentclientprotocol/sdk', () => {
  acpSdkLoadCount += 1;
  return {};
});

test('importing registration and instantiating DevinProvider does not evaluate the ACP SDK', async () => {
  const { registerDevinProvider } = await import('./registration');
  const { DevinProvider } = await import('./provider');
  const { clearRegistry } = await import('../../registry');

  clearRegistry();
  registerDevinProvider();

  const provider = new DevinProvider();
  expect(provider.getType()).toBe('devin');
  expect(provider.getCapabilities()).toBeDefined();
  expect(acpSdkLoadCount).toBe(0);
});
