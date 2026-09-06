import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StdoutRoom } from './StdoutRoom';

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('StdoutRoom', () => {
  test('renders captured stdout and the successful exit status in one labelled room', () => {
    const markup = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: 'hello\nworld',
          status: 'completed',
          exitCode: 0,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    expect(markup).toContain('aria-label="setup room"');
    expect(markup).toContain('hello\nworld');
    expect(markup).toContain('font-mono');
    expect(markup).toContain('bg-surface-inset');
    expect(markup).toContain('Exit status: 0');
    expect(markup).not.toContain('chat-markdown');
  });

  test('distinguishes an empty successful output from missing output', () => {
    const emptySuccess = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: '',
          status: 'completed',
          exitCode: 0,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    const missing = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: null,
          status: 'running',
          exitCode: null,
          truncated: false,
          originalBytes: null,
          failedDetail: null,
        }}
      />
    );
    expect(emptySuccess).toContain('<pre');
    expect(visibleText(emptySuccess)).not.toContain("Node hasn't produced output");
    expect(visibleText(missing)).toContain("Node hasn't produced output");
  });

  test('renders truncation and failure details without inventing an exit code', () => {
    const truncated = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: 'cut',
          status: 'completed',
          exitCode: 0,
          truncated: true,
          originalBytes: 40000,
          failedDetail: null,
        }}
      />
    );
    const failed = renderToStaticMarkup(
      <StdoutRoom
        nodeId="setup"
        stdout={{
          text: null,
          status: 'failed',
          exitCode: null,
          truncated: false,
          originalBytes: null,
          failedDetail: 'Bash node failed',
        }}
      />
    );
    expect(truncated).toContain('Output truncated from 40000 bytes');
    expect(failed).toContain('Bash node failed');
    expect(failed).not.toContain('Exit status:');
  });
});
