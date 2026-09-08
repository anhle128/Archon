import { useState, type KeyboardEvent, type ReactElement } from 'react';

export type ReplyDestinationState =
  | { kind: 'loading' }
  | { kind: 'ready'; parentPlatformId: string }
  | { kind: 'missing' }
  | { kind: 'non_web' }
  | { kind: 'error' };

export interface ConsoleReplyComposerProps {
  state: ReplyDestinationState;
  onSend: (message: string) => Promise<void>;
}

function disabledCopy(state: ReplyDestinationState): string | null {
  switch (state.kind) {
    case 'loading':
      return 'Loading parent conversation…';
    case 'missing':
      return 'Replies need a parent web conversation. This run has none.';
    case 'error':
      return 'Unable to verify the parent conversation.';
    case 'non_web':
      return 'Replies are available only for runs with a parent web conversation.';
    case 'ready':
      return null;
  }
}

/**
 * Reply composer that sends only to a verified parent web conversation.
 * Disabled states stay factual so messages are never posted to a fallback chat.
 */
export function ConsoleReplyComposer({ state, onSend }: ConsoleReplyComposerProps): ReactElement {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ready = state.kind === 'ready';
  const reason = disabledCopy(state);
  const canSend = ready && !sending && value.trim().length > 0;

  async function submit(): Promise<void> {
    if (!ready || sending) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(trimmed);
      setValue('');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
      {reason !== null ? (
        <p className="mb-2 text-[12px] text-text-secondary" role="status">
          {reason}
        </p>
      ) : null}
      {sendError !== null ? (
        <p className="mb-2 text-[12px] text-warning" role="alert">
          {sendError}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Reply"
          value={value}
          disabled={!ready}
          placeholder={ready ? 'Message the agent…' : (reason ?? 'Waiting…')}
          rows={1}
          className="min-h-[36px] flex-1 resize-none rounded-[10px] border border-border bg-transparent px-3 py-2 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
          onChange={(event): void => {
            setValue(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          disabled={!canSend}
          className="brand-bar h-[36px] shrink-0 rounded-[10px] px-[15px] text-[13px] font-bold text-white disabled:opacity-45"
          onClick={(): void => {
            void submit();
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
