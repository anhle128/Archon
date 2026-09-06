import type { ChangeEvent, FormEvent } from 'react';

export interface RunChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  disabledReason: string | null;
  error: string | null;
}

export function RunChatComposer(props: RunChatComposerProps): React.ReactElement {
  const disabled = props.sending || props.disabledReason !== null;
  const placeholder = props.disabledReason ?? "Message the run's conversation…";

  return (
    <form
      aria-label="Run conversation composer"
      className="border-t border-border bg-surface p-3"
      title={props.disabledReason ?? undefined}
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!disabled) props.onSubmit();
      }}
    >
      {props.error !== null ? (
        <p role="alert" className="mb-2 text-xs text-error">
          {props.error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message the run conversation"
          value={props.value}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
            props.onValueChange(event.target.value);
          }}
        />
        <button
          type="submit"
          disabled={disabled || props.value.trim().length === 0}
          className="h-10 rounded-lg bg-primary px-4 text-sm text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {props.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
