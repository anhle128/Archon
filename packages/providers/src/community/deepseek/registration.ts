import { isRegisteredProvider, registerProvider } from '../../registry';

import { DEEPSEEK_CAPABILITIES } from './capabilities';
import { DeepseekProvider } from './provider';

/**
 * Register the DeepSeek Harness community provider.
 *
 * Idempotent — safe to call multiple times, so process entrypoints (CLI,
 * server, config-loader) can each call it without coordination. Kept
 * separate from `registerBuiltinProviders()` because `builtIn: false` is
 * load-bearing: DeepSeek is a community provider and must not be conflated
 * with core providers until it's explicitly promoted.
 */
export function registerDeepseekProvider(): void {
  if (isRegisteredProvider('deepseek')) return;
  registerProvider({
    id: 'deepseek',
    displayName: 'DeepSeek Harness (community)',
    factory: () => new DeepseekProvider(),
    capabilities: DEEPSEEK_CAPABILITIES,
    builtIn: false,
    credentials: {
      kind: 'static',
      specs: [
        {
          vendor: 'deepseek',
          displayName: 'DeepSeek',
          kinds: ['api_key'],
        },
      ],
    },
  });
}
