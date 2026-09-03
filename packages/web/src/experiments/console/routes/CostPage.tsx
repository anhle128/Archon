/**
 * Installation-level Cost page — one route, project as a filter.
 * Defaults to the current UTC calendar month. No SSE; explicit Refresh only.
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { UsageBreakdownTable } from '../components/UsageBreakdownTable';
import { INPUT_CLASS, SELECT_CLASS, SelectShell } from '../components/SettingsFormPrimitives';
import { useEntity, invalidate } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';
import type { Project } from '../primitives/project';
import type { UsageGroupBy, UsageKindFilter, UsageQuery, UsageReport } from '../skills/usage';
import {
  getUsageReport,
  inclusiveUtcRangeToApi,
  utcDateOnly,
  utcMonthStart,
  usageCacheKey,
} from '../skills/usage';
import { HttpError } from '../lib/http';

const GROUP_OPTIONS: readonly { value: UsageGroupBy; label: string }[] = [
  { value: 'provider', label: 'Provider' },
  { value: 'agent', label: 'Agent' },
  { value: 'model', label: 'Model' },
  { value: 'project', label: 'Project' },
  { value: 'run', label: 'Run' },
  { value: 'day', label: 'Day' },
  { value: 'node', label: 'Node (needs run id)' },
];

const KIND_OPTIONS: readonly { value: '' | UsageKindFilter; label: string }[] = [
  { value: '', label: 'Any kind' },
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'subagent', label: 'Subagent' },
];

interface CostFilters {
  fromDay: string;
  throughDay: string;
  codebaseId: string;
  agentProvider: string;
  provider: string;
  model: string;
  kind: '' | UsageKindFilter;
  runId: string;
  nodeId: string;
  groupBy: UsageGroupBy;
}

function defaultFilters(): CostFilters {
  const now = new Date();
  return {
    fromDay: utcMonthStart(now),
    throughDay: utcDateOnly(now),
    codebaseId: '',
    agentProvider: '',
    provider: '',
    model: '',
    kind: '',
    runId: '',
    nodeId: '',
    groupBy: 'provider',
  };
}

function filtersToQuery(f: CostFilters): UsageQuery | { error: string } {
  const range = inclusiveUtcRangeToApi(f.fromDay, f.throughDay);
  if ('error' in range) return range;
  if (f.groupBy === 'node' && f.runId.trim() === '') {
    return { error: 'Grouping by node requires a run id.' };
  }
  if (f.nodeId.trim() !== '' && f.runId.trim() === '') {
    return { error: 'Node filter requires a run id.' };
  }
  const q: UsageQuery = {
    from: range.from,
    to: range.to,
    groupBy: f.groupBy,
  };
  if (f.codebaseId !== '') q.codebaseId = f.codebaseId;
  if (f.agentProvider.trim() !== '') q.agentProvider = f.agentProvider.trim();
  if (f.provider.trim() !== '') q.provider = f.provider.trim();
  if (f.model.trim() !== '') q.model = f.model.trim();
  if (f.kind !== '') q.kind = f.kind;
  if (f.runId.trim() !== '') q.runId = f.runId.trim();
  if (f.nodeId.trim() !== '') q.nodeId = f.nodeId.trim();
  return q;
}

const FIELD_LABEL =
  'mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary';

export function CostPage(): ReactElement {
  const [draft, setDraft] = useState<CostFilters>(() => defaultFilters());
  // Applied filters drive the fetch — draft edits wait for Apply/Refresh.
  const [applied, setApplied] = useState<CostFilters>(() => defaultFilters());
  const [localError, setLocalError] = useState<string | null>(null);

  const queryOrError = useMemo(() => filtersToQuery(applied), [applied]);
  const query: UsageQuery | null =
    queryOrError !== null && !('error' in queryOrError) ? queryOrError : null;
  const appliedError = 'error' in queryOrError ? queryOrError.error : null;

  const cacheKey = query !== null ? K.usage(query) : 'noop:usage-invalid';

  const { data: report, error: fetchError } = useEntity<UsageReport | null>(cacheKey, () =>
    query !== null ? getUsageReport(query) : Promise.resolve(null)
  );

  const { data: projects } = useEntity<Project[]>(K.projects, () => skill.listProjects());

  const applyDraft = useCallback((): void => {
    const next = filtersToQuery(draft);
    if ('error' in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setApplied(draft);
  }, [draft]);

  const refresh = useCallback((): void => {
    const next = filtersToQuery(draft);
    if ('error' in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setApplied(draft);
    // Invalidate after state update so the loader re-runs for the new key.
    invalidate(usageCacheKey(next));
  }, [draft]);

  const patchDraft = <K extends keyof CostFilters>(key: K, value: CostFilters[K]): void => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const unavailable = fetchError !== undefined;
  const displayError =
    localError ?? appliedError ?? (fetchError instanceof HttpError ? fetchError.message : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-3 px-10 pt-[22px]">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.4px] text-text-primary">Cost</h1>
          <p className="mt-1 max-w-xl text-[12.5px] text-text-secondary">
            Direct workflow AI usage only. Reported USD and estimated USD stay separate — there is
            no combined total. Dates are UTC calendar days (From inclusive through Through
            inclusive).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={applyDraft}
            className="rounded-[9px] border border-border bg-surface px-3.5 py-2 font-mono text-[12px] font-semibold text-text-secondary transition-colors hover:border-accent-bright/40 hover:text-text-primary"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded-[9px] border border-transparent bg-accent-bright/15 px-3.5 py-2 font-mono text-[12px] font-semibold text-text-primary transition-colors hover:bg-accent-bright/25"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-10 pb-14 pt-5">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
          {/* Filters */}
          <div className="grid grid-cols-1 gap-3 rounded-[12px] border border-border bg-surface-elevated/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className={FIELD_LABEL}>From (UTC)</span>
              <input
                type="date"
                value={draft.fromDay}
                onChange={e => {
                  patchDraft('fromDay', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Through (UTC)</span>
              <input
                type="date"
                value={draft.throughDay}
                onChange={e => {
                  patchDraft('throughDay', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Project</span>
              <SelectShell className="w-full">
                <select
                  value={draft.codebaseId}
                  onChange={e => {
                    patchDraft('codebaseId', e.target.value);
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">All projects</option>
                  {(projects ?? []).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Group by</span>
              <SelectShell className="w-full">
                <select
                  value={draft.groupBy}
                  onChange={e => {
                    patchDraft('groupBy', e.target.value as UsageGroupBy);
                  }}
                  className={SELECT_CLASS}
                >
                  {GROUP_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Agent</span>
              <input
                type="text"
                value={draft.agentProvider}
                placeholder="claude, pi, …"
                onChange={e => {
                  patchDraft('agentProvider', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Provider</span>
              <input
                type="text"
                value={draft.provider}
                placeholder="anthropic, openai, …"
                onChange={e => {
                  patchDraft('provider', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Model</span>
              <input
                type="text"
                value={draft.model}
                placeholder="exact model id"
                onChange={e => {
                  patchDraft('model', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL}>Kind</span>
              <SelectShell className="w-full">
                <select
                  value={draft.kind}
                  onChange={e => {
                    patchDraft('kind', e.target.value as '' | UsageKindFilter);
                  }}
                  className={SELECT_CLASS}
                >
                  {KIND_OPTIONS.map(o => (
                    <option key={o.value || 'any'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </SelectShell>
            </label>
            <label className="block sm:col-span-2">
              <span className={FIELD_LABEL}>Run id</span>
              <input
                type="text"
                value={draft.runId}
                placeholder="optional UUID"
                onChange={e => {
                  patchDraft('runId', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={FIELD_LABEL}>Node (step name)</span>
              <input
                type="text"
                value={draft.nodeId}
                placeholder="requires run id"
                onChange={e => {
                  patchDraft('nodeId', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          {displayError !== null ? (
            <div
              className="rounded-[10px] border border-error/40 bg-error/[0.06] px-4 py-3 text-[13px] text-error"
              role="alert"
            >
              {displayError}
            </div>
          ) : null}

          {query === null ? null : report === undefined && !unavailable ? (
            <p className="text-[13px] text-text-tertiary">Loading usage…</p>
          ) : (
            <UsageBreakdownTable
              report={unavailable ? null : (report ?? null)}
              unavailable={unavailable}
            />
          )}
        </div>
      </div>
    </div>
  );
}
