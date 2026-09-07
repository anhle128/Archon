import { useRef, type KeyboardEvent, type ReactElement, type Ref } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { GitChangedFile } from '@/lib/api';

import { ChangedFileRow } from './changed-file-row';

export function nextChangedFileIndex(key: string, currentIndex: number, fileCount: number): number {
  if (fileCount <= 0) return 0;
  if (key === 'ArrowDown') return Math.min(fileCount - 1, currentIndex + 1);
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return fileCount - 1;
  return Math.min(fileCount - 1, Math.max(0, currentIndex));
}

function estimateChangedFileSize(): number {
  return 32;
}

export interface ChangedFilesListProps {
  files: readonly GitChangedFile[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  selectedPath?: string | null;
  onOpenFile?: (file: GitChangedFile) => void;
  ariaLabel?: string;
  idPrefix?: string;
  listRef?: Ref<HTMLDivElement | null>;
}

export function ChangedFilesList(props: ChangedFilesListProps): ReactElement {
  const ariaLabel = props.ariaLabel ?? 'Uncommitted changes';
  const idPrefix = props.idPrefix ?? 'sc-changes-file';
  const selectedPath = props.selectedPath ?? null;
  const parentRef = useRef<HTMLDivElement | null>(null);

  const assignListRef = (node: HTMLDivElement | null): void => {
    parentRef.current = node;
    if (typeof props.listRef === 'function') {
      props.listRef(node);
    } else if (props.listRef) {
      props.listRef.current = node;
    }
  };

  const virtualizer = useVirtualizer({
    count: props.files.length,
    getScrollElement: (): HTMLDivElement | null => parentRef.current,
    estimateSize: estimateChangedFileSize,
    initialRect: { width: 0, height: 280 },
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const virtualized = virtualItems.length > 0;
  const mountedIndexes = virtualized
    ? new Set(virtualItems.map(item => item.index))
    : new Set(props.files.map((_, index) => index));
  const activeDescendant = mountedIndexes.has(props.activeIndex)
    ? `${idPrefix}-${String(props.activeIndex)}`
    : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const nextIndex = nextChangedFileIndex(event.key, props.activeIndex, props.files.length);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      props.onActiveIndexChange(nextIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const file = props.files[props.activeIndex];
      if (file) props.onOpenFile?.(file);
    }
  };

  const renderRow = (file: GitChangedFile, index: number): ReactElement => (
    <ChangedFileRow
      key={`${file.status}:${file.path}`}
      id={`${idPrefix}-${String(index)}`}
      file={file}
      active={index === props.activeIndex}
      selected={file.path === selectedPath}
      onSelect={(): void => {
        parentRef.current?.focus();
        props.onActiveIndexChange(index);
        props.onOpenFile?.(file);
      }}
    />
  );

  return (
    <div
      ref={assignListRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activeDescendant}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto"
    >
      {virtualized ? (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {virtualItems.map(virtualItem => {
            const file = props.files[virtualItem.index];
            if (!file) return null;
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${String(virtualItem.start)}px)`,
                }}
              >
                {renderRow(file, virtualItem.index)}
              </div>
            );
          })}
        </div>
      ) : (
        props.files.map((file, index) => renderRow(file, index))
      )}
    </div>
  );
}
