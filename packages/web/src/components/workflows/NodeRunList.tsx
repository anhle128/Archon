import { cn } from '@/lib/utils';

import type { LogRow } from './build-log-rows';

export interface NodeRunListProps {
  rows: readonly LogRow[];
  selectedRowId: string | null;
  onSelect: (row: LogRow) => void;
}

const STATUS_COLORS: Record<LogRow['status'], string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  awaiting: 'bg-accent/20 text-accent',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};

export function NodeRunList({
  rows,
  selectedRowId,
  onSelect,
}: NodeRunListProps): React.ReactElement {
  return (
    <nav aria-label="Node runs" className="flex min-h-0 w-56 shrink-0 flex-col overflow-y-auto">
      {rows.map(row => {
        const selected = row.id === selectedRowId;
        return (
          <button
            key={row.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
              selected ? 'bg-accent/10' : 'hover:bg-surface-hover'
            )}
            onClick={(): void => {
              onSelect(row);
            }}
          >
            <span className="truncate text-text-primary">{row.label}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[row.status]
              )}
            >
              {row.status}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
