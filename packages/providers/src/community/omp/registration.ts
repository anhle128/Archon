import { isRegisteredProvider, registerProvider } from '../../registry';

import { OMP_CAPABILITIES } from './capabilities';
import { OmpProvider } from './provider';

export function registerOmpProvider(): void {
  if (isRegisteredProvider('omp')) return;
  registerProvider({
    id: 'omp',
    displayName: 'OMP CLI',
    factory: () => new OmpProvider(),
    capabilities: OMP_CAPABILITIES,
    builtIn: false,
    credentials: { kind: 'static', specs: [] },
  });
}
