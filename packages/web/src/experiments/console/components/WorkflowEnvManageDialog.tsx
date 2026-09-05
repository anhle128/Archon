/**
 * Workflow-specific ENV management dialog.
 * Visual shell matches EnvVarsDialog; semantics are install-wide overlay CRUD
 * driven by server baseline preview targets (never a client-side field matrix).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import * as skill from '../skills';
import type { WorkflowEnvPreviewTarget, WorkflowEnvSummary } from '../skills/workflowEnvs';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import {
  PLAINTEXT_NOTICE,
  LOOP_GROUP_BODY_NOTE,
  allowedFieldsForNode,
  buildPatchesFromDrafts,
  draftsFromPatches,
  emptyNodeDraft,
  formatWorkflowEnvActionError,
  invalidateWorkflowEnvCaches,
  isValidEnvName,
  type AllowedField,
  type NodePatchDraft,
  type ThinkingEditorValue,
  type ThinkingMode,
} from '../lib/workflow-env-editor';

export interface WorkflowEnvManageDialogProps {
  workflowName: string;
  /** Project cwd — required for baseline preview targets. */
  projectCwd: string;
  open: boolean;
  onClose: () => void;
}

type View = 'list' | 'create' | 'edit';

/**
 * Modal shell — Escape / backdrop close. Body mounts only while open so
 * list/detail loaders refresh each open.
 */
export function WorkflowEnvManageDialog({
  workflowName,
  projectCwd,
  open,
  onClose,
}: WorkflowEnvManageDialogProps): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Workflow ENVs for ${workflowName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[6px]"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={e => {
          e.stopPropagation();
        }}
        className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border bg-surface-elevated p-[22px] text-text-primary shadow-[0_30px_80px_-24px_rgba(0,0,0,0.8)]"
        style={{ borderColor: 'var(--border-bright)' }}
      >
        <span aria-hidden className="brand-bar absolute left-0 right-0 top-0 h-[2px] opacity-90" />
        <WorkflowEnvManageBody
          workflowName={workflowName}
          projectCwd={projectCwd}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

interface BodyProps {
  workflowName: string;
  projectCwd: string;
  onClose: () => void;
}

