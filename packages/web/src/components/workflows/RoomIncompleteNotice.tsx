/**
 * Incomplete-history notice shown when cursor paging fails after a partial load.
 * Retry resumes from the retained cursor; loaded rows stay visible above this.
 */
export interface RoomIncompleteNoticeProps {
  error: string;
  onRetry: () => void;
}

export function RoomIncompleteNotice({
  error,
  onRetry,
}: RoomIncompleteNoticeProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-3 text-center text-sm text-text-secondary">
      <p>Failed to load node transcript</p>
      <p>{error}</p>
      <button
        type="button"
        className="text-xs text-primary hover:text-accent-bright transition-colors"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
