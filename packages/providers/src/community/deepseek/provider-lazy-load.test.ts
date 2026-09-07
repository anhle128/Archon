/**
 * Regression test: @agentclientprotocol/sdk must not load at module-import time.
 *
 * DeepSeek talks ACP over stdio through a dynamically imported client. A static
 * SDK value import in the registration or provider module graph would evaluate
 * ACP during `registerCommunityProviders()` and inside compiled binaries that
 * never run a DeepSeek turn. Detection uses a factory counter, not a throw, so
 * a leak stays an assertion failure instead of an import crash.
 *
 * Do not mock `@deepseek-ai/dsh`: production never imports it as a module.
 *
 * Runs in its own `bun test` invocation because Bun's `mock.module` is
 * process-wide and would poison `acp-client.test.ts` / `provider.test.ts`.
 */
import { expect, mock, test } from 'bun:test';

let acpSdkLoadCount = 0;

mock.module('@agentclientprotocol/sdk', () => {
  acpSdkLoadCount += 1;
  return {};
});

test('importing registration and instantiating DeepseekProvider does not evaluate the ACP SDK', async () => {
  const { registerDeepseekProvider } = await import('./registration');
  const { DeepseekProvider } = await import('./provider');
  const { clearRegistry } = await import('../../registry');

  clearRegistry();
  registerDeepseekProvider();

  const provider = new DeepseekProvider();
  expect(provider.getType()).toBe('deepseek');
  expect(provider.getCapabilities()).toBeDefined();
  expect(acpSdkLoadCount).toBe(0);
});
