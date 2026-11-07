import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoordinatedPlayoutSlot } from '@ograf-editor/ograf-types';
import type {
  FieldValue,
  TransitionLogicDefinition,
  TransitionLogicState,
} from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from '../state/projectSet';
import { useProjectStore } from '../state/projectStore';
import {
  transitionLogicDraftChanged,
  transitionLogicFingerprint,
  useTransitionLogicDraftStore,
} from '../state/transitionLogicDraftStore';
import {
  transitionLogicEditorComponents,
  transitionLogicEditorErrors,
  transitionLogicEditorSetSnapshot,
} from '../state/transitionLogicEditing';
import {
  behaviorPreviewDataSource,
  clearBehaviorPreviewOutput,
  controlBehaviorPreviewLoop,
  editBehaviorPreviewSlotField,
  outBehaviorPreviewSlot,
  pauseBehaviorPreview,
  replayBehaviorPreview,
  requestBehaviorPreview,
  resumeBehaviorPreview,
  runBehaviorPreviewTemplateAction,
  takeBehaviorPreviewSlot,
  useBehaviorPreviewStore,
} from '../state/behaviorPreviewStore';
import { PreviewError } from './PreviewError';
import { operatorPreviewContext } from '../state/operatorPreviewContext';
import {
  previewSlotSelectionKey,
  setPreviewSlotSelection,
  usePreviewSlotSelectionStore,
} from '../state/previewSlotSelectionStore';
import {
  previewSlotDataKey,
  resolvePreviewSlotForm,
  usePreviewSlotDataStore,
} from '../state/previewSlotDataStore';
import { PreviewDataFields } from './PreviewDataFields';

function SlotDataFields({
  source,
  definition,
  slotId,
  state,
  status,
  onAir,
  disabled,
  action,
}: {
  source: ProjectSetDocument;
  definition: TransitionLogicDefinition;
  slotId: string;
  state: TransitionLogicState;
  status?: CoordinatedPlayoutSlot;
  onAir: boolean;
  disabled: boolean;
  action: (operation: () => void | Promise<void>) => void;
}) {
  // This component is keyed by the selected state. Switching reveals the new form,
  // while ordinary runtime snapshots keep its disclosure and focused controls intact.
  const [expanded, setExpanded] = useState(true);
  const key = previewSlotDataKey(source.id, definition.id, slotId, state.id, state.templateId);
  const draft = usePreviewSlotDataStore((store) => store.drafts[key]);
  const observed = usePreviewSlotDataStore((store) => store.observed[key]);
  const incomingId = status?.incoming?.stateId;
  const currentId = status?.current?.stateId;
  const outgoingId = status?.outgoing?.stateId;
  const form = useMemo(
    () => resolvePreviewSlotForm(source, definition, state.id, status, draft),
    // Runtime progress snapshots arrive each frame. Data changes are published separately,
    // so do not rehydrate template fields merely because animation progress advanced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      source,
      definition,
      state.id,
      state.templateId,
      incomingId,
      currentId,
      outgoingId,
      observed,
      draft,
    ],
  );
  if (!form?.fields.length) return null;
  return (
    <details
      className="preview-slot-data"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        Data · {state.name} <small>{onAir ? 'On air' : 'Next'}</small>
      </summary>
      <fieldset
        className="preview-slot-data-fields"
        disabled={disabled}
        title={
          disabled ? 'Data controls are unavailable while the preview is preparing.' : undefined
        }
      >
        <PreviewDataFields
          fields={form.fields}
          values={form.values}
          changeHint={
            onAir ? undefined : 'are staged for the next Take without changing its saved default'
          }
          onChange={(fieldKey, value) => {
            // The color picker can be portaled outside the disabled fieldset.
            if (!disabled)
              action(() =>
                editBehaviorPreviewSlotField(source, definition, state.id, fieldKey, value),
              );
          }}
        />
      </fieldset>
    </details>
  );
}

