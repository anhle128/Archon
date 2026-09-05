import { test as base, expect } from '@playwright/test';

import { createArchonRuntime, type ArchonRuntime } from './archon-runtime';

/**
 * Test fixture: every worker gets its own isolated Archon runtime, and `baseURL`
 * points at that worker's server. Import `test`/`expect` from here instead of
 * from `@playwright/test`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no test-scoped fixtures added; only the worker-scoped `archon`
export const test = base.extend<{}, { archon: ArchonRuntime }>({
  archon: [
    async ({}, use, workerInfo) => {
      const runtime = await createArchonRuntime(workerInfo.workerIndex);
      await use(runtime);
      await runtime.stop();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ archon }, use) => {
    await use(archon.baseURL);
  },
});

export { expect };
