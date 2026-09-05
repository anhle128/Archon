import { type ReactElement } from 'react';
import type { WorkflowEnvSummary } from '../skills/workflowEnvs';
import { NONE_ENV_SELECTION } from '../lib/draft-env';

export interface WorkflowEnvPickerProps {
  envs: WorkflowEnvSummary[];
  /** `null` = None (YAML). */
  value: string | null;
  onChange: (envId: string | null) => void;
  disabled?: boolean;
  /** List fetch failed — only None remains selectable. */
  listError?: boolean;
}

/**
 * Compact ENV selector for the Start card.
 * Default is None (YAML). List failure keeps None usable; does not invent ENVs.
 */
export function WorkflowEnvPicker({
  envs,
  value,
  onChange,
  disabled = false,
  listError = false,
}: WorkflowEnvPickerProps): ReactElement {
  const selected = value ?? '';
  // If the operator already picked an ENV and the list later fails or drops it,
  // keep that option visible so selection is never silently reset to None.
  const selectedMissing = value !== null && value.length > 0 && !envs.some(env => env.id === value);
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        ENV
      </span>
      <select
        value={selected}
        disabled={disabled}
        onChange={e => {
          const next = e.target.value;
          onChange(next.length === 0 ? NONE_ENV_SELECTION : next);
        }}
        aria-label="Workflow ENV overlay"
        className="max-w-full rounded-[8px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-text-primary focus:border-accent-bright/50 focus:outline-none focus:ring-[3px] focus:ring-accent-bright/10 disabled:opacity-50"
      >
        <option value="">None (YAML)</option>
        {selectedMissing ? <option value={value}>{`selected (${value})`}</option> : null}
        {!listError
          ? envs.map(env => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))
          : null}
      </select>
      {listError ? (
        <span className="font-mono text-[10px] text-text-tertiary">
          ENV list unavailable — YAML Start still works.
        </span>
      ) : null}
    </label>
  );
}
