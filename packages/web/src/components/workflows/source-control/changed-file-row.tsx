import type { PointerEvent, ReactElement } from 'react';

import type { GitChangedFile } from '@/lib/api';

import { FileGlyph, splitGitPath } from './file-glyph';
import { StatusBadge } from './status-badge';

export function ChangedFileRow(props: {
  file: GitChangedFile;
  id: string;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}): ReactElement {
  const { name, directory } = splitGitPath(props.file.path);
  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      id={props.id}
      aria-label={props.file.path}
      aria-selected={props.selected}
      data-active={props.active ? 'true' : 'false'}
      title={props.file.path}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>): void => {
        event.preventDefault();
      }}
      onClick={props.onSelect}
      className={`flex h-8 w-full items-center gap-2 text-left text-[0.8125rem] ${
        props.compact === true ? 'pr-3 pl-2' : 'px-3'
      } ${
        props.active
          ? 'bg-surface-elevated'
          : props.selected
            ? 'bg-surface-hover'
            : 'hover:bg-surface-hover'
      }`}
    >
      <span className="sr-only">{props.file.path}</span>
      <FileGlyph path={props.file.path} />
      <span className="shrink-0 text-text-primary">{name}</span>
      {directory !== null ? (
        <span className="min-w-0 flex-1 truncate text-[0.75rem] text-text-tertiary">
          {directory}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <StatusBadge status={props.file.status} />
    </button>
  );
}
