import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnimationPresetPluginSnapshot,
  TransitionLogicState,
} from '@ograf-editor/scene-model';
import { resolveProjectSetTemplate } from '../state/projectSet';
import {
  inspectTransitionPhaseRule,
  TRANSITION_RULE_TRIGGERS,
  transitionRuleActions,
  upsertTransitionPhaseRule,
} from '../state/transitionRuleAuthoring';
import {
  inspectMakeRoomBehavior,
  makeRoomTargetOptions,
  transitionBehaviorStates,
  upsertMakeRoomBehavior,
  type MakeRoomBehaviorInput,
} from '../state/transitionBehaviors';
import type { TransitionRuleAuthoring } from '../state/useTransitionRuleAuthoring';
import type { TransitionRuleEditorProps } from './TransitionRuleTypes';
import type { TransitionBehaviorPhase } from '../state/transitionBehaviors';
import { RuleEditorItem, RuleEditorSection } from './RuleEditorItem';
import { TransitionBehaviorTiming } from './TransitionBehaviorTiming';
import { behaviorSeconds } from './transitionBehaviorFormatting';
import { TransitionContentAnimationEditor } from './TransitionContentAnimationEditor';
import { pinTransitionAnimationPlugin } from '../state/transitionContentAnimationEditing';
import './CompactTransitionRuleRows.css';

export interface CompactTransitionRuleRowsProps extends TransitionRuleEditorProps {
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  search: string;
  commit: TransitionRuleAuthoring['commit'];
  disabledReason?: string;
}
const transitionRuleRowId = (stateId: string, phase: TransitionBehaviorPhase) =>
  `transition:${stateId}:${phase}`;
function references(props: Pick<TransitionRuleEditorProps, 'projectSet' | 'components'>) {
  return {
    templateIds: props.projectSet.templates.map((entry) => entry.id),
    componentLayers: Object.fromEntries(
      props.components.map((component) => [
        component.id,
        component.layers.map((layer) => layer.id),
      ]),
    ),
  };
}
export function CompactTransitionRuleRows(props: CompactTransitionRuleRowsProps) {
  const template = props.projectSet.templates.find((entry) => entry.id === props.activeTemplateId);
  if (!template) return null;
  const resolved = resolveProjectSetTemplate(props.projectSet, template.id);
  const composition =
    resolved.compositions.find((entry) => entry.id === resolved.mainCompositionId) ??
    resolved.compositions[0];
  const states = transitionBehaviorStates(props.definition, template.id);
  if (!states.length)
    return (
      <p className="rule-editor-note">
        This template has no transition state.{' '}
        <button type="button" onClick={() => props.onShowAdvanced?.('states')}>
          Connect template
        </button>
      </p>
    );
  return (
    <>
      {states.flatMap((state, index) =>
        TRANSITION_RULE_TRIGGERS.map((trigger) => (
          <TransitionRuleRow
            key={transitionRuleRowId(state.id, trigger.phase)}
            {...props}
            state={state}
            phase={trigger.phase}
            frameRate={composition?.frameRate ?? 50}
            templateName={template.name}
            showStateName={states.length > 1}
            focusRequest={index === 0}
          />
        )),
      )}
    </>
  );
}
type RowProps = CompactTransitionRuleRowsProps & {
  state: TransitionLogicState;
  phase: TransitionBehaviorPhase;
  frameRate: number;
  templateName: string;
  showStateName: boolean;
  focusRequest: boolean;
};