function WorkflowEnvManageBody({ workflowName, projectCwd, onClose }: BodyProps): ReactElement {
  // Drop summary + baseline preview caches on open so the dialog reflects
  // external edits (CLI/other sessions) instead of stale in-memory rows.
  useEffect(() => {
    invalidateWorkflowEnvCaches(workflowName);
  }, [workflowName]);

  const {
    data: summaries,
    error: listError,
    loading: listLoading,
  } = useEntity<WorkflowEnvSummary[]>(K.workflowEnvs(workflowName), () =>
    skill.listWorkflowEnvs(workflowName)
  );

  // Baseline preview (no envId) — server-authoritative targets + allowedFields.
  const baselineKey = K.workflowEnvPreview(projectCwd, workflowName, null);
  const {
    data: baseline,
    error: baselineError,
    loading: baselineLoading,
  } = useEntity(baselineKey, () => skill.previewWorkflowEnv(workflowName, projectCwd, null));

  const targets = baseline?.targets ?? [];

  const [view, setView] = useState<View>('list');
  const [editEnvId, setEditEnvId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backToList = useCallback((): void => {
    setView('list');
    setEditEnvId(null);
    setActionError(null);
  }, []);

  const openCreate = (): void => {
    setEditEnvId(null);
    setActionError(null);
    setView('create');
  };

  const openEdit = (envId: string): void => {
    setEditEnvId(envId);
    setActionError(null);
    setView('edit');
  };

  const remove = async (env: WorkflowEnvSummary): Promise<void> => {
    if (
      !window.confirm(
        `Delete ENV “${env.name}”? This does not affect runs that already started with it.`
      )
    ) {
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      await skill.deleteWorkflowEnv(workflowName, env.id);
      invalidateWorkflowEnvCaches(workflowName, env.id);
    } catch (err: unknown) {
      setActionError(formatWorkflowEnvActionError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="mb-[18px] flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-extrabold tracking-[-0.3px] text-text-primary">
            Workflow ENVs
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-text-tertiary">
            Named install-wide overlays for this workflow. Patches apply at Start; YAML on disk is
            never modified.
          </p>
        </div>
        <span className="shrink-0 truncate pt-1 font-mono text-[12px] text-text-tertiary">
          {workflowName}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'list' ? (
          <ListView
            summaries={summaries}
            listLoading={listLoading}
            listError={listError}
            busy={busy}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={env => {
              void remove(env);
            }}
          />
        ) : (
          <EditorView
            mode={view === 'create' ? 'create' : 'edit'}
            workflowName={workflowName}
            envId={editEnvId}
            targets={targets}
            targetsLoading={
              baselineLoading || (baseline === undefined && baselineError === undefined)
            }
            targetsError={baselineError}
            busy={busy}
            setBusy={setBusy}
            actionError={actionError}
            setActionError={setActionError}
            onCancel={backToList}
            onSaved={savedId => {
              invalidateWorkflowEnvCaches(workflowName, savedId);
              backToList();
            }}
          />
        )}
      </div>

      {actionError !== null && view === 'list' ? (
        <p className="mt-2 shrink-0 font-mono text-[11px] text-error">{actionError}</p>
      ) : null}

      <p
        className="mt-3 shrink-0 rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-text-tertiary"
        data-testid="env-plaintext-notice"
      >
        {PLAINTEXT_NOTICE}
      </p>
      <p
        className="mt-2 shrink-0 font-mono text-[10px] leading-relaxed text-text-tertiary"
        data-testid="env-loop-group-note"
      >
        {LOOP_GROUP_BODY_NOTE}
      </p>

      <div className="mt-[18px] flex shrink-0 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[10px] border bg-transparent px-[18px] py-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          style={{ borderColor: 'var(--border-bright)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface ListViewProps {
  summaries: WorkflowEnvSummary[] | undefined;
  listLoading: boolean;
  listError: Error | undefined;
  busy: boolean;
  onCreate: () => void;
  onEdit: (envId: string) => void;
  onDelete: (env: WorkflowEnvSummary) => void;
}

function ListView({
  summaries,
  listLoading,
  listError,
  busy,
  onCreate,
  onEdit,
  onDelete,
}: ListViewProps): ReactElement {
  if (listLoading && summaries === undefined) {
    return <p className="font-mono text-[11px] text-text-tertiary">Loading…</p>;
  }
  if (listError !== undefined && summaries === undefined) {
    return <p className="font-mono text-[11px] text-error">{listError.message}</p>;
  }

  const rows = summaries ?? [];
  return (
    <>
      <ul
        className="mb-3 max-h-[36vh] divide-y divide-border overflow-y-auto rounded-[11px] border bg-surface"
        style={{ borderColor: 'var(--border)' }}
        data-testid="env-summary-list"
      >
        {rows.length === 0 ? (
          <li className="px-[22px] py-[22px] text-center font-mono text-[13px] text-text-tertiary">
            No ENVs yet.
          </li>
        ) : (
          rows.map(env => (
            <li key={env.id} className="flex items-center justify-between gap-2 p-2 pl-3">
              <div className="min-w-0">
                <span className="block truncate font-mono text-[13px] tracking-[0.03em] text-text-primary">
                  {env.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-text-tertiary">
                  {env.id}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onEdit(env.id);
                  }}
                  disabled={busy}
                  className="rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDelete(env);
                  }}
                  disabled={busy}
                  title={`Delete ${env.name}`}
                  aria-label={`Delete ${env.name}`}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border text-text-tertiary transition-colors hover:border-error/40 hover:bg-error/10 hover:text-error disabled:opacity-40"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        onClick={onCreate}
        disabled={busy}
        className="mb-1 flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-border bg-surface px-3 py-3 text-[13px] font-semibold text-text-secondary transition-colors hover:border-accent-bright/50 hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
      >
        <span aria-hidden className="text-accent-bright">
          +
        </span>
        <span>Create ENV</span>
      </button>
    </>
  );
}

interface EditorViewProps {
  mode: 'create' | 'edit';
  workflowName: string;
  envId: string | null;
  targets: WorkflowEnvPreviewTarget[];
  targetsLoading: boolean;
  targetsError: Error | undefined;
  busy: boolean;
  setBusy: (v: boolean) => void;
  actionError: string | null;
  setActionError: (v: string | null) => void;
  onCancel: () => void;
  onSaved: (envId: string) => void;
}

function EditorView({
  mode,
  workflowName,
  envId,
  targets,
  targetsLoading,
  targetsError,
  busy,
  setBusy,
  actionError,
  setActionError,
  onCancel,
  onSaved,
}: EditorViewProps): ReactElement {
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<NodePatchDraft[]>([]);
  const [loaded, setLoaded] = useState(mode === 'create');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch full ENV (with patches) only when opening edit — never from the summary list.
  useEffect(() => {
    if (mode !== 'edit' || envId === null) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    void skill
      .getWorkflowEnv(workflowName, envId)
      .then(env => {
        if (cancelled) return;
        setName(env.name);
        setDrafts(draftsFromPatches(env.patches));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(formatWorkflowEnvActionError(err));
        setLoaded(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [mode, workflowName, envId]);

  const updateDraft = (index: number, next: NodePatchDraft): void => {
    setDrafts(prev => prev.map((d, i) => (i === index ? next : d)));
    if (actionError !== null) setActionError(null);
  };

  const removeDraft = (index: number): void => {
    setDrafts(prev => prev.filter((_, i) => i !== index));
    if (actionError !== null) setActionError(null);
  };

  const addDraft = (): void => {
    const used = new Set(drafts.map(d => d.nodeId));
    const nextTarget = targets.find(t => !used.has(t.id));
    setDrafts(prev => [...prev, emptyNodeDraft(nextTarget?.id ?? '')]);
    if (actionError !== null) setActionError(null);
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValidEnvName(name)) {
      setActionError('ENV name must be 1–64 chars: start with alphanumeric, then [A-Za-z0-9._-].');
      return;
    }
    if (targetsError !== undefined || targets.length === 0) {
      setActionError(
        targetsError?.message ??
          'Baseline targets unavailable — cannot edit patches without server field matrix.'
      );
      return;
    }
    const built = buildPatchesFromDrafts(drafts, targets);
    if (!built.ok) {
      setActionError(built.error);
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        const created = await skill.createWorkflowEnv(workflowName, {
          name: name.trim(),
          patches: built.patches,
        });
        onSaved(created.id);
      } else if (envId !== null) {
        // Full patch map replacement — never a deep delta.
        const updated = await skill.updateWorkflowEnv(workflowName, envId, {
          name: name.trim(),
          patches: built.patches,
        });
        onSaved(updated.id);
      }
    } catch (err: unknown) {
      setActionError(formatWorkflowEnvActionError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <p className="font-mono text-[11px] text-text-tertiary">Loading ENV…</p>;
  }
  if (loadError !== null) {
    return (
      <div>
        <p className="font-mono text-[11px] text-error">{loadError}</p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:bg-surface-hover"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        void onSubmit(e);
      }}
      className="space-y-3"
      data-testid="env-editor-form"
    >
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          Name
        </span>
        <input
          value={name}
          onChange={e => {
            setName(e.target.value);
            if (actionError !== null) setActionError(null);
          }}
          disabled={busy}
          autoFocus={mode === 'create'}
          spellCheck={false}
          placeholder="fast-sonnet"
          className="mt-1 w-full rounded-lg border bg-surface px-[11px] py-[9px] font-mono text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent-bright/50 focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand-magenta),transparent_92%)] disabled:opacity-50"
          style={{ borderColor: 'var(--border-bright)' }}
        />
      </label>

      {targetsLoading ? (
        <p className="font-mono text-[11px] text-text-tertiary">Loading allowed target fields…</p>
      ) : targetsError !== undefined ? (
        <p className="font-mono text-[11px] text-error">
          Baseline preview failed: {targetsError.message}
        </p>
      ) : (
        <div className="space-y-2" data-testid="env-patch-editor">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              Patches
            </span>
            <button
              type="button"
              onClick={addDraft}
              disabled={busy || targets.length === 0}
              className="rounded-lg px-2 py-1 text-[12px] font-semibold text-accent-bright hover:bg-surface-hover disabled:opacity-40"
            >
              + Node
            </button>
          </div>
          {drafts.length === 0 ? (
            <p
              className="rounded-[10px] border border-dashed border-border px-3 py-4 text-center font-mono text-[12px] text-text-tertiary"
              data-testid="env-empty-patches"
            >
              No target nodes — saving creates a no-op ENV with patches: {}. Add a node to set
              fields; each chosen node still needs at least one allowed field.
            </p>
          ) : (
            drafts.map((draft, index) => (
              <NodePatchEditor
                key={`draft-${String(index)}`}
                draft={draft}
                targets={targets}
                allowedFields={allowedFieldsForNode(draft.nodeId, targets)}
                disabled={busy}
                onChange={next => {
                  updateDraft(index, next);
                }}
                onRemove={() => {
                  removeDraft(index);
                }}
              />
            ))
          )}
        </div>
      )}

      {actionError !== null ? (
        <p className="font-mono text-[11px] text-error" data-testid="env-editor-error">
          {actionError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || targetsLoading || targetsError !== undefined}
          className="brand-bar rounded-lg px-3.5 py-1.5 text-[12px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-40"
        >
          {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export interface NodePatchEditorProps {
  draft: NodePatchDraft;
  targets: WorkflowEnvPreviewTarget[];
  allowedFields: AllowedField[];
  disabled?: boolean;
  onChange: (next: NodePatchDraft) => void;
  onRemove: () => void;
}

/**
 * One node row: target select + only server-allowed fields.
 * Exported for component tests of allowed-field rendering.
 */
export function NodePatchEditor({
  draft,
  targets,
  allowedFields,
  disabled = false,
  onChange,
  onRemove,
}: NodePatchEditorProps): ReactElement {
  const allowed = new Set<AllowedField>(allowedFields);
  const fieldClass =
    'mt-1 w-full rounded-lg border bg-surface-elevated px-[11px] py-[8px] font-mono text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent-bright/50 focus:outline-none disabled:opacity-50';

  return (
    <div
      className="rounded-[11px] border bg-surface p-3"
      style={{ borderColor: 'var(--border)' }}
      data-testid="env-node-patch"
      data-node-id={draft.nodeId}
    >
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            Node
          </span>
          <select
            value={draft.nodeId}
            disabled={disabled}
            onChange={e => {
              onChange({ ...draft, nodeId: e.target.value });
            }}
            aria-label="Target node"
            className={fieldClass}
            style={{ borderColor: 'var(--border-bright)' }}
            data-testid="env-node-select"
          >
            <option value="">Select node…</option>
            {targets.map(t => (
              <option key={t.id} value={t.id}>
                {t.id} ({t.nodeType})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove node patch"
          className="mt-5 rounded-lg border px-2 py-1.5 text-[11px] text-text-tertiary hover:border-error/40 hover:text-error disabled:opacity-40"
          style={{ borderColor: 'var(--border)' }}
        >
          Remove
        </button>
      </div>

      {draft.nodeId.length > 0 && allowedFields.length === 0 ? (
        <p className="mt-2 font-mono text-[11px] text-text-tertiary">
          No patchable fields for this node type.
        </p>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {allowed.has('provider') ? (
          <Field
            label="provider"
            value={draft.provider}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, provider: v });
            }}
            className={fieldClass}
          />
        ) : null}
        {allowed.has('model') ? (
          <Field
            label="model"
            value={draft.model}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, model: v });
            }}
            className={fieldClass}
          />
        ) : null}
        {allowed.has('effort') ? (
          <Field
            label="effort"
            value={draft.effort}
            disabled={disabled}
            onChange={v => {
              onChange({ ...draft, effort: v });
            }}
            className={fieldClass}
            placeholder="low | medium | high | …"
          />
        ) : null}
        {allowed.has('thinking') ? (
          <ThinkingField
            value={draft.thinking}
            disabled={disabled}
            onChange={thinking => {
              onChange({ ...draft, thinking });
            }}
            className={fieldClass}
          />
        ) : null}
      </div>

      {allowed.has('prompt') ? (
        <BodyField
          label="prompt"
          enabled={draft.promptEnabled}
          value={draft.prompt}
          disabled={disabled}
          className={fieldClass}
          onEnabledChange={enabled => {
            onChange({
              ...draft,
              promptEnabled: enabled,
              prompt: enabled ? draft.prompt : '',
            });
          }}
          onValueChange={value => {
            onChange({ ...draft, promptEnabled: true, prompt: value });
          }}
        />
      ) : null}

      {allowed.has('bash') ? (
        <BodyField
          label="bash"
          enabled={draft.bashEnabled}
          value={draft.bash}
          disabled={disabled}
          className={fieldClass}
          onEnabledChange={enabled => {
            onChange({
              ...draft,
              bashEnabled: enabled,
              bash: enabled ? draft.bash : '',
            });
          }}
          onValueChange={value => {
            onChange({ ...draft, bashEnabled: true, bash: value });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * prompt/bash body control: enable toggle separates omission from presence-with-empty.
 * Enabled + empty string is a deliberate `prompt: ''` / `bash: ''` patch value.
 */
function BodyField({
  label,
  enabled,
  value,
  disabled,
  className,
  onEnabledChange,
  onValueChange,
}: {
  label: 'prompt' | 'bash';
  enabled: boolean;
  value: string;
  disabled: boolean;
  className: string;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="mt-2 block" data-testid={`env-field-${label}-wrap`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {label}
        </span>
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-secondary">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={e => {
              onEnabledChange(e.target.checked);
            }}
            data-testid={`env-field-${label}-enabled`}
            aria-label={`Include ${label} in patch`}
          />
          include
        </label>
      </div>
      <textarea
        value={value}
        disabled={disabled || !enabled}
        onChange={e => {
          onValueChange(e.target.value);
        }}
        rows={3}
        spellCheck={false}
        placeholder={enabled ? '(empty body)' : 'Enable to set body (empty allowed)'}
        className={`${className} resize-y ${enabled ? '' : 'opacity-50'}`}
        style={{ borderColor: 'var(--border-bright)' }}
        data-testid={`env-field-${label}`}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  className,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  className: string;
  placeholder?: string;
}): ReactElement {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => {
          onChange(e.target.value);
        }}
        className={className}
        style={{ borderColor: 'var(--border-bright)' }}
        data-testid={`env-field-${label}`}
      />
    </label>
  );
}

function ThinkingField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ThinkingEditorValue;
  onChange: (v: ThinkingEditorValue) => void;
  disabled: boolean;
  className: string;
}): ReactElement {
  return (
    <div className="block sm:col-span-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        thinking
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          value={value.mode}
          disabled={disabled}
          onChange={e => {
            const mode = e.target.value as ThinkingMode;
            onChange({
              mode,
              budgetTokens: mode === 'enabled' ? value.budgetTokens : '',
            });
          }}
          aria-label="thinking mode"
          className={className}
          style={{ borderColor: 'var(--border-bright)', width: 'auto', minWidth: '10rem' }}
          data-testid="env-field-thinking-mode"
        >
          <option value="unset">unset</option>
          <option value="adaptive">adaptive</option>
          <option value="enabled">enabled</option>
          <option value="disabled">disabled</option>
        </select>
        {value.mode === 'enabled' ? (
          <input
            value={value.budgetTokens}
            disabled={disabled}
            placeholder="budgetTokens (optional)"
            spellCheck={false}
            onChange={e => {
              onChange({ ...value, budgetTokens: e.target.value });
            }}
            className={className}
            style={{ borderColor: 'var(--border-bright)', maxWidth: '12rem' }}
            data-testid="env-field-thinking-budget"
          />
        ) : null}
      </div>
    </div>
  );
}
