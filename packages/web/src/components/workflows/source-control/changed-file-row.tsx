import type { ReactElement } from 'react';

import type { GitChangedFile } from '@/lib/api';

export function ChangedFileRow(props: {
  file: GitChangedFile;
  id: string;
  active: boolean;
}): ReactElement {
  const statusLabel =
    props.file.status === 'M'
      ? 'M, modified'
      : props.file.status === 'A'
        ? 'A, added'
        : 'D, deleted';

  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.active}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        props.active ? 'bg-surface-elevated' : 'hover:bg-surface-hover'
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{props.file.path}</span>
      <span
        aria-label={statusLabel}
        className="shrink-0 rounded bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium text-text-primary"
      >
        {props.file.status}
      </span>
    </div>
  );
}
