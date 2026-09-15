import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { formatStarted } from '@/lib/format';

import type { ChatTimelineEntry } from './build-chat-timeline';
import { ChatTimeline, type ChatTimelineProps } from './ChatTimeline';
import type { NodeBodyKind } from './resolve-room-kind';

const NOOP = (): void => undefined;

const ENTRIES: readonly ChatTimelineEntry[] = [
  {
    kind: 'user',
    id: 'message-1',
    createdAt: '2026-09-06T00:00:00.000Z',
    content: '<strong>operator text</strong>',
  },
  {
    kind: 'node_status',
    id: 'start-review',
    createdAt: '2026-09-06T00:00:01.000Z',
    nodeId: 'review',
    label: 'Review',
    nodeType: 'command',
    status: 'running',
    detail: 'started',
    selection: { kind: 'node' },
  },
  {
    kind: 'node_status',
    id: 'complete-review',
    createdAt: '2026-09-06T00:00:02.000Z',
    nodeId: 'review',
    label: 'Review',
    nodeType: 'command',
    status: 'completed',
    detail: 'completed',
    selection: { kind: 'node' },
  },
];

function renderTimeline(overrides: Partial<ChatTimelineProps> = {}): string {
  return renderToStaticMarkup(
    <ChatTimeline
      entries={overrides.entries ?? []}
      selectedEntryId={overrides.selectedEntryId ?? null}
      onSelectNodeStatus={overrides.onSelectNodeStatus ?? NOOP}
      loading={overrides.loading ?? false}
      error={overrides.error ?? null}
      renderAsk={overrides.renderAsk}
      renderGate={overrides.renderGate}
    />
  );
}

function firstButton(markup: string): string {
  const match = /<button\b[\s\S]*?<\/button>/.exec(markup);
  if (match === null) throw new Error('expected a button');
  return match[0];
}

