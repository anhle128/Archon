import type { ReactElement } from 'react';

import type { GitChangedFile, GitEmptyReason, GitReadyDiffResponse } from '@/lib/api';

import { InlineImage } from './inline-image';
import { highlightedHtml } from './syntax-highlight';
import { DiffPanes } from './virtualized-diff';

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
  onCancel: () => void;
  onReload: () => void;
  onClose: () => void;
  onLoadMore?: () => void;
}

const ACTION_CLASS = 'text-xs text-primary transition-colors hover:text-accent-bright';

function fileFromState(state: FileViewerState): GitChangedFile | null {
  return state.kind === 'idle' ? null : state.file;
}

function showsReload(state: FileViewerState): boolean {
  return (
    state.kind === 'error' || (state.kind === 'unavailable' && state.emptyReason === 'no_checkout')
  );
}

function canLoadMore(state: FileViewerState): boolean {
  if (state.kind === 'text') return state.truncated && state.cursor !== '';
  if (state.kind === 'diff') return state.response.truncated && state.response.cursor !== '';
  return false;
}

function DownloadLink(props: { href: string }): ReactElement {
  return (
    <a href={props.href} className={ACTION_CLASS}>
      Download
    </a>
  );
}

function ViewerBody(props: { state: FileViewerState; stacked: boolean }): ReactElement {
  const { state } = props;
  switch (state.kind) {
    case 'idle':
      return (
        <p role="status" className="p-4 text-sm text-text-secondary">
          Select a file to inspect
        </p>
      );
    case 'loading':
      return (
        <div role="status" className="flex flex-col gap-2 p-4">
          <div className="h-3 w-3/4 animate-pulse rounded bg-surface-hover" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-hover" />
        </div>
      );
    case 'diff':
      return <DiffPanes response={state.response} stacked={props.stacked} />;
    case 'text':
      return (
        <pre className="min-h-0 min-w-0 flex-1 overflow-auto p-4 text-xs">
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml(state.text) }}
          />
        </pre>
      );
    case 'image':
      return (
        <div className="flex min-h-0 flex-1 flex-col items-start gap-2 overflow-auto p-4">
          <InlineImage bytes={state.bytes} mediaType={state.mediaType} />
          <DownloadLink href={state.downloadHref} />
        </div>
      );
    case 'hex':
      return (
        <div className="flex min-h-0 flex-1 flex-col items-start gap-2 overflow-auto p-4">
          <pre className="min-w-0 w-full overflow-auto text-xs">
            <code>{state.hex}</code>
          </pre>
          <DownloadLink href={state.downloadHref} />
        </div>
      );
    case 'download':
      return (
        <div className="flex flex-col items-start gap-2 p-4">
          <p className="text-sm text-text-secondary">This file is too large to open here.</p>
          <DownloadLink href={state.downloadHref} />
        </div>
      );
    case 'unavailable':
      return (
        <p className="p-4 text-sm text-text-secondary">
          {state.emptyReason === 'no_checkout'
            ? "This run's checkout isn't available right now."
            : "This run's files aren't available on the host."}
        </p>
      );
    case 'error':
      return <p className="p-4 text-sm text-text-secondary">Could not open this file.</p>;
  }
}

export function FileViewer(props: FileViewerProps): ReactElement {
  const file = fileFromState(props.state);
  const loadingMore = props.loadingMore === true;
  const showLoadMore = canLoadMore(props.state) && props.onLoadMore !== undefined && !loadingMore;
  const showCancel = props.state.kind === 'loading' || loadingMore;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {file ? (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
          <h2 className="min-w-0 truncate text-sm font-medium text-text-primary">{file.path}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {showCancel ? (
              <button type="button" onClick={props.onCancel} className={ACTION_CLASS}>
                Cancel
              </button>
            ) : null}
            {showLoadMore ? (
              <button type="button" onClick={props.onLoadMore} className={ACTION_CLASS}>
                Load more
              </button>
            ) : null}
            {showsReload(props.state) ? (
              <button type="button" onClick={props.onReload} className={ACTION_CLASS}>
                Reload
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Close"
              onClick={props.onClose}
              className={ACTION_CLASS}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <ViewerBody state={props.state} stacked={props.stacked} />
    </div>
  );
}
