import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunChatComposer, type RunChatComposerProps } from './RunChatComposer';

function renderComposer(overrides: Partial<RunChatComposerProps> = {}): string {
  return renderToStaticMarkup(
    <RunChatComposer
      value="ship it"
      onValueChange={(): void => undefined}
      onSubmit={(): void => undefined}
      sending={false}
      disabledReason={null}
      error={null}
      {...overrides}
    />
  );
}

describe('RunChatComposer', () => {
  test('renders one regular conversation form and no Ask controls', () => {
    const markup = renderComposer();
    expect(markup).toContain('aria-label="Run conversation composer"');
    expect(markup).toContain('aria-label="Message the run conversation"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Send');
    expect(markup).toContain('Message the run');
    expect(markup).toContain('conversation');
    expect(markup).not.toContain('AskHuman');
    expect(markup).not.toContain('Decline');
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain('EventSource');
    expect(markup).not.toContain('pending interaction');
    expect(markup).not.toContain('SSE');
  });

  test('disables input and submit with the established non-Web explanation', () => {
    const reason = 'Continuing chats from other platforms in the Web UI is coming soon';
    const markup = renderComposer({ disabledReason: reason });
    expect(markup.split('disabled=""')).toHaveLength(3);
    expect(markup).toContain(`placeholder="${reason}"`);
    expect(markup).toContain(`title="${reason}"`);
  });

  test('disables both controls while sending', () => {
    const markup = renderComposer({ sending: true });
    expect(markup.split('disabled=""')).toHaveLength(3);
    expect(markup).toContain('Sending…');
    expect(markup).toContain('Message the run');
  });

  test('renders a text-error alert when error is non-null', () => {
    const markup = renderComposer({ error: 'Send failed' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('class="mb-2 text-xs text-error"');
    expect(markup).toContain('Send failed');
  });

  test('disables submit when the draft is blank', () => {
    const markup = renderComposer({ value: '   ' });
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('<textarea');
    expect(markup.indexOf('disabled=""')).toBeGreaterThan(markup.indexOf('type="submit"'));
  });

  test('shows the factual disabled copy when the run has no parent conversation', () => {
    const reason = 'This run has no parent conversation, so replies cannot be delivered.';
    const markup = renderComposer({ disabledReason: reason, value: '' });
    expect(markup.split('disabled=""')).toHaveLength(3);
    expect(markup).toContain(`placeholder="${reason}"`);
    expect(markup).toContain(`title="${reason}"`);
  });
});
