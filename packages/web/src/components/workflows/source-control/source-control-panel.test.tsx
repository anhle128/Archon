import { describe, expect, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { nextChangedFileIndex, SourceControlPanel } from './source-control-panel';

type PanelProps = ComponentProps<typeof SourceControlPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}): string {
  return renderToStaticMarkup(
    <SourceControlPanel
      snapshot={null}
      loadState="idle"
      stale={false}
      onReload={(): void => undefined}
      onAcceptPending={(): void => undefined}
      {...overrides}
    />
  );
}

describe('SourceControlPanel', () => {
  test('renders M/A/D as letter-carried options and no write or History chrome', () => {
    const html = renderPanel({
      snapshot: {
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'new.ts', status: 'A' },
          { path: 'gone.ts', status: 'D' },
        ],
        revision: 'a'.repeat(64),
      },
    });

    expect(html).toContain('Changes');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-activedescendant="sc-changes-file-0"');
    expect(html).toContain('>M<');
    expect(html).toContain('>A<');
    expect(html).toContain('>D<');
    expect(html).not.toContain('History');
    expect(html).not.toContain('Stage');
    expect(html).not.toContain('Discard');
    expect(html).not.toContain('Commit');
  });

  test('shows explicit loading without flashing the clean-worktree copy', () => {
    const html = renderPanel({ snapshot: null, loadState: 'loading' });
    expect(html).toContain('Loading changes');
    expect(html).not.toContain('No uncommitted changes');
  });

  test('shows the clean-worktree region message only after a ready snapshot', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
    });
    expect(html).toContain('No uncommitted changes');
    expect(html).not.toContain('No worktree available');
  });

  test('shows container copy with no Reload control', () => {
    const html = renderPanel({
      snapshot: { emptyReason: 'container', files: [], revision: '' },
    });
    expect(html).toContain('No files to show');
    expect(html).toContain(
      'This run executed inside a container — its working files aren&#x27;t on the host to read.'
    );
    expect(html).not.toContain('>Reload<');
  });

  test('shows no_checkout copy with Reload', () => {
    const html = renderPanel({
      snapshot: { emptyReason: 'no_checkout', files: [], revision: '' },
    });
    expect(html).toContain('No worktree available');
    expect(html).toContain(
      'This run&#x27;s checkout isn&#x27;t available or readable right now — it may not be ready yet, or it may have been cleaned up.'
    );
    expect(html).toContain('>Reload<');
  });

  test('keeps a previous list during an in-region refresh error', () => {
    const html = renderPanel({
      snapshot: {
        files: [{ path: 'keep.ts', status: 'M' }],
        revision: 'a'.repeat(64),
      },
      loadState: 'error',
    });
    expect(html).toContain('keep.ts');
    expect(html).toContain('Could not refresh changes.');
    expect(html).toContain('>Reload<');
    expect(html).not.toContain('Error:');
    expect(html).not.toContain('unsupported');
    expect(html).not.toContain('⚠️');
  });

  test('renders divergence as a clickable quiet reload affordance', () => {
    const html = renderPanel({
      snapshot: { files: [], revision: 'a'.repeat(64) },
      stale: true,
    });
    expect(html).toContain('>Changed on disk — Reload<');
  });

  test('moves the active descendant with Arrow, Home, and End keys', () => {
    expect(nextChangedFileIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextChangedFileIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextChangedFileIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextChangedFileIndex('Home', 2, 3)).toBe(0);
    expect(nextChangedFileIndex('End', 0, 3)).toBe(2);
    expect(nextChangedFileIndex('Enter', 1, 3)).toBe(1);
  });

  test('applies caller ariaLabel and idPrefix to the listbox and option IDs', () => {
    const html = renderPanel({
      snapshot: {
        files: [{ path: 'src/a.ts', status: 'M' }],
        revision: 'a'.repeat(64),
      },
      ariaLabel: 'History files',
      idPrefix: 'sc-history-file',
    });

    expect(html).toContain('aria-label="History files"');
    expect(html).toContain('id="sc-history-file-0"');
    expect(html).toContain('aria-activedescendant="sc-history-file-0"');
  });

  test('uses aria-selected for the opened file and data-active for keyboard focus', () => {
    const html = renderPanel({
      snapshot: {
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'new.ts', status: 'A' },
        ],
        revision: 'a'.repeat(64),
      },
      selectedPath: 'new.ts',
    });

    const activeStart = html.indexOf('id="sc-changes-file-0"');
    const selectedStart = html.indexOf('id="sc-changes-file-1"');
    const activeOption = html.slice(activeStart, html.indexOf('</button>', activeStart));
    const selectedOption = html.slice(selectedStart, html.indexOf('</button>', selectedStart));

    expect(html).toContain('aria-activedescendant="sc-changes-file-0"');
    expect(activeOption).toContain('data-active="true"');
    expect(activeOption).toContain('aria-selected="false"');
    expect(selectedOption).toContain('data-active="false"');
    expect(selectedOption).toContain('aria-selected="true"');
  });
});