describe('ChatTimeline', () => {
  test('root has aria-label="Run chat timeline"', () => {
    const markup = renderTimeline();
    expect(markup).toContain('aria-label="Run chat timeline"');
    expect(markup).toContain('class="flex h-full min-h-0 flex-col overflow-auto p-3"');
  });

  test('empty non-loading markup contains the empty copy', () => {
    const markup = renderTimeline();
    expect(markup).toContain('No conversation turns or node-status entries yet.');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('Loading conversation turns…');
  });

  test('loading with empty entries shows loading copy and no node-status button', () => {
    const markup = renderTimeline({ loading: true });
    expect(markup).toContain('Loading conversation turns…');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('No conversation turns or node-status entries yet.');
  });

  test('a non-null error is visible even when entries exist', () => {
    const markup = renderTimeline({
      entries: ENTRIES,
      error: 'Failed to load conversation',
    });
    expect(markup).toContain('class="text-error"');
    expect(markup).toContain('Failed to load conversation');
    expect(markup).toContain('<button type="button"');
  });

  test('a user entry renders escaped plain text and is not a button', () => {
    const markup = renderTimeline({
      entries: [ENTRIES[0]],
    });
    expect(markup).toContain('&lt;strong&gt;operator text&lt;/strong&gt;');
    expect(markup).not.toContain('<strong>operator text</strong>');
    expect(markup).toContain(
      'class="ml-auto max-w-[80%] rounded-lg bg-accent/20 px-3 py-2 text-sm text-text-primary whitespace-pre-wrap"'
    );
    expect(markup).not.toContain('<button');
  });

  test('a node-status entry renders a button with glyph, label, detail, status, timestamp, and chevron', () => {
    const entry = ENTRIES[1];
    const markup = renderTimeline({ entries: [entry] });
    const button = firstButton(markup);
    expect(button).toContain('type="button"');
    const iconAt = button.indexOf('lucide-zap');
    const labelAt = button.indexOf('Review');
    const detailAt = button.indexOf('started');
    const statusAt = button.indexOf('running');
    const timeAt = button.indexOf(formatStarted(entry.createdAt));
    const chevronAt = button.indexOf('lucide-chevron-right');
    expect(iconAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(iconAt);
    expect(detailAt).toBeGreaterThan(labelAt);
    expect(statusAt).toBeGreaterThan(detailAt);
    expect(timeAt).toBeGreaterThan(statusAt);
    expect(chevronAt).toBeGreaterThan(timeAt);
    expect(button).toContain('aria-hidden="true"');
    expect(button).toContain('h-3.5 w-3.5 shrink-0 text-text-tertiary');
    expect(button).toContain('h-3 w-3 text-text-tertiary');
    expect(button).toContain('bg-accent/20 text-accent');
  });

  test('marks the exact clicked lifecycle entry rather than the room row id', () => {
    const markup = renderToStaticMarkup(
      <ChatTimeline
        entries={ENTRIES}
        selectedEntryId="complete-review"
        onSelectNodeStatus={(): void => undefined}
        loading={false}
        error={null}
      />
    );
    const selected = /<button\b[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/.exec(markup);
    expect(selected?.[0]).toContain('completed');
    expect(markup.split('aria-current="true"')).toHaveLength(2);
    expect(markup).toContain('&lt;strong&gt;operator text&lt;/strong&gt;');
    expect(markup).not.toContain('<strong>operator text</strong>');
  });

  test('contains no AskHuman, awaiting, composer, or form chrome', () => {
    const markup = renderTimeline({ entries: ENTRIES, selectedEntryId: 'start-review' });
    expect(markup).not.toContain('AskHuman');
    expect(markup).not.toContain('awaiting');
    expect(markup).not.toContain('waiting-on-you');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('placeholder="Message');
    expect(markup).not.toContain('Send');
  });

  test('maps each node type to the specified lucide glyph', () => {
    const glyphs: readonly (readonly [NodeBodyKind, string])[] = [
      ['command', 'lucide-zap'],
      ['prompt', 'lucide-file-text'],
      ['loop', 'lucide-refresh-cw'],
      ['bash', 'lucide-terminal'],
      ['script', 'lucide-terminal'],
      ['approval', 'lucide-eye'],
      ['plannotator_gate', 'lucide-eye'],
      ['workflow', 'lucide-workflow'],
      ['route_loop', 'lucide-git-branch'],
      ['loop_group', 'lucide-box'],
      ['unknown', 'lucide-bot'],
    ];
    for (const [nodeType, glyph] of glyphs) {
      const markup = renderTimeline({
        entries: [
          {
            kind: 'node_status',
            id: `node-${nodeType}`,
            createdAt: '2026-09-06T00:00:01.000Z',
            nodeId: nodeType,
            label: nodeType,
            nodeType,
            status: 'pending',
            detail: 'pending',
            selection: { kind: 'node' },
          },
        ],
      });
      expect(firstButton(markup)).toContain(glyph);
    }
  });

  test('renders Ask and gate entries with unscoped limitation copy', () => {
    const markup = renderTimeline({
      entries: [
        {
          kind: 'ask',
          id: 'ask-1',
          createdAt: '2026-09-06T00:00:02.000Z',
          interaction: {
            id: 'ask-1',
            workflow_run_id: 'run-1',
            node_id: 'review',
            tool_use_id: 'tool-ask',
            kind: 'ask',
            status: 'pending',
            envelope: {},
            answer: null,
            provider_session_id: 'sess-1',
            created_at: '2026-09-06T00:00:02.000Z',
            resolved_at: null,
            resolved_by: null,
          },
          rowId: 'row-2',
          scopeLimitation: 'Execution scope was not recorded for this interaction.',
        },
        {
          kind: 'gate',
          id: 'gate-1',
          createdAt: '2026-09-06T00:00:03.000Z',
          nodeId: 'review',
          rowId: 'row-2',
          scopeLimitation: 'Execution scope was not recorded for this interaction.',
        },
      ],
      renderAsk: (): string => 'ask-slot',
      renderGate: (): string => 'gate-slot',
    });
    expect(markup).toContain('Execution scope was not recorded for this interaction.');
    expect(markup).toContain('ask-slot');
    expect(markup).toContain('gate-slot');
  });
});
