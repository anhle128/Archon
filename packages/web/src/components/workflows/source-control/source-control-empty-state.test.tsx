import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { displayedEmptyReason, SourceControlEmptyState } from './source-control-empty-state';

type EmptyStateProps = ComponentProps<typeof SourceControlEmptyState>;

function renderEmptyState(overrides: Partial<EmptyStateProps> = {}): string {
  return renderToStaticMarkup(
    <SourceControlEmptyState
      reason="no_checkout"
      stale={false}
      refreshFailed={false}
      onReload={(): void => undefined}
      onAcceptPending={(): void => undefined}
      {...overrides}
    />
  );
}

describe('displayedEmptyReason', () => {
  const ready = { files: [], revision: 'a'.repeat(64) };
  const readyLog = { commits: [], revision: 'a'.repeat(64), truncated: false };

  test('returns undefined when every snapshot is ready', () => {
    expect(displayedEmptyReason(ready, readyLog, null)).toBeUndefined();
    expect(displayedEmptyReason(null, null, null)).toBeUndefined();
  });

  test('prefers container over no_checkout across snapshots', () => {
    expect(
      displayedEmptyReason(
        { emptyReason: 'no_checkout', files: [], revision: '' },
        { emptyReason: 'container', commits: [], revision: '', truncated: false },
        null
      )
    ).toBe('container');
  });

  test('surfaces no_checkout from any snapshot', () => {
    expect(
      displayedEmptyReason(ready, readyLog, { emptyReason: 'no_checkout', files: [], revision: '' })
    ).toBe('no_checkout');
  });
});

describe('SourceControlEmptyState', () => {
  test('shows container copy with no Reload control', () => {
    const html = renderEmptyState({ reason: 'container' });
    expect(html).toContain('No files to show');
    expect(html).toContain(
      'This run executed inside a container — its working files aren&#x27;t on the host to read.'
    );
    expect(html).not.toContain('>Reload<');
  });

  test('shows no_checkout copy with Reload', () => {
    const html = renderEmptyState({ reason: 'no_checkout' });
    expect(html).toContain('No files to show');
    expect(html).toContain('it may have been cleaned up.');
    expect(html).toContain('>Reload<');
  });

  test('offers the stale accept action when changes are pending', () => {
    const html = renderEmptyState({ reason: 'no_checkout', stale: true });
    expect(html).toContain('>Changed on disk — Reload<');
  });

  test('surfaces a refresh failure alongside the retry', () => {
    const html = renderEmptyState({ reason: 'no_checkout', refreshFailed: true });
    expect(html).toContain('Could not refresh source control.');
    expect(html).toContain('>Reload<');
  });
});
