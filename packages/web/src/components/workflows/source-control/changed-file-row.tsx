import type { PointerEvent, ReactElement } from 'react';

import type { GitChangedFile } from '@/lib/api';

import { StatusBadge } from './status-badge';

export function ChangedFileRow(props: {
  file: GitChangedFile;
  id: string;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      id={props.id}
      aria-selected={props.selected}
      data-active={props.active ? 'true' : 'false'}
      title={props.file.path}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>): void => {
        event.preventDefault();
      }}
      onClick={props.onSelect}
      className={`flex h-8 w-full items-center gap-2 px-3 text-left text-[0.8125rem] text-text-primary ${
        props.active
          ? 'bg-surface-elevated'
          : props.selected
            ? 'bg-surface-hover'
            : 'hover:bg-surface-hover'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{props.file.path}</span>
      <StatusBadge status={props.file.status} />
    </button>
  );
}
