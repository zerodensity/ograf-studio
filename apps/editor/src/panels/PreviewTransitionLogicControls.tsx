import { useEffect, useMemo, useRef, useState } from 'react';
import { compileCustomActions, publicFieldValueForExport } from '@ograf-editor/codegen';
import type { CoordinatedPlayoutSlot, OGrafManifest } from '@ograf-editor/ograf-types';
import {
  fieldExposedToOgraf,
  type Composition,
  type FieldValue,
  type TransitionLogicDefinition,
  type TransitionLogicState,
} from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from '../state/projectSet';
import {
  sharedSlotDataKey,
  stageSharedPreviewSlotField,
  type SharedTransitionPlayoutSession,
} from '../state/playoutControlsStore';
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
  acknowledgePreviewSlotFields,
  cachedPreviewSlotRuntimeData,
  observePreviewSlotValues,
  previewSlotComposition,
  previewSlotDataKey,
  resolvePreviewSlotForm,
  usePreviewSlotDataStore,
} from '../state/previewSlotDataStore';
import { resolvePreviewDataRecord, resolveStatePresetPreviewData } from '../state/previewData';
import { PreviewDataFields } from './PreviewDataFields';

type SlotFieldChange = (stateId: string, field: string, value: FieldValue) => void;

function SlotDataFields({
  source,
  definition,
  slotId,
  state,
  status,
  onAir,
  disabled,
  action,
  onChange,
}: {
  source: ProjectSetDocument;
  definition: TransitionLogicDefinition;
  slotId: string;
  state: TransitionLogicState;
  status?: CoordinatedPlayoutSlot;
  onAir: boolean;
  disabled: boolean;
  action: (operation: () => void | Promise<void>) => void;
  onChange?: SlotFieldChange;
}) {
  // This component is keyed by the selected state. Switching reveals the new form,
  // while ordinary runtime snapshots keep its disclosure and focused controls intact.
  const [expanded, setExpanded] = useState(true);
  const key = onChange
    ? sharedSlotDataKey(source, definition, state)
    : previewSlotDataKey(source.id, definition.id, slotId, state.id, state.templateId);
  const draft = usePreviewSlotDataStore((store) => store.drafts[key]);
  const observed = usePreviewSlotDataStore((store) => store.observed[key]);
  const shared = Boolean(onChange);
  const incomingId = status?.incoming?.stateId;
  const currentId = status?.current?.stateId;
  const outgoingId = status?.outgoing?.stateId;
  const form = useMemo(
    () => {
      if (!shared) return resolvePreviewSlotForm(source, definition, state.id, status, draft);
      const resolved = previewSlotComposition(source, definition, state.id);
      if (!resolved) return null;
      const fields = resolved.composition.dataFields.filter(fieldExposedToOgraf);
      const selection = status?.incoming ?? status?.current ?? status?.outgoing;
      const values =
        selection?.stateId === state.id
          ? cachedPreviewSlotRuntimeData(resolved.composition, state.id, selection.data)
          : (observed ?? resolveStatePresetPreviewData(resolved.composition, state.dataDefaults));
      return {
        fields,
        values: Object.fromEntries(
          fields.map((field) => [
            field.key,
            publicFieldValueForExport(
              field,
              Object.hasOwn(draft ?? {}, field.key) ? draft![field.key]! : values[field.key]!,
            ),
          ]),
        ),
      };
    },
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
      shared,
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
            if (disabled) return;
            if (onChange) onChange(state.id, fieldKey, value);
            else
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
  onFieldChange,
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
  onFieldChange?: SlotFieldChange;
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
          onChange={onFieldChange}
        />
      )}
      {status?.error && <PreviewError message={status.error} />}
    </div>
  );
}

interface PreviewTransitionLogicControlsProps {
  projectSet: ProjectSetDocument | null;
  activeTemplateId: string | null;
  dataTemplateId: string | null;
  data: Record<string, FieldValue>;
  shared?: SharedTransitionPlayoutSession;
}

export function PreviewTransitionLogicControls(props: PreviewTransitionLogicControlsProps) {
  const { shared, projectSet, activeTemplateId } = props;
  if (!shared) return <LocalTransitionLogicControls {...props} />;
  const source = shared.source ?? projectSet;
  if (!source?.transitionLogic) return null;
  return (
    <SharedTransitionLogicControls
      source={source}
      definition={source.transitionLogic}
      activeTemplateId={activeTemplateId}
      session={shared}
    />
  );
}

