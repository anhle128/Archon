import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TerminalTab } from './terminal-tab';

describe('TerminalTab', () => {
  test('renders an accessible region, mount host, and Close terminal button', () => {
    const html = renderToStaticMarkup(<TerminalTab runId="run-1" />);
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Run terminal"');
    expect(html.match(/role="region"/g)).toHaveLength(1);
    expect(html).toContain('Close terminal');
    expect(html).toContain('Connecting…');
    expect(html).toContain('h-full w-full');
    expect(html).toContain('bg-surface-inset');
    expect(html).toContain('absolute inset-0');
  });
});
