import { Window } from 'happy-dom';
import { join } from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { GitReadyDiffResponse } from '@/lib/api';

import { FileViewer } from '../components/workflows/source-control/file-viewer';

class ResizeObserverStub {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

const win = new Window({ url: 'https://localhost/' });
Object.assign(globalThis as object, {
  window: win,
  document: win.document,
  self: win,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver ?? ResizeObserverStub,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const totalHunks = 4096;
const content = 'x'.repeat(512);
const fixtureBytes = Buffer.byteLength(content, 'utf8') * totalHunks;
const response: GitReadyDiffResponse = {
  path: 'large.ts',
  status: 'M',
  scope: 'now',
  ref: 'live',
  cursor: '',
  truncated: false,
  binary: false,
  fileFallback: false,
  hunks: Array.from({ length: totalHunks }, (_unused, index) => ({
    header: '@@ -0,0 +' + String(index + 1) + ' @@',
    oldStart: 0,
    oldLines: 0,
    newStart: index + 1,
    newLines: 1,
    changes: [{ type: 'insert' as const, content, newLine: index + 1 }],
  })),
};

const element = win.document.createElement('div');
win.document.body.append(element);
const host = element as unknown as Element;
const root = createRoot(host);
const started = performance.now();
await act(async () => {
  root.render(
    <FileViewer
      state={{
        kind: 'diff',
        file: { path: 'large.ts', status: 'M' },
        response,
        reloadFingerprint: 'spike',
      }}
      stacked={false}
      onCancel={(): void => undefined}
      onReload={(): void => undefined}
      onClose={(): void => undefined}
    />
  );
  await new Promise<void>(resolve => {
    requestAnimationFrame((): void => {
      resolve();
    });
  });
});
const renderMs = performance.now() - started;
const mountedHunks = host.querySelectorAll('.sc-virtual-hunk').length;

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, '../components/workflows/source-control/file-viewer.tsx')],
  target: 'browser',
  minify: true,
  metafile: true,
  write: false,
} as Parameters<typeof Bun.build>[0]);
const bundleBytes = build.outputs.reduce((sum, output) => sum + output.size, 0);
const lodashInputBytes = Object.entries(build.metafile?.inputs ?? {})
  .filter(([path]) => path.includes('node_modules/lodash/'))
  .reduce((sum, [, input]) => sum + input.bytes, 0);

const report = {
  fixtureBytes,
  renderMs,
  mountedHunks,
  totalHunks,
  bundleBytes,
  lodashInputBytes,
};
console.log(JSON.stringify(report));

await act(async (): Promise<void> => {
  root.unmount();
});
win.close();

if (
  !build.success ||
  fixtureBytes < 2_097_152 ||
  renderMs >= 1000 ||
  mountedHunks <= 0 ||
  mountedHunks >= totalHunks ||
  lodashInputBytes <= 0
) {
  process.exitCode = 1;
}
