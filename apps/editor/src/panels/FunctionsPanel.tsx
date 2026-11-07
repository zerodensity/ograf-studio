import { useEffect, useState } from 'react';
import {
  DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS,
  MAX_LOGIC_FUNCTIONS,
  type Composition,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { Panel } from './Panel';
import {
  createFunctionsDraft,
  duplicateFunctionDraft,
  functionsDraftDirty,
  functionsDraftStale,
  functionsSignature,
  materializeFunctionsDraft,
  newFunctionDraft,
  type FunctionMappingDraft,
  type FunctionsDraft,
  type LogicFunctionDraft,
} from './functionsDraft';
import './FunctionsPanel.css';

// Only unsaved drafts are retained, including when a pane closes or another template is selected.
const pendingDrafts = new Map<string, FunctionsDraft>();
interface MappingOption {
  id: string;
  label: string;
}

function MappingEditor({
  label,
  rows,
  options,
  prefix,
  onChange,
}: {
  label: string;
  rows: FunctionMappingDraft[];
  options: MappingOption[];
  prefix: string;
  onChange(rows: FunctionMappingDraft[]): void;
}) {
  return (
    <div className="functions-mappings">
      {rows.map((row, index) => (
        <div className="functions-mapping" key={row.id}>
          <input
            aria-label={`${label} alias ${index + 1}`}
            value={row.alias}
            placeholder="alias"
            onChange={(event) =>
              onChange(
                rows.map((candidate) =>
                  candidate.id === row.id ? { ...row, alias: event.target.value } : candidate,
                ),
              )
            }
          />
          <span aria-hidden="true">→</span>
          <select
            aria-label={`${label} target ${index + 1}`}
            value={row.target}
            onChange={(event) =>
              onChange(
                rows.map((candidate) =>
                  candidate.id === row.id ? { ...row, target: event.target.value } : candidate,
                ),
              )
            }
          >
            <option value="">Choose…</option>
            {row.target && !options.some((option) => option.id === row.target) ? (
              <option value={row.target}>Missing: {row.target}</option>
            ) : null}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={options.length === 0}
        onClick={() => {
          let number = 1;
          while (rows.some((row) => row.alias === `${prefix}${number}`)) number++;
          onChange([
            ...rows,
            { id: crypto.randomUUID(), alias: `${prefix}${number}`, target: options[0]!.id },
          ]);
        }}
      >
        + {label}
      </button>
      {options.length === 0 ? (
        <small className="functions-note">No targets are available yet.</small>
      ) : null}
    </div>
  );
}

export function FunctionsEditor({
  ownerKey,
  composition,
}: {
  ownerKey: string;
  composition: Composition;
}) {
  const setLogicFunctions = useProjectStore((state) => state.setLogicFunctions);
  const [draft, setDraftState] = useState(
    () => pendingDrafts.get(ownerKey) ?? createFunctionsDraft(ownerKey, composition.functions),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const dirty = functionsDraftDirty(draft);
  const stale = functionsDraftStale(draft, composition.functions);
  const signature = functionsSignature(composition.functions);
  const setDraft = (next: FunctionsDraft) => {
    if (functionsDraftDirty(next)) pendingDrafts.set(ownerKey, next);
    else pendingDrafts.delete(ownerKey);
    setDraftState(next);
    setErrors([]);
    setNotice('');
  };
  useEffect(() => {
    if (functionsDraftDirty(draft) || !functionsDraftStale(draft, composition.functions)) return;
    const next = createFunctionsDraft(ownerKey, composition.functions);
    next.selectedId = next.entries.some((entry) => entry.id === draft.selectedId)
      ? draft.selectedId
      : next.selectedId;
    setDraftState(next);
  }, [signature, ownerKey, draft, composition.functions]);
  const selected = draft.entries.find((entry) => entry.id === draft.selectedId);
  const updateSelected = (patch: Partial<LogicFunctionDraft>) => {
    if (!selected) return;
    setDraft({
      ...draft,
      entries: draft.entries.map((entry) =>
        entry.id === selected.id ? { ...entry, ...patch } : entry,
      ),
    });
  };
  const add = () => {
    const entry = newFunctionDraft(draft.entries);
    setDraft({ ...draft, entries: [...draft.entries, entry], selectedId: entry.id });
  };
  const apply = () => {
    const current = useProjectStore.getState();
    const latest = current.project.compositions.find(
      (candidate) => candidate.id === composition.id,
    );
    if (
      !latest ||
      current.activeCompositionId !== composition.id ||
      `${current.project.id}:${latest.id}` !== ownerKey
    ) {
      setErrors(['The active document changed. Return to this template before applying.']);
      return;
    }
    const result = materializeFunctionsDraft(draft, latest, latest.functions);
    if (result.errors.length) {
      setErrors(result.errors);
      return;
    }
    try {
      runDiscreteHistoryStep(
        () => setLogicFunctions(result.functions, composition.id),
        'Edit functions',
      );
      const next = createFunctionsDraft(ownerKey, result.functions);
      next.selectedId = next.entries.some((entry) => entry.id === draft.selectedId)
        ? draft.selectedId
        : next.selectedId;
      setDraft(next);
      setNotice('Applied. Use Preview & Export to run the function.');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };
  const fields = composition.dataFields.map((field) => ({
    id: field.id,
    label: `${field.label || field.key} · ${field.key}`,
  }));
  const actions = composition.customActions.map((action) => ({
    id: action.actionId,
    label: action.name || action.actionId,
  }));
  const cues = composition.mediaCues.map((cue) => ({ id: cue.id, label: cue.name }));
  return (
    <div className="functions-panel">
      <div className="functions-toolbar">
        <span>
          {draft.entries.length} / {MAX_LOGIC_FUNCTIONS}
          {dirty ? ' · Unsaved draft' : ''}
        </span>
        <button type="button" disabled={!dirty || stale} onClick={apply}>
          Apply changes
        </button>
        <button
          type="button"
          disabled={!dirty && !stale}
          onClick={() => setDraft(createFunctionsDraft(ownerKey, composition.functions))}
        >
          Discard draft
        </button>
      </div>
      {stale ? (
        <p className="functions-error" role="alert">
          Functions changed elsewhere. Your draft is preserved; Discard draft loads the latest
          version.
        </p>
      ) : null}
      {errors.length ? (
        <ul className="functions-error" role="alert">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <p className="functions-note" role="status">
          {notice}
        </p>
      ) : null}
      <div className="functions-workspace">
        <aside className="functions-list" aria-label="Functions">
          {draft.entries.map((entry) => (
            <div
              className="functions-list-row"
              key={entry.id}
              data-selected={entry.id === selected?.id || undefined}
            >
              <button
                type="button"
                className="functions-select"
                aria-pressed={entry.id === selected?.id}
                onClick={() => setDraft({ ...draft, selectedId: entry.id })}
              >
                {entry.name || 'Unnamed function'}
              </button>
              <div className="functions-list-actions">
                <label title="Enabled">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${entry.name}`}
                    checked={entry.enabled}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        entries: draft.entries.map((candidate) =>
                          candidate.id === entry.id
                            ? { ...candidate, enabled: event.target.checked }
                            : candidate,
                        ),
                      })
                    }
                  />
                  On
                </label>
                <button
                  type="button"
                  aria-label={`Duplicate ${entry.name}`}
                  title="Duplicate (outputs must be assigned separately)"
                  disabled={draft.entries.length >= MAX_LOGIC_FUNCTIONS}
                  onClick={() => {
                    const copy = duplicateFunctionDraft(entry, draft.entries);
                    setDraft({ ...draft, entries: [...draft.entries, copy], selectedId: copy.id });
                    setNotice('Copy is disabled. Assign different output fields before applying.');
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${entry.name}`}
                  title="Delete from draft"
                  onClick={() => {
                    const entries = draft.entries.filter((candidate) => candidate.id !== entry.id);
                    setDraft({
                      ...draft,
                      entries,
                      selectedId:
                        draft.selectedId === entry.id ? (entries[0]?.id ?? null) : draft.selectedId,
                    });
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={draft.entries.length >= MAX_LOGIC_FUNCTIONS}
            onClick={add}
          >
            + Function
          </button>
        </aside>
        {selected ? (
          <div className="functions-editor">
            <label className="functions-field">
              <span>Name</span>
              <input
                aria-label="Function name"
                value={selected.name}
                onChange={(event) => updateSelected({ name: event.target.value })}
              />
            </label>
            <label className="functions-source-label">
              <span>JavaScript function</span>
              <textarea
                className="functions-source"
                aria-label="Function source"
                value={selected.source}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                wrap="off"
                onChange={(event) => updateSelected({ source: event.target.value })}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Tab' ||
                    event.shiftKey ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey
                  )
                    return;
                  event.preventDefault();
                  const input = event.currentTarget,
                    start = input.selectionStart,
                    end = input.selectionEnd;
                  updateSelected({
                    source: `${selected.source.slice(0, start)}  ${selected.source.slice(end)}`,
                  });
                  queueMicrotask(() => input.setSelectionRange(start + 2, start + 2));
                }}
              />
            </label>
            <details className="functions-section">
              <summary>
                Bindings · {selected.inputs.length} inputs / {selected.outputs.length} outputs
              </summary>
              <p className="functions-note">
                Read input aliases in ctx.data; return output aliases in data. Inputs and outputs
                refer to existing Data fields.
              </p>
              <label className="functions-pointer-input">
                <input
                  type="checkbox"
                  aria-label="Function mouse input"
                  checked={selected.pointer === true}
                  onChange={(event) => updateSelected({ pointer: event.target.checked })}
                />
                Mouse input
              </label>
              <p className="functions-note">
                Adds ctx.pointer: the latest mouse position in composition pixels, or null outside
                the preview. Read it during an action or scheduled tick; moving the mouse does not
                run the function by itself. Also receives focus when interaction returns, without
                automatically resuming paused state.
              </p>
              <MappingEditor
                label="Input"
                prefix="input"
                rows={selected.inputs}
                options={fields}
                onChange={(inputs) => updateSelected({ inputs })}
              />
              <MappingEditor
                label="Output"
                prefix="output"
                rows={selected.outputs}
                options={fields}
                onChange={(outputs) => updateSelected({ outputs })}
              />
            </details>
            <details className="functions-section">
              <summary>
                Actions · {selected.actions.length} incoming / {selected.emits.length} emitted
              </summary>
              <p className="functions-note">
                Keyboard or button Rules can trigger these custom actions. Also receives load, play,
                out, data, blur and scheduled tick events; Mouse input also enables focus events.
              </p>
              <div className="functions-action-list">
                {[
                  ...actions,
                  ...selected.actions
                    .filter((id) => !actions.some((action) => action.id === id))
                    .map((id) => ({ id, label: `Missing: ${id}` })),
                ].map((action) => (
                  <label key={action.id}>
                    <input
                      type="checkbox"
                      checked={selected.actions.includes(action.id)}
                      aria-label={`Listen to ${action.label}`}
                      onChange={(event) =>
                        updateSelected({
                          actions: event.target.checked
                            ? [...selected.actions, action.id]
                            : selected.actions.filter((id) => id !== action.id),
                        })
                      }
                    />
                    {action.label}
                  </label>
                ))}
              </div>
              {!actions.length ? (
                <p className="functions-note">
                  Create custom actions in the Data pane to connect Rules.
                </p>
              ) : null}
              <MappingEditor
                label="Emitted action"
                prefix="event"
                rows={selected.emits}
                options={actions}
                onChange={(emits) => updateSelected({ emits })}
              />
            </details>
            <details className="functions-section">
              <summary>Audio & media · {selected.media.length}</summary>
              <p className="functions-note">
                Map aliases to authored media cues. Return play, restart, pause, resume, stop or
                controls commands.
              </p>
              <MappingEditor
                label="Media"
                prefix="cue"
                rows={selected.media}
                options={cues}
                onChange={(media) => updateSelected({ media })}
              />
            </details>
            <details className="functions-section">
              <summary>Advanced</summary>
              <label className="functions-source-label">
                <span>Initial state (JSON)</span>
                <textarea
                  aria-label="Function initial state"
                  className="functions-json"
                  spellCheck={false}
                  value={selected.initialStateText}
                  placeholder="{}"
                  onChange={(event) => updateSelected({ initialStateText: event.target.value })}
                />
              </label>
              <label className="functions-field">
                <span>Timeout (ms)</span>
                <input
                  type="number"
                  aria-label="Function timeout"
                  min={16}
                  max={1000}
                  step={1}
                  placeholder={String(DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS)}
                  value={selected.timeoutText}
                  onChange={(event) => updateSelected({ timeoutText: event.target.value })}
                />
              </label>
            </details>
            <details className="functions-section">
              <summary>Function API</summary>
              <p className="functions-note">
                The function receives ctx.state, ctx.data, ctx.event and ctx.nowMs; Mouse input adds
                ctx.pointer. State is temporary playback state. Return state, an output data patch,
                mapped actions/media, or wakeAt (a future time in milliseconds, null to stop ticks).
              </p>
              <pre className="functions-api">
                {
                  '(ctx) => ({\n  state: ctx.state,\n  data: { /* mapped output aliases */ },\n  actions: [{ name: "eventAlias", payload: {} }],\n  media: [{ name: "cueAlias", command: "play" }],\n  wakeAt: null\n})'
                }
              </pre>
              <p className="functions-note">
                Runs outside the editor page, without DOM, network or Studio access. Apply checks
                configuration only. Preview reports syntax errors and execution timeouts. Functions
                require real-time playback.
              </p>
            </details>
          </div>
        ) : (
          <div className="functions-empty">
            <p>Reusable logic can respond to Rules, update data and control sound.</p>
            <button type="button" onClick={add}>
              Add function
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FunctionsPanel() {
  const composition = useActiveComposition();
  const projectId = useProjectStore((state) => state.project.id);
  const ownerKey = `${projectId}:${composition.id}`;
  return (
    <Panel title="Functions">
      <FunctionsEditor key={ownerKey} ownerKey={ownerKey} composition={composition} />
    </Panel>
  );
}