const pendingSharedSlotEdits = new WeakMap<
  ProjectSetDocument,
  Map<string, ReturnType<typeof setTimeout>>
>();
const compiledSharedSlotActions = new WeakMap<
  Composition,
  ReturnType<typeof compileCustomActions>
>();

function sharedSlotPatch(
  source: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  state: TransitionLogicState,
) {
  const key = sharedSlotDataKey(source, definition, state);
  const draft = usePreviewSlotDataStore.getState().drafts[key];
  const resolved = previewSlotComposition(source, definition, state.id);
  if (!draft || !resolved) return { key, draft: {}, data: {} };
  const values = resolvePreviewDataRecord(resolved.composition, draft);
  const data = Object.fromEntries(
    resolved.composition.dataFields
      .filter((field) => Object.hasOwn(draft, field.key) && fieldExposedToOgraf(field))
      .map((field) => [field.key, publicFieldValueForExport(field, values[field.key]!)]),
  );
  return { key, draft, data };
}

function laneActionIds(
  manifest: Pick<OGrafManifest, 'customActions'>,
  slotId: string,
): Set<string> {
  const schema = manifest.customActions?.find((action) => action.id === 'template.action')?.schema;
  const rules = schema?.allOf as
    | Array<{
        if?: { properties?: { slotId?: { const?: string } } };
        then?: { properties?: { actionId?: { enum?: string[] } } };
      }>
    | undefined;
  const laneRule = rules?.find((rule) => rule.if?.properties?.slotId?.const === slotId);
  return new Set(laneRule?.then?.properties?.actionId?.enum);
}