export function SlotControls({
  selectionKey,
  source,
  definition,
  slot,
  states,
  status,
  activeTemplateId,
  requestedStateId,
  disabled,
  fieldsDisabled,
  onTake,
  onOut,
  customActions,
  onCustomAction,
  action,
}: {
  selectionKey: string;
  source: ProjectSetDocument | null;
  definition: TransitionLogicDefinition;
  slot: TransitionLogicDefinition['slots'][number];
  states: TransitionLogicState[];
  status?: CoordinatedPlayoutSlot;
  activeTemplateId: string | null;
  requestedStateId: string | null;
  disabled: boolean;
  fieldsDisabled: boolean;
  onTake: (stateId: string) => void;
  onOut: () => void;
  customActions: Array<{ id: string; name: string }>;
  onCustomAction: (actionId: string) => void;
  action: (operation: () => void | Promise<void>) => void;
}) {
  const choice = usePreviewSlotSelectionStore((state) => state.choices[selectionKey]);
  const onScreen = status?.incoming ?? status?.current;
  const selected =
    states.find((state) => state.id === choice) ??
    states.find((state) => state.id === onScreen?.stateId) ??
    states.find((state) => state.id === requestedStateId) ??
    states.find((state) => state.templateId === activeTemplateId) ??
    states[0];
  const selectedId = selected?.id ?? '';
  useEffect(() => {
    // Seed new views and replace removed states without resetting valid operator choices
    // when snapshots, runtime requests or the number of mounted control views change.
    if (choice !== selectedId) setPreviewSlotSelection(selectionKey, selectedId);
  }, [selectionKey, choice, selectedId]);
  const visible = status?.incoming ?? status?.current ?? status?.outgoing;
  const visibleName = states.find((state) => state.id === visible?.stateId)?.name;
  const pendingName = states.find((state) => state.id === status?.pending?.stateId)?.name;
  const leaving = !!status?.transition && !status.incoming;
  const onAirState = !leaving ? states.find((state) => state.id === onScreen?.stateId) : undefined;
  const statusText = status?.error
    ? 'Error'
    : pendingName
      ? `Preparing · ${pendingName}`
      : status?.transition
        ? `${leaving ? 'Leaving' : 'Changing'}${visibleName ? ` · ${visibleName}` : ''}`
        : visible
          ? `On${visibleName ? ` · ${visibleName}` : ''}`
          : 'Off';
  return (
    <div className="preview-transition-slot" role="group" aria-label={slot.name}>
      <div className="preview-transition-slot-heading">
        <strong title={slot.name}>{slot.name}</strong>
        <small
          role="status"
          data-state={
            status?.error ? 'error' : status?.transition ? 'transition' : visible ? 'on' : 'off'
          }
          title={status?.error || statusText}
        >
          {statusText}
        </small>
      </div>
      <div className="preview-transition-slot-actions">
        <select
          aria-label={`${slot.name} graphic`}
          value={selected?.id ?? ''}
          disabled={disabled || !states.length}
          onChange={(event) => setPreviewSlotSelection(selectionKey, event.currentTarget.value)}
        >
          {!states.length && <option value="">No graphics configured</option>}
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Take ${slot.name}`}
          disabled={disabled || !selected}
          title="Show this graphic in the preview using its transition."
          onClick={() => {
            if (selected) onTake(selected.id);
          }}
        >
          Take
        </button>
        <button
          type="button"
          aria-label={`Out ${slot.name}`}
          disabled={disabled || (!visible && !status?.pending)}
          title="Animate this output group out of the preview."
          onClick={onOut}
        >
          Out
        </button>
      </div>
      {onAirState && selected?.id === onAirState.id && customActions.length > 0 && (
        <div
          className="preview-controls-row preview-template-actions"
          aria-label={`${slot.name} template actions`}
        >
          {customActions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={disabled || !visible || leaving}
              onClick={() => onCustomAction(action.id)}
            >
              {action.name || action.id}
            </button>
          ))}
        </div>
      )}
      {source && selected && (
        <SlotDataFields
          key={selected.id}
          source={source}
          definition={definition}
          slotId={slot.id}
          state={selected}
          status={status}
          onAir={selected.id === onAirState?.id}
          disabled={fieldsDisabled}
          action={action}
        />
      )}
      {status?.error && <PreviewError message={status.error} />}
    </div>
  );
}

/** Compact design-preview controls. These commands never address live/MCP output. */
export function PreviewTransitionLogicControls({
  projectSet,
  activeTemplateId,
  dataTemplateId,
  data,
}: {
  projectSet: ProjectSetDocument | null;
  activeTemplateId: string | null;
  dataTemplateId: string | null;
  data: Record<string, FieldValue>;
}) {
  const project = useProjectStore((state) => state.project);
  const draft = useTransitionLogicDraftStore((state) =>
    projectSet ? state.drafts[projectSet.id] : undefined,
  );
  const behavior = useBehaviorPreviewStore();
  const [localError, setLocalError] = useState('');
  const generation = useRef(0);
  const dirty = !!draft && transitionLogicDraftChanged(draft);
  const draftDefinition = dirty ? draft.definition : projectSet?.transitionLogic;
  const conflict =
    !!projectSet &&
    !!draft &&
    dirty &&
    draft.baseline !== transitionLogicFingerprint(projectSet.transitionLogic);
  const latest = useMemo(() => {
    if (!projectSet || !draftDefinition) return { source: null, errors: [] as string[] };
    try {
      const source = transitionLogicEditorSetSnapshot(projectSet, project);
      const errors = transitionLogicEditorErrors(
        source,
        draftDefinition,
        transitionLogicEditorComponents(source, project),
      );
      return { source, errors };
    } catch (cause) {
      return { source: null, errors: [cause instanceof Error ? cause.message : String(cause)] };
    }
  }, [projectSet, project, draftDefinition]);
  const sessionHere = !!behavior.requestId && behavior.sourceSetId === projectSet?.id;
  const definition = sessionHere && behavior.definition ? behavior.definition : draftDefinition;
  const running = sessionHere && !!behavior.snapshot?.loaded && !!behavior.definition;
  const dataSource = (running && behaviorPreviewDataSource()?.source) || latest.source;
  const sourceInvalid = conflict || !draftDefinition || !latest.source || !!latest.errors.length;
  const busy = sessionHere && (behavior.loading || behavior.busy);
  const disabled = busy || (!running && sourceInvalid);
  const fieldsDisabled =
    (sessionHere && (behavior.loading || behavior.structuralBusy)) || (!running && sourceInvalid);
  const paused = running && !!behavior.snapshot?.paused;
  useEffect(() => {
    generation.current += 1;
    setLocalError('');
    return () => {
      generation.current += 1;
    };
  }, [projectSet?.id, activeTemplateId]);
  const action = (operation: () => void | Promise<void>) => {
    const current = ++generation.current;
    setLocalError('');
    void Promise.resolve()
      .then(operation)
      .catch((cause) => {
        if (generation.current === current)
          setLocalError(cause instanceof Error ? cause.message : String(cause));
      });
  };
  if (!projectSet || (!definition && !sessionHere)) return null;
  const take = (slotId: string, stateId: string) => {
    if (disabled) return;
    if (running) {
      action(() => takeBehaviorPreviewSlot(slotId, stateId));
      return;
    }
    const source = latest.source;
    const state = draftDefinition?.states.find(
      (entry) => entry.id === stateId && entry.slotId === slotId,
    );
    if (!source || !draftDefinition || !state || sourceInvalid) return;
    action(() =>
      requestBehaviorPreview({
        projectSet: source,
        definition: draftDefinition,
        stateId: state.id,
        phase: 'in',
        contextStateIds: operatorPreviewContext(draftDefinition, state, activeTemplateId),
        ...(dataTemplateId ? { dataByTemplateId: { [dataTemplateId]: data } } : {}),
        label: `${state.name} enters`,
      }),
    );
  };
  const issue = localError || (sessionHere ? behavior.error : null);
  return (
    <section
      className="preview-transition-controls"
      aria-label="Playout transitions preview controls"
    >
      <div className="preview-transition-heading">
        <h4>Playout transitions</h4>
        <small>{sessionHere ? 'Preview' : dirty ? 'Draft' : 'Ready'}</small>
      </div>
      {behavior.loading && sessionHere && (
        <p className="preview-fullscreen-data-note" role="status">
          Preparing graphics…
        </p>
      )}
      {definition?.slots
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((slot) => (
          <SlotControls
            key={previewSlotSelectionKey(projectSet.id, definition.id, activeTemplateId, slot.id)}
            selectionKey={previewSlotSelectionKey(
              projectSet.id,
              definition.id,
              activeTemplateId,
              slot.id,
            )}
            slot={slot}
            source={dataSource}
            definition={definition}
            states={definition.states.filter((state) => state.slotId === slot.id)}
            status={sessionHere ? behavior.snapshot?.slots[slot.id] : undefined}
            activeTemplateId={activeTemplateId}
            requestedStateId={sessionHere ? behavior.stateId : null}
            disabled={disabled}
            fieldsDisabled={fieldsDisabled}
            onTake={(stateId) => take(slot.id, stateId)}
            onOut={() => action(() => outBehaviorPreviewSlot(slot.id))}
            customActions={sessionHere ? (behavior.templateActions[slot.id] ?? []) : []}
            onCustomAction={(actionId) =>
              action(() => runBehaviorPreviewTemplateAction(slot.id, actionId))
            }
            action={action}
          />
        ))}
      {sessionHere && (
        <div className="preview-controls-row preview-transition-transport">
          <button
            type="button"
            disabled={!running || behavior.loading}
            onClick={() => action(paused ? resumeBehaviorPreview : pauseBehaviorPreview)}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            disabled={busy || sourceInvalid}
            title="Restart the requested behavior using the current draft and template edits."
            onClick={() => action(replayBehaviorPreview)}
          >
            Replay
          </button>
          <button
            type="button"
            disabled={!running || behavior.loading}
            title="Immediately clear all graphics from this preview."
            onClick={() => action(clearBehaviorPreviewOutput)}
          >
            Clear all
          </button>
        </div>
      )}
      {running &&
        behavior.snapshot?.loops?.map((loop) => (
          <div
            className="preview-controls-row preview-transition-transport"
            key={`${loop.slotId}/${loop.groupId}`}
          >
            <small>{loop.name}</small>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                action(() =>
                  controlBehaviorPreviewLoop(
                    loop.slotId,
                    loop.groupId,
                    loop.paused ? 'resume' : 'pause',
                  ),
                )
              }
            >
              {loop.paused ? 'Resume loop' : 'Pause loop'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                action(() => controlBehaviorPreviewLoop(loop.slotId, loop.groupId, 'next'))
              }
            >
              Next headline
            </button>
          </div>
        ))}
      {sessionHere && behavior.sourceChanged && (
        <p className="preview-fullscreen-data-note">
          Source changed. Replay loads the latest draft.
        </p>
      )}
      {conflict ? (
        <p className="preview-transition-error" role="alert">
          The applied definition changed. Resolve the draft conflict in Transitions before starting
          or replaying.
        </p>
      ) : latest.errors.length ? (
        <p className="preview-transition-error" role="alert" title={latest.errors.join('\n')}>
          Resolve {latest.errors.length} {latest.errors.length === 1 ? 'issue' : 'issues'} in
          Transitions before starting or replaying.
        </p>
      ) : sessionHere && !draftDefinition ? (
        <p className="preview-fullscreen-data-note">
          Playout transitions were removed from the draft. The current preview keeps its loaded
          definition.
        </p>
      ) : null}
      {issue && <PreviewError message={issue} />}
    </section>
  );
}