function TransitionRuleRow(props: RowProps) {
  const {
    definition,
    state,
    phase,
    frameRate,
    authoringRequest,
    disabled = false,
    disabledReason,
    previewDisabledReason,
    onPreview,
    onShowAdvanced,
    expandedId,
    onExpand,
    search,
    templateName,
    showStateName,
    focusRequest,
    commit,
  } = props;
  const rowId = transitionRuleRowId(state.id, phase);
  const inspection = useMemo(
    () => inspectTransitionPhaseRule(definition, state.id, phase),
    [definition, state.id, phase],
  );
  const stamp = JSON.stringify(definition);
  const [baseline, setBaseline] = useState(stamp);
  const [original, setOriginal] = useState(() => JSON.stringify(inspection.input));
  const [input, setInput] = useState(() => structuredClone(inspection.input));
  const inputRef = useRef(input),
    baselineRef = useRef(baseline),
    originalRef = useRef(original);
  const [actionChoice, setActionChoice] = useState<string>();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState('');
  const [roomDirty, setRoomDirty] = useState(false);
  const [contextChoiceId, setContextChoiceId] = useState<string>();
  const whenRef = useRef<HTMLSelectElement>(null);
  const handledRequestRef = useRef<string | undefined>(undefined);
  const dirty = JSON.stringify(input) !== original;
  const outdated = dirty && baseline !== stamp;
  const requestId = authoringRequest?.id,
    requestedPhase = authoringRequest?.phase;
  const accept = (next: typeof input, nextStamp: string) => {
    inputRef.current = structuredClone(next);
    originalRef.current = JSON.stringify(next);
    baselineRef.current = nextStamp;
    setInput(inputRef.current);
    setOriginal(originalRef.current);
    setBaseline(nextStamp);
    setError('');
  };
  useEffect(() => {
    if (dirty || baseline === stamp) return;
    inputRef.current = structuredClone(inspection.input);
    originalRef.current = JSON.stringify(inspection.input);
    baselineRef.current = stamp;
    setInput(inputRef.current);
    setOriginal(originalRef.current);
    setBaseline(stamp);
    setError('');
  }, [dirty, baseline, stamp, inspection.input]);
  useEffect(() => {
    if (
      !requestId ||
      requestedPhase !== phase ||
      !focusRequest ||
      handledRequestRef.current === requestId
    )
      return;
    handledRequestRef.current = requestId;
    onExpand(rowId);
  }, [requestId, requestedPhase, phase, focusRequest, rowId, onExpand]);
  useEffect(() => {
    if (expandedId !== rowId || !requestId || requestedPhase !== phase || !focusRequest) return;
    whenRef.current?.focus({ preventScroll: true });
    whenRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expandedId, rowId, requestId, requestedPhase, phase, focusRequest]);
  const observes = definition.layoutRules?.filter((rule) => rule.whenSlotId === state.slotId) ?? [];
  const affectedNames = [
    ...new Set(
      observes
        .map((rule) => definition.slots.find((slot) => slot.id === rule.slotId)?.name)
        .filter(Boolean),
    ),
  ];
  const trigger = TRANSITION_RULE_TRIGGERS.find((entry) => entry.phase === phase)!;
  const actions = transitionRuleActions(trigger.value),
    recipe = inspection.recipe,
    layout = recipe?.layoutPhase;
  const sequential =
    !!layout &&
    (phase === 'enter'
      ? layout.startFrame === 0 && layout.durationFrames <= (recipe?.incomingStartFrame ?? 0)
      : phase === 'exit' && layout.startFrame >= (recipe?.outgoingFrames ?? 0));
  const defaultAction =
    observes.length && sequential
      ? phase === 'enter'
        ? 'make-room'
        : 'restore-space'
      : actions[0]!.value;
  const action =
    actions.find((entry) => entry.value === (actionChoice ?? defaultAction)) ?? actions[0]!;
  const affected =
    definition.states.find((entry) => entry.id === contextChoiceId) ??
    definition.states.find((entry) => entry.slotId === observes[0]?.slotId);
  const room =
    action.openMakeRoom && affected
      ? inspectMakeRoomBehavior(definition, state.id, affected.id, frameRate)
      : null;
  const blocked = disabled || outdated || !!inspection.errors.length;
  const roomNeedsSetup = action.openMakeRoom && (!room?.existing || !!room.errors.length);
  const localDirty = dirty || (action.openMakeRoom && roomDirty);
  const timingSummary = `${recipe?.durationFrames ?? 0}f · ${behaviorSeconds(recipe?.durationFrames ?? 0, frameRate)}`;
  const hidden =
    !!search.trim() &&
    ![
      templateName,
      state.name,
      'Playout transitions',
      trigger.label,
      action.label,
      ...affectedNames,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const fields: Array<{
    key: 'incomingFrames' | 'incomingStartFrame' | 'outgoingFrames';
    label: string;
  }> =
    phase === 'enter'
      ? [
          { key: 'incomingStartFrame', label: 'Start after' },
          { key: 'incomingFrames', label: 'Reveal duration' },
        ]
      : phase === 'exit'
        ? [{ key: 'outgoingFrames', label: 'Hide duration' }]
        : [
            { key: 'outgoingFrames', label: 'Hide old content' },
            { key: 'incomingStartFrame', label: 'Reveal starts after' },
            { key: 'incomingFrames', label: 'Reveal new content' },
          ];
  const commitInput = (snapshot?: AnimationPresetPluginSnapshot) => {
    if (JSON.stringify(inputRef.current) === originalRef.current) return;
    if (blocked) {
      setError(disabledReason || 'Resolve the definition changes before editing this timing.');
      return;
    }
    const result = commit(
      (current) =>
        upsertTransitionPhaseRule(
          pinTransitionAnimationPlugin(current, snapshot),
          inputRef.current,
          references(props),
        ),
      { expectedFingerprint: baselineRef.current },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    accept(
      inspectTransitionPhaseRule(result.definition, state.id, phase).input,
      JSON.stringify(result.definition),
    );
  };
  const commitTiming = () => commitInput();
  const preview = () => {
    if (
      JSON.stringify(inputRef.current) !== originalRef.current ||
      localDirty ||
      blocked ||
      roomNeedsSetup ||
      previewDisabledReason
    )
      return;
    const context = [...new Set(observes.map((rule) => rule.slotId))].flatMap((slotId) => {
      const selected =
        definition.states.find(
          (entry) => entry.id === contextChoiceId && entry.slotId === slotId,
        ) ?? definition.states.find((entry) => entry.slotId === slotId);
      return selected ? [selected.id] : [];
    });
    onPreview(phase, state.id, context);
  };
  return (
    <RuleEditorItem
      id={rowId}
      title={trigger.label}
      target={showStateName ? `${templateName} · ${state.name}` : templateName}
      summary={
        <>
          {action.label} · {timingSummary}
        </>
      }
      open={expandedId === rowId}
      onOpenChange={(open) => onExpand(open ? rowId : null)}
      hidden={hidden && expandedId !== rowId}
      dirty={localDirty}
      status={
        error || inspection.errors.length || disabledReason
          ? 'Needs attention'
          : roomNeedsSetup
            ? 'Needs setup'
            : 'Configured'
      }
      preview={{
        onClick: preview,
        disabled: blocked || localDirty || roomNeedsSetup || !!previewDisabledReason,
        label: localDirty
          ? 'Finish editing before previewing'
          : previewDisabledReason || 'Preview in Preview & Export',
      }}
      menu={
        <button type="button" onClick={() => onShowAdvanced?.('transitions')}>
          Advanced transition settings
        </button>
      }
    >
      <div className="rule-editor-form">
        <RuleEditorSection label="WHEN" title="Trigger">
          <div className="rule-editor-inline-field">
            <select
              ref={whenRef}
              value={trigger.value}
              aria-label={`${state.name}: When`}
              onChange={(event) => {
                const next = TRANSITION_RULE_TRIGGERS.find(
                  (entry) => entry.value === event.currentTarget.value,
                );
                if (next) onExpand(transitionRuleRowId(state.id, next.phase));
              }}
            >
              <optgroup label="Playout transitions">
                {TRANSITION_RULE_TRIGGERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </RuleEditorSection>
        <RuleEditorSection label="IF" title="Conditions">
          <div className="rule-editor-inline-field">
            <span
              className="rule-editor-readonly"
              aria-label={`${state.name}: Condition`}
              title="This transition runs whenever the selected template event occurs."
            >
              Always
            </span>
          </div>
        </RuleEditorSection>
        <RuleEditorSection label="THEN" title="Actions">
          <div className="rule-action-step rule-action-step-single">
            <div className="rule-action-step-body">
              <div className="rule-editor-inline-field">
                <select
                  value={action.value}
                  disabled={disabled}
                  aria-label={`${state.name}: Action`}
                  onChange={(event) => {
                    setActionChoice(event.currentTarget.value);
                    setOptionsOpen(true);
                  }}
                >
                  {actions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rule-editor-field">
                <span>Target</span>
                <span className="rule-editor-readonly">
                  {showStateName ? `${templateName} · ${state.name}` : templateName}
                </span>
              </div>
              {disabledReason && (
                <p className="rule-editor-error" role="alert">
                  {disabledReason}
                </p>
              )}
              {outdated && (
                <p className="rule-editor-error" role="alert">
                  Definitions changed. Your timing is retained.{' '}
                  <button type="button" onClick={() => accept(inspection.input, stamp)}>
                    Reload timing
                  </button>
                </p>
              )}
              {error && (
                <p className="rule-editor-error" role="alert">
                  {error}
                </p>
              )}
              {!!inspection.errors.length && (
                <p className="rule-editor-error" role="alert">
                  {inspection.errors[0]}{' '}
                  <button type="button" onClick={() => onShowAdvanced?.('routes')}>
                    Advanced settings
                  </button>
                </p>
              )}
              <details
                className="rule-editor-options"
                open={optionsOpen}
                onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
              >
                <summary>{action.openMakeRoom ? 'Options' : 'Animation & timing'}</summary>
                {phase !== 'update' ? (
                  <div className="rule-editor-content-animation">
                    {phase !== 'exit' && (
                      <TransitionContentAnimationEditor
                        definition={definition}
                        side="in"
                        value={input.incomingAnimation ?? undefined}
                        frames={input.incomingFrames}
                        frameRate={frameRate}
                        disabled={blocked}
                        onChange={(value, snapshot) => {
                          inputRef.current = {
                            ...inputRef.current,
                            incomingAnimation: value ?? null,
                          };
                          setInput(inputRef.current);
                          commitInput(snapshot);
                        }}
                      />
                    )}
                    {phase !== 'enter' && (
                      <TransitionContentAnimationEditor
                        definition={definition}
                        side="out"
                        value={input.outgoingAnimation ?? undefined}
                        frames={input.outgoingFrames}
                        frameRate={frameRate}
                        disabled={blocked}
                        onChange={(value, snapshot) => {
                          inputRef.current = {
                            ...inputRef.current,
                            outgoingAnimation: value ?? null,
                          };
                          setInput(inputRef.current);
                          commitInput(snapshot);
                        }}
                      />
                    )}
                    <p className="rule-editor-note">
                      Applies to whole template content. Shared objects keep their morph; template
                      layer tracks are unchanged.
                    </p>
                  </div>
                ) : (
                  <p className="rule-editor-note">
                    Data updates stay on air and use the update crossfade without replaying entrance
                    or exit animations.
                  </p>
                )}
                <div hidden={action.openMakeRoom} className="rule-editor-timing">
                  {fields.map(({ key, label }) => (
                    <label className="rule-editor-field" key={key}>
                      <span>{label}</span>
                      <span className="transition-rule-value">
                        <input
                          type="number"
                          min={0}
                          max={86400000}
                          step={1}
                          value={input[key]}
                          disabled={blocked}
                          aria-label={`${state.name} ${trigger.label}: ${label}`}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            if (!Number.isFinite(value)) return;
                            inputRef.current = {
                              ...inputRef.current,
                              [key]: Math.max(0, Math.min(86400000, Math.round(value))),
                            };
                            setInput(inputRef.current);
                            setError('');
                          }}
                          onBlur={commitTiming}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitTiming();
                            }
                          }}
                        />
                        <span>f</span>
                        <small>{behaviorSeconds(input[key], frameRate)}</small>
                      </span>
                    </label>
                  ))}
                  <p className="rule-editor-note">
                    Shared movement, layout timing, easing and holds are preserved.
                  </p>
                  {!!affectedNames.length && phase !== 'update' && (
                    <p className="rule-editor-note">
                      Also {phase === 'enter' ? 'makes room in' : 'restores space in'}{' '}
                      {affectedNames.join(', ')}.
                    </p>
                  )}
                </div>
                {phase !== 'update' && (
                  <div hidden={!action.openMakeRoom}>
                    <MakeRoomRuleOptions
                      {...props}
                      onDirtyChange={setRoomDirty}
                      onAffectedChange={setContextChoiceId}
                    />
                  </div>
                )}
              </details>
            </div>
          </div>
        </RuleEditorSection>
      </div>
    </RuleEditorItem>
  );
}