function SharedTransitionLogicControls({
  source,
  definition,
  activeTemplateId,
  session,
}: {
  source: ProjectSetDocument;
  definition: TransitionLogicDefinition;
  activeTemplateId: string | null;
  session: SharedTransitionPlayoutSession;
}) {
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latest = useRef(session);
  latest.current = session;
  useEffect(() => {
    setError('');
    return () => {
      generation.current += 1;
    };
  }, [source]);

  useEffect(() => {
    for (const [slotId, slot] of Object.entries(session.snapshot?.slots ?? {})) {
      const selection = slot.incoming ?? slot.current;
      if (!selection || (slot.transition && !slot.incoming)) continue;
      const resolved = previewSlotComposition(source, definition, selection.stateId);
      if (!resolved || resolved.state.slotId !== slotId) continue;
      const key = sharedSlotDataKey(source, definition, resolved.state);
      const values = cachedPreviewSlotRuntimeData(
        resolved.composition,
        selection.stateId,
        selection.data,
      );
      observePreviewSlotValues(key, values);
    }
  }, [source, definition, session.snapshot]);

  const action = (operation: () => void | Promise<void>) => {
    const current = ++generation.current;
    setError('');
    void Promise.resolve()
      .then(operation)
      .catch((cause) => {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
  };
  const send = async (id: string, payload?: Record<string, unknown>) => {
    const result = await latest.current.sendAction(id, payload);
    if (!result) return false;
    if (result.statusCode >= 400)
      throw new Error(result.statusMessage || `Playout command failed (${result.statusCode}).`);
    return true;
  };
  const onAir = (state: TransitionLogicState) => {
    const slot = latest.current.snapshot?.slots[state.slotId];
    return (
      (slot?.incoming ?? slot?.current)?.stateId === state.id &&
      (!slot?.transition || Boolean(slot.incoming))
    );
  };
  const take = (state: TransitionLogicState) =>
    action(async () => {
      const { key, draft, data } = sharedSlotPatch(source, definition, state);
      if (
        await send('transition.take', {
          slotId: state.slotId,
          stateId: state.id,
          ...(Object.keys(data).length ? { data } : {}),
        })
      )
        acknowledgePreviewSlotFields(key, draft);
    });
  const edit = (stateId: string, field: string, value: FieldValue) => {
    const state = definition.states.find((entry) => entry.id === stateId);
    if (!state) return;
    stageSharedPreviewSlotField(source, definition, state, field, value);
    if (!onAir(state)) return;
    let pending = pendingSharedSlotEdits.get(source);
    if (!pending) {
      pending = new Map();
      pendingSharedSlotEdits.set(source, pending);
    }
    const edits = pending;
    clearTimeout(edits.get(stateId));
    edits.set(
      stateId,
      setTimeout(() => {
        edits.delete(stateId);
        if (!latest.current.ready || !onAir(state)) return;
        action(async () => {
          const { key, draft, data } = sharedSlotPatch(source, definition, state);
          if (
            Object.keys(data).length &&
            (await send('transition.patch', { slotId: state.slotId, stateId, data }))
          )
            acknowledgePreviewSlotFields(key, draft);
        });
      }, 120),
    );
  };
  const snapshot = session.snapshot;
  const disabled = !session.ready || !snapshot?.loaded;
  const issue = error || session.error || snapshot?.error;
  const lanes = useMemo(
    () =>
      [...definition.slots]
        .sort((a, b) => a.order - b.order)
        .map((slot) => {
          const allowed = session.manifest && laneActionIds(session.manifest, slot.id);
          const states = definition.states.filter((state) => state.slotId === slot.id);
          return { slot, states, allowed };
        }),
    [definition, session.manifest],
  );
  const run = (id: string, payload?: Record<string, unknown>) =>
    action(async () => {
      await send(id, payload);
    });
  return (
    <section
      className="preview-transition-controls"
      aria-label="Playout transitions preview controls"
    >
      <div className="preview-transition-heading">
        <h4>Playout transitions</h4>
        <small>{disabled ? 'Ready' : 'Preview'}</small>
      </div>
      {disabled && !issue && (
        <p className="preview-fullscreen-data-note" role="status">
          Preparing graphics…
        </p>
      )}
      {lanes.map(({ slot, states, allowed }) => {
        const status = snapshot?.slots[slot.id];
        const selection = status?.incoming ?? status?.current;
        const resolved = selection && previewSlotComposition(source, definition, selection.stateId);
        let actions = resolved && compiledSharedSlotActions.get(resolved.composition);
        if (resolved && !actions) {
          actions = compileCustomActions(resolved.composition);
          compiledSharedSlotActions.set(resolved.composition, actions);
        }
        const key = previewSlotSelectionKey(source.id, definition.id, activeTemplateId, slot.id);
        return (
          <SlotControls
            key={key}
            selectionKey={key}
            slot={slot}
            source={source}
            definition={definition}
            states={states}
            status={status}
            activeTemplateId={activeTemplateId}
            requestedStateId={null}
            disabled={disabled}
            fieldsDisabled={disabled}
            onTake={(stateId) => {
              const state = states.find((entry) => entry.id === stateId);
              if (state) take(state);
            }}
            onOut={() => run('transition.out', { slotId: slot.id })}
            customActions={
              (allowed ? actions?.filter((item) => allowed.has(item.id)) : actions) ?? []
            }
            onCustomAction={(actionId) => run('template.action', { slotId: slot.id, actionId })}
            action={action}
            onFieldChange={edit}
          />
        );
      })}
      <div className="preview-controls-row preview-transition-transport">
        <button
          type="button"
          disabled={disabled}
          title="Immediately clear all graphics from this preview."
          onClick={() => run('transition.clear', {})}
        >
          Clear all
        </button>
      </div>
      {snapshot?.loops?.map((loop) => {
        const payload = { slotId: loop.slotId, groupId: loop.groupId };
        return (
          <div
            className="preview-controls-row preview-transition-transport"
            key={`${loop.slotId}/${loop.groupId}`}
          >
            <small>{loop.name}</small>
            <button
              type="button"
              disabled={disabled}
              onClick={() => run(loop.paused ? 'loop.resume' : 'loop.pause', payload)}
            >
              {loop.paused ? 'Resume loop' : 'Pause loop'}
            </button>
            <button type="button" disabled={disabled} onClick={() => run('loop.next', payload)}>
              Next headline
            </button>
          </div>
        );
      })}
      {issue && <PreviewError message={issue} />}
    </section>
  );
}

/** Draft rehearsals keep their own isolated coordinator. */
function LocalTransitionLogicControls({
  projectSet,
  activeTemplateId,
  dataTemplateId,
  data,
}: PreviewTransitionLogicControlsProps) {
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
