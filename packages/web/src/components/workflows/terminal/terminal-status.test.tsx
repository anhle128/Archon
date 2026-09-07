import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { TerminalClientState } from './client';
import { TerminalStatus } from './terminal-status';

function render(state: TerminalClientState): string {
  return renderToStaticMarkup(<TerminalStatus state={state} />);
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusText(state: TerminalClientState): string {
  const html = render(state);
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  return visibleText(html);
}

describe('TerminalStatus', () => {
  test('renders connecting, connected, and reconnecting copy', () => {
    expect(statusText({ kind: 'connecting' })).toBe('Connecting…');
    expect(statusText({ kind: 'connected' })).toBe('Connected');
    expect(statusText({ kind: 'reconnecting' })).toBe('Reconnecting…');
  });

  test('renders locked unavailable copy', () => {
    expect(
      statusText({
        kind: 'unavailable',
        message:
          "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up.",
      })
    ).toBe(
      "This run's checkout isn't available — it may not be ready yet, or it may have been cleaned up."
    );
    expect(
      statusText({
        kind: 'unavailable',
        message: "This run's container isn't available — it may have been stopped or cleaned up.",
      })
    ).toBe("This run's container isn't available — it may have been stopped or cleaned up.");
    expect(
      statusText({
        kind: 'unavailable',
        message: 'This run uses an isolation provider the terminal cannot open.',
      })
    ).toBe('This run uses an isolation provider the terminal cannot open.');
  });

  test('renders exit codes, signals, and a bare exit', () => {
    expect(statusText({ kind: 'exited', code: 1, signal: null })).toBe(
      'Terminal exited with code 1.'
    );
    expect(statusText({ kind: 'exited', code: null, signal: 'SIGTERM' })).toBe(
      'Terminal exited after SIGTERM.'
    );
    expect(statusText({ kind: 'exited', code: null, signal: null })).toBe('Terminal exited.');
  });

  test('renders closed, generic error, and replaced-tab error copy', () => {
    expect(statusText({ kind: 'closed' })).toBe('Terminal closed.');
    expect(statusText({ kind: 'error', message: 'Terminal connection failed.' })).toBe(
      'Terminal connection failed.'
    );
    expect(statusText({ kind: 'error', message: 'Terminal opened in another tab.' })).toBe(
      'Terminal opened in another tab.'
    );
  });
});
