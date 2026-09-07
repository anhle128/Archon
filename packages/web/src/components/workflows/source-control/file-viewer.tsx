import type { ReactElement } from 'react';
import { RefreshCw, X } from 'lucide-react';

import type { GitChangedFile, GitEmptyReason, GitReadyDiffResponse } from '@/lib/api';

import { InlineImage } from './inline-image';
import { StatusBadge } from './status-badge';
import { highlightedHtml } from './syntax-highlight';
import { DiffPanes } from './virtualized-diff';
import './source-control-diff.css';

export type FileViewerState =
  | { kind: 'idle' }
  | { kind: 'loading'; file: GitChangedFile }
  | {
      kind: 'diff';
      file: GitChangedFile;
      response: GitReadyDiffResponse;
      reloadFingerprint: string;
    }
  | {
      kind: 'text';
      file: GitChangedFile;
      text: string;
      contentHash: string;
      truncated: boolean;
      cursor: string;
    }
  | {
      kind: 'image';
      file: GitChangedFile;
      contentHash: string;
      bytes: Uint8Array;
      mediaType: string;
      downloadHref: string;
    }
  | {
      kind: 'hex';
      file: GitChangedFile;
      contentHash: string;
      hex: string;
      downloadHref: string;
    }
  | {
      kind: 'download';
      file: GitChangedFile;
      contentHash: string;
      downloadHref: string;
    }
  | { kind: 'unavailable'; file: GitChangedFile; emptyReason: GitEmptyReason }
  | { kind: 'error'; file: GitChangedFile };

export interface FileViewerProps {
  state: FileViewerState;
  stacked: boolean;
  loadingMore?: boolean;
  stale?: boolean;
  onCancel: () => void;
  onReload: () => void;
  onClose: () => void;
  onAcceptPending?: () => void;
  onLoadMore?: () => void;
}

const ICON_BUTTON_CLASS =
  'inline-flex size-[26px] items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary';
const GHOST_SMALL_CLASS =
  'rounded-sm px-2.5 py-1 text-[0.75rem] font-medium transition-colors hover:bg-surface-hover hover:text-text-primary';

const SKELETON_WIDTHS = [
  '88%',
  '96%',
  '72%',
  '94%',
  '81%',
  '99%',
  '64%',
  '90%',
  '77%',
  '85%',
  '58%',
  '92%',
];

function fileFromState(state: FileViewerState): GitChangedFile | null {
  return state.kind === 'idle' ? null : state.file;
}

function canLoadMore(state: FileViewerState): boolean {
  if (state.kind === 'text') return state.truncated && state.cursor !== '';
  if (state.kind === 'diff') return state.response.truncated && state.response.cursor !== '';
  return false;
}

function DownloadLink(props: { href: string }): ReactElement {
  return (
    <a
      href={props.href}
      className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[0.75rem] font-medium text-text-primary transition-colors hover:bg-surface-hover"
    >
      Download
    </a>
  );
}

function ViewerBody(props: {
  state: FileViewerState;
  stacked: boolean;
  onCancel: () => void;
}): ReactElement {
  const { state } = props;
  switch (state.kind) {
    case 'idle':
      return (
        <div className="flex flex-1 items-center justify-center">
          <p role="status" className="text-[0.8125rem] text-text-tertiary">
            Select a file to view
          </p>
        </div>
      );
    case 'loading':
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading file"
          className="flex-1 px-5 py-4"
        >
          {SKELETON_WIDTHS.map(width => (
            <div
              key={width}
              className="mb-3 h-2.5 animate-pulse rounded-sm bg-surface-elevated"
              style={{ width }}
            />
          ))}
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={props.onCancel}
              className="rounded-md px-3 py-1.5 text-[0.8125rem] font-medium text-text-primary transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    case 'diff':
      return <DiffPanes response={state.response} stacked={props.stacked} />;
    case 'text':
      return (
        <pre className="sc-mono-content min-h-0 min-w-0 flex-1 overflow-auto px-4 py-2">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml(state.text) }}
          />
        </pre>
      );
    case 'image':
      return (
        <div className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto px-4 py-3.5">
          <InlineImage bytes={state.bytes} mediaType={state.mediaType} />
          <DownloadLink href={state.downloadHref} />
        </div>
      );
    case 'hex':
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <p className="px-4 pt-3.5 text-[0.75rem] text-text-tertiary">
            Binary file — hex peek of the first 4 KB
          </p>
          <pre className="sc-mono-content min-w-0 overflow-auto px-4 pt-3 pb-1 text-text-secondary">
            <code>{state.hex}</code>
          </pre>
          <div className="px-4 pt-3 pb-[18px]">
            <DownloadLink href={state.downloadHref} />
          </div>
        </div>
      );
    case 'download':
      return (
        <div className="flex flex-col items-start gap-3 px-4 py-3.5">
          <p className="text-[0.8125rem] text-text-secondary">
            This file is too large to open here.
          </p>
          <DownloadLink href={state.downloadHref} />
        </div>
      );
    case 'unavailable':
      return (
        <p className="px-4 py-3.5 text-[0.8125rem] text-text-secondary">
          {state.emptyReason === 'no_checkout'
            ? "This run's checkout isn't available right now."
            : "This run's files aren't available on the host."}
        </p>
      );
    case 'error':
      return (
        <p className="px-4 py-3.5 text-[0.8125rem] text-text-secondary">
          Could not open this file.
        </p>
      );
  }
}

export function FileViewer(props: FileViewerProps): ReactElement {
  const file = fileFromState(props.state);
  const loadingMore = props.loadingMore === true;
  const showStreamFooter =
    (canLoadMore(props.state) && props.onLoadMore !== undefined) || loadingMore;
  const showReload = !(
    props.state.kind === 'unavailable' && props.state.emptyReason === 'container'
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {file ? (
          <>
            <span
              className="min-w-0 truncate font-mono text-[0.75rem] text-text-secondary"
              title={file.path}
            >
              {file.path}
            </span>
            <StatusBadge status={file.status} />
          </>
        ) : (
          <span className="text-[0.75rem] text-text-tertiary">No file selected</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {showReload ? (
            <button
              type="button"
              onClick={props.onReload}
              aria-label="Reload"
              title="Reload"
              className={ICON_BUTTON_CLASS}
            >
              <RefreshCw className="size-3.5" />
            </button>
          ) : null}
          {file ? (
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close"
              title="Close"
              className={ICON_BUTTON_CLASS}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {props.stale === true && props.onAcceptPending !== undefined ? (
        <div className="flex shrink-0 border-b border-border bg-warning/10 px-3 py-1.5">
          <button
            type="button"
            onClick={props.onAcceptPending}
            className={`${GHOST_SMALL_CLASS} text-text-primary`}
          >
            Changed on disk — Reload
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewerBody state={props.state} stacked={props.stacked} onCancel={props.onCancel} />
      </div>

      {showStreamFooter ? (
        <div className="flex shrink-0 items-center justify-center gap-3 px-4 pt-3 pb-[18px]">
          {loadingMore ? (
            <button
              type="button"
              onClick={props.onCancel}
              className={`${GHOST_SMALL_CLASS} text-text-primary`}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onLoadMore}
              className={`${GHOST_SMALL_CLASS} text-text-secondary`}
            >
              Load more
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
