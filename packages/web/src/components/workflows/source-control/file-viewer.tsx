import type { ReactElement } from 'react';
import { Diff, type RenderGutter } from 'react-diff-view';
import 'react-diff-view/style/index.css';

import type { GitChangedFile, GitEmptyReason, GitReadyDiffResponse } from '@/lib/api';

import { hunksForSide, toHunkData } from './git-hunk-adapter';
import './source-control-diff.css';
import { highlightedHtml, highlightDiffTokens, renderHighlightedToken } from './syntax-highlight';

export type FileViewerState =
  | { kind: 'idle' }
  | { kind: 'loading'; file: GitChangedFile }
  | { kind: 'diff'; file: GitChangedFile; response: GitReadyDiffResponse }
  | { kind: 'text'; file: GitChangedFile; text: string; contentHash: string }
  | { kind: 'binary'; file: GitChangedFile; contentHash: string; downloadHref: string }
  | { kind: 'unavailable'; file: GitChangedFile; emptyReason: GitEmptyReason }
  | { kind: 'error'; file: GitChangedFile };

export interface FileViewerProps {
  state: FileViewerState;
  stacked: boolean;
  onCancel: () => void;
  onReload: () => void;
  onClose: () => void;
}

const ACTION_CLASS = 'text-xs text-primary transition-colors hover:text-accent-bright';

const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
  const marker =
    change.type === 'delete' && side === 'old'
      ? '-'
      : change.type === 'insert' && side === 'new'
        ? '+'
        : '';
  return (
    <>
      <span aria-hidden="true" className="sc-diff-marker">
        {marker}
      </span>
      <span>{renderDefault()}</span>
    </>
  );
};

function fileFromState(state: FileViewerState): GitChangedFile | null {
  return state.kind === 'idle' ? null : state.file;
}

function showsReload(state: FileViewerState): boolean {
  return (
    state.kind === 'error' || (state.kind === 'unavailable' && state.emptyReason === 'no_checkout')
  );
}

function DiffPanes(props: { response: GitReadyDiffResponse; stacked: boolean }): ReactElement {
  const hunks = props.response.hunks.map(toHunkData);
  const oldHunks = hunksForSide(hunks, 'old');
  const newHunks = hunksForSide(hunks, 'new');
  const paneClass = props.stacked ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-row';

  return (
    <div className={paneClass}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h3 className="border-b border-border px-4 py-1 text-xs font-medium text-text-secondary">
          Before
        </h3>
        <div aria-label="Before" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Diff
            diffType="modify"
            viewType="split"
            hunks={oldHunks}
            tokens={highlightDiffTokens(oldHunks)}
            renderToken={renderHighlightedToken}
            renderGutter={renderGutter}
            className="sc-diff-side sc-diff-before"
          />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h3 className="border-b border-border px-4 py-1 text-xs font-medium text-text-secondary">
          After
        </h3>
        <div aria-label="After" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Diff
            diffType="modify"
            viewType="split"
            hunks={newHunks}
            tokens={highlightDiffTokens(newHunks)}
            renderToken={renderHighlightedToken}
            renderGutter={renderGutter}
            className="sc-diff-side sc-diff-after"
          />
        </div>
      </div>
    </div>
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
    case 'binary':
      return (
        <div className="flex flex-col items-start gap-2 p-4">
          <p className="text-sm text-text-secondary">Binary file. Download to inspect.</p>
          <a href={state.downloadHref} className={ACTION_CLASS}>
            Download
          </a>
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {file ? (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
          <h2 className="min-w-0 truncate text-sm font-medium text-text-primary">{file.path}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {props.state.kind === 'loading' ? (
              <button type="button" onClick={props.onCancel} className={ACTION_CLASS}>
                Cancel
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