function MakeRoomRuleOptions(
  props: RowProps & {
    onDirtyChange: (dirty: boolean) => void;
    onAffectedChange: (stateId: string) => void;
  },
) {
  const { definition, state, onAffectedChange } = props;
  const [pendingEdit, setPendingEdit] = useState(false);
  const reportDirty = props.onDirtyChange;
  const changed = useCallback(
    (dirty: boolean) => {
      setPendingEdit(dirty);
      reportDirty(dirty);
    },
    [reportDirty],
  );
  const observedSlot = definition.layoutRules?.find(
    (rule) => rule.whenSlotId === state.slotId,
  )?.slotId;
  const choices = definition.states.filter((candidate) => candidate.id !== state.id);
  const [affectedId, setAffectedId] = useState(
    () =>
      choices.find((candidate) => candidate.slotId === observedSlot)?.id ??
      choices.find((candidate) => candidate.slotId !== state.slotId)?.id ??
      choices[0]?.id ??
      '',
  );
  const affected = choices.find((candidate) => candidate.id === affectedId);
  useEffect(() => {
    if (affected) onAffectedChange(affected.id);
  }, [affected, onAffectedChange]);
  return (
    <div className="transition-rule-layout">
      <label className="rule-editor-field">
        <span>Make room in</span>
        <select
          value={affectedId}
          disabled={props.disabled || pendingEdit}
          onChange={(event) => setAffectedId(event.currentTarget.value)}
        >
          {!affected && <option value="">Choose a template</option>}
          {choices.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      {pendingEdit && (
        <p className="rule-editor-note">
          Finish or reload this layout edit before choosing another template.
        </p>
      )}
      {affected && (
        <MakeRoomRuleForm
          key={affected.id}
          {...props}
          affected={affected}
          onDirtyChange={changed}
        />
      )}
    </div>
  );
}

function MakeRoomRuleForm(
  props: RowProps & { affected: TransitionLogicState; onDirtyChange: (dirty: boolean) => void },
) {
  const {
    definition,
    state,
    affected,
    frameRate,
    disabled,
    disabledReason,
    commit,
    components,
    onShowAdvanced,
    onDirtyChange,
  } = props;
  const inspection = useMemo(
    () => inspectMakeRoomBehavior(definition, state.id, affected.id, frameRate),
    [definition, state.id, affected.id, frameRate],
  );
  const stamp = JSON.stringify(definition);
  const [baseline, setBaseline] = useState(stamp),
    [original, setOriginal] = useState(() => JSON.stringify(inspection.input));
  const [input, setInput] = useState(() => structuredClone(inspection.input));
  const inputRef = useRef(input),
    baselineRef = useRef(baseline),
    originalRef = useRef(original);
  const [error, setError] = useState('');
  const [distance, setDistance] = useState(() =>
    Math.abs(
      input.offsets.find(
        (offset) => (offset.property === 'height' || offset.property === 'y') && offset.value < 0,
      )?.value ?? 62,
    ),
  );
  const targets = useMemo(
    () => makeRoomTargetOptions(definition, components, affected.id),
    [definition, components, affected.id],
  );
  const dirty = JSON.stringify(input) !== original,
    outdated = dirty && baseline !== stamp;
  const blocked = disabled || outdated || !!inspection.errors.length;
  const accept = (next: MakeRoomBehaviorInput, nextStamp: string) => {
    inputRef.current = structuredClone(next);
    originalRef.current = JSON.stringify(next);
    baselineRef.current = nextStamp;
    setInput(inputRef.current);
    setOriginal(originalRef.current);
    setBaseline(nextStamp);
    setDistance(
      Math.abs(
        next.offsets.find(
          (offset) => (offset.property === 'height' || offset.property === 'y') && offset.value < 0,
        )?.value ?? 62,
      ),
    );
    setError('');
  };
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (dirty || baseline === stamp) return;
    inputRef.current = structuredClone(inspection.input);
    originalRef.current = JSON.stringify(inspection.input);
    baselineRef.current = stamp;
    setInput(inputRef.current);
    setOriginal(originalRef.current);
    setBaseline(stamp);
    setDistance(
      Math.abs(
        inspection.input.offsets.find(
          (offset) => (offset.property === 'height' || offset.property === 'y') && offset.value < 0,
        )?.value ?? 62,
      ),
    );
    setError('');
  }, [dirty, baseline, stamp, inspection.input]);
  const commitLayout = () => {
    if (JSON.stringify(inputRef.current) === originalRef.current) return;
    if (blocked) {
      setError(disabledReason || 'Resolve the definition changes before editing this layout.');
      return;
    }
    const result = commit(
      (current) => upsertMakeRoomBehavior(current, inputRef.current, references(props)),
      { expectedFingerprint: baselineRef.current },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    accept(
      inspectMakeRoomBehavior(result.definition, state.id, affected.id, frameRate).input,
      JSON.stringify(result.definition),
    );
  };
  const change = (next: MakeRoomBehaviorInput, immediate = false) => {
    inputRef.current = next;
    setInput(next);
    setError('');
    if (immediate) commitLayout();
  };
  const sameTarget = (a: MakeRoomBehaviorInput['offsets'][number], b: (typeof targets)[number]) =>
    a.instanceId === b.instanceId &&
    a.sourceLayerId === b.sourceLayerId &&
    a.property === b.property;
  return (
    <div
      className="transition-rule-layout-fields"
      onBlur={commitLayout}
      onPointerUp={(event) => {
        if ((event.target as HTMLElement).getAttribute('type') === 'range') commitLayout();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
          commitLayout();
        }
      }}
    >
      {outdated && (
        <p className="rule-editor-error" role="alert">
          Definitions changed. Your layout edit is retained.{' '}
          <button type="button" onClick={() => accept(inspection.input, stamp)}>
            Reload layout
          </button>
        </p>
      )}
      {error && (
        <p className="rule-editor-error" role="alert">
          {error}{' '}
          {dirty && !outdated && (
            <button type="button" onClick={() => accept(inspection.input, stamp)}>
              Reload layout
            </button>
          )}
        </p>
      )}
      {!!inspection.errors.length && (
        <p className="rule-editor-error" role="alert">
          {inspection.errors.join(' ')}
        </p>
      )}
      {inspection.separationMessage && (
        <p className="rule-editor-note">{inspection.separationMessage}</p>
      )}
      {!targets.length ? (
        <p className="rule-editor-note">
          Add the persistent elements that should move.{' '}
          <button type="button" onClick={() => onShowAdvanced?.('shared')}>
            Shared scene settings
          </button>
        </p>
      ) : (
        <>
          <label className="rule-editor-field">
            <span>Space to make</span>
            <span className="transition-rule-value">
              <input
                type="number"
                value={distance}
                min={1}
                max={100000}
                step={1}
                disabled={blocked}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  const next = Math.max(1, Math.min(100000, value));
                  setDistance(next);
                  change({
                    ...inputRef.current,
                    offsets: inputRef.current.offsets.map((offset) =>
                      (offset.property === 'height' || offset.property === 'y') && offset.value < 0
                        ? { ...offset, value: -next }
                        : offset,
                    ),
                  });
                }}
              />
              <span>px</span>
            </span>
          </label>
          <fieldset className="transition-rule-targets" disabled={blocked}>
            <legend>Elements</legend>
            {targets
              .filter((target) => target.property === 'height' || target.property === 'y')
              .map((target) => {
                const offset = input.offsets.find((entry) => sameTarget(entry, target));
                const label =
                  target.property === 'height'
                    ? offset && offset.value > 0
                      ? 'Grow'
                      : 'Shorten'
                    : offset && offset.value > 0
                      ? 'Move down'
                      : 'Move up';
                return (
                  <label key={target.key}>
                    <input
                      type="checkbox"
                      checked={!!offset}
                      onChange={(event) =>
                        change(
                          {
                            ...inputRef.current,
                            offsets: event.currentTarget.checked
                              ? [
                                  ...inputRef.current.offsets.filter(
                                    (entry) => !sameTarget(entry, target),
                                  ),
                                  {
                                    instanceId: target.instanceId,
                                    sourceLayerId: target.sourceLayerId,
                                    property: target.property,
                                    value: -distance,
                                  },
                                ]
                              : inputRef.current.offsets.filter(
                                  (entry) => !sameTarget(entry, target),
                                ),
                          },
                          true,
                        )
                      }
                    />
                    <span>
                      {label} {target.instanceName} / {target.layerName}
                      {offset ? ` (${offset.value}px)` : ''}
                    </span>
                  </label>
                );
              })}
          </fieldset>
          {input.offsets.some(
            (offset) => offset.property === 'x' || offset.property === 'width' || offset.value > 0,
          ) && (
            <p className="rule-editor-note">
              Other authored layout offsets are preserved. Edit them in advanced shared scene
              settings.
            </p>
          )}
        </>
      )}
      <TransitionBehaviorTiming
        title="Enter timing"
        frameRate={frameRate}
        disabled={blocked}
        minimumTotalFrames={inspection.preservedTiming.enter.sharedFrames}
        tailFrames={inspection.preservedTiming.enter.tailFrames}
        phases={[
          {
            key: 'layoutFrames',
            label: 'Make room',
            frames: input.enter.layoutFrames,
            kind: 'layout',
          },
          { key: 'gapFrames', label: 'Wait', frames: input.enter.gapFrames, kind: 'wait' },
          { key: 'inFrames', label: 'Reveal', frames: input.enter.inFrames, kind: 'content' },
        ]}
        onChange={(key, frames) =>
          change({ ...inputRef.current, enter: { ...inputRef.current.enter, [key]: frames } })
        }
      />
      <TransitionBehaviorTiming
        title="Leave timing"
        frameRate={frameRate}
        disabled={blocked}
        minimumTotalFrames={inspection.preservedTiming.exit.sharedFrames}
        tailFrames={inspection.preservedTiming.exit.tailFrames}
        phases={[
          { key: 'outFrames', label: 'Hide', frames: input.exit.outFrames, kind: 'content' },
          { key: 'gapFrames', label: 'Wait', frames: input.exit.gapFrames, kind: 'wait' },
          {
            key: 'layoutFrames',
            label: 'Restore room',
            frames: input.exit.layoutFrames,
            kind: 'layout',
          },
        ]}
        onChange={(key, frames) =>
          change({ ...inputRef.current, exit: { ...inputRef.current.exit, [key]: frames } })
        }
      />
      <p className="rule-editor-note">
        Timing uses whole frames at {frameRate} fps. Changes apply when you finish a field.
      </p>
    </div>
  );
}
