import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DagRunTabs } from './dag-run-tabs';

function render(parentPlatformId: string | null): string {
  return renderToStaticMarkup(
    <DagRunTabs
      activeView="graph"
      parentPlatformId={parentPlatformId}
      onValueChange={(): void => undefined}
    />
  );
}

describe('DagRunTabs', () => {
  test('renders Source Control after the existing Graph, Logs, and Chat tabs', () => {
    const html = render('parent-1');
    expect(html.indexOf('Graph')).toBeLessThan(html.indexOf('Logs'));
    expect(html.indexOf('Logs')).toBeLessThan(html.indexOf('Chat'));
    expect(html.indexOf('Chat')).toBeLessThan(html.indexOf('Source Control'));
    expect(html.indexOf('Source Control')).toBeLessThan(html.indexOf('Terminal'));
  });

  test('keeps Chat visible when parentPlatformId is null', () => {
    const html = render(null);
    expect(html).toContain('Graph');
    expect(html).toContain('Logs');
    expect(html).toContain('Chat');
    expect(html).toContain('Source Control');
    expect(html).toContain('Terminal');
    expect(html.indexOf('Graph')).toBeLessThan(html.indexOf('Logs'));
    expect(html.indexOf('Logs')).toBeLessThan(html.indexOf('Chat'));
    expect(html.indexOf('Chat')).toBeLessThan(html.indexOf('Source Control'));
    expect(html.indexOf('Source Control')).toBeLessThan(html.indexOf('Terminal'));
  });
});
