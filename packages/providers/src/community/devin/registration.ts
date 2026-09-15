import { isRegisteredProvider, registerProvider } from '../../registry';

import { DEVIN_CAPABILITIES } from './capabilities';
import { DevinProvider } from './provider';

/**
 * Register the Devin CLI community provider. Idempotent so every process
 * entrypoint can call it. The credential is ambient-only: every user of the
 * install shares the machine's `devin auth login`, so there is no per-user key
 * to connect and the settings card only reports whether that login is usable.
 */
export function registerDevinProvider(): void {
  if (isRegisteredProvider('devin')) return;
  registerProvider({
    id: 'devin',
    displayName: 'Devin CLI (community)',
    factory: () => new DevinProvider(),
    capabilities: DEVIN_CAPABILITIES,
    builtIn: false,
    credentials: {
      kind: 'static',
      specs: [{ vendor: 'devin', displayName: 'Devin', kinds: ['ambient'] }],
    },
  });
}
