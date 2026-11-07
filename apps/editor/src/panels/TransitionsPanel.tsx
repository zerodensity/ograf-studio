import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  ComponentDefinition,
  TransitionLogicDefinition,
  TransitionLogicRecipe,
  TransitionLogicReferences,
  TransitionLogicSlot,
} from '@ograf-editor/scene-model';
import { resolveProjectSetTemplate, type ProjectSetDocument } from '../state/projectSet';
import { createTemplateThumbnail } from '../state/templateThumbnail';
import {
  createPreviewThumbnailQueue,
  observePreviewThumbnailUrl,
} from '../state/previewThumbnailQueue';
import {
  addLayer,
  addTemplateToLayer,
  elementOwner,
  holdFrames,
  layerRemovalBlocker,
  layerParentOptions,
  layerStates,
  layersTopFirst,
  moveLayer,
  moveTemplateToLayer,
  phaseEnd,
  removeElement,
  removeLayer,
  removeTemplateFromLayer,
  renameLayer,
  setLayerParent,
  setLayerUpdateMode,
  setTemplateTakeOutSlots,
  templateTakeOutOptions,
  type ChoreographyPhase,
  type TemplateLookup,
  type TimingPatch,
} from '../state/transitionChoreography';
import {
  addLaneElement,
  applyCellTiming,
  applyTemplateValues,
  applyRoom,
  buildPlayoutSetup,
  cellElementMotions,
  cellPhase,
  cellTiming,
  elementDriftChecks,
  keepElementValues,
  LANE_UPDATE_MODES,
  layoutChecks,
  defaultShow,
  showEndsOnAir,
  showPlan,
  type ShowStep,
  landingBoxes,
  setLanding,
  laneCells,
  makeCellCustom,
  motionFrames,
  overlapWithLayout,
  propertyLabel,
  proposeLanes,
  resetCell,
  roomSetting,
  sameCell,
  speedFrames,
  speedOf,
  STAGE_LEAD_FRAMES,
  stageLength,
  stageSchedule,
  stylePatch,
  styleOf,
  templateLayouts,
  templateLookup,
  transitionChecks,
  transitionReferences,
  TRANSITION_FEELS,
  TRANSITION_SPEEDS,
  TRANSITION_STYLES,
  type LaneProposal,
  type TemplateLayout,
  type TransitionCell,
  type TransitionCheck,
  type TransitionSpeed,
  type TransitionStyle,
} from '../state/transitionsDesign';
import {
  useTransitionRuleAuthoring,
  type TransitionRuleAuthoring,
} from '../state/useTransitionRuleAuthoring';
import { useTransitionStage, type TransitionStage } from '../state/useTransitionStage';
import { Panel } from './Panel';
import { StageHandles } from './StageHandles';
import { TransitionLaneConditions } from './TransitionLaneConditions';
import { TransitionLaneList } from './TransitionLaneList';
import { activeTransitionLane } from '../state/transitionLaneSelection';
import { TransitionsToolbar, TurnOffPlayout } from './TransitionsToolbar';
import { useTransitionsFocusStore } from '../state/transitionsFocusStore';
import { applyLandingMove, moveElementInTemplate } from '../state/transitionsLanding';
import { TransitionResizeEditor } from './TransitionResizeEditor';
import { TransitionContentAnimationEditor } from './TransitionContentAnimationEditor';
import { pinTransitionAnimationPlugin } from '../state/transitionContentAnimationEditing';
import { setResizeTiming } from '../state/transitionResizeTiming';
import {
  applyResize,
  RESIZE_ANCHORS,
  readResizeSetting,
  resizeAnchorFraction,
  resizeTargets,
} from '../state/transitionResize';
import './TransitionsPanel.css';

type View =
  | { kind: 'map' }
  | { kind: 'stage'; cell: TransitionCell }
  | { kind: 'together'; triggerSlotId: string; affectedSlotId: string }
  | { kind: 'show' };

interface Model {
  definition: TransitionLogicDefinition;
  snapshot: ProjectSetDocument;
  components: ComponentDefinition[];
  references: TransitionLogicReferences;
  layouts: Map<string, TemplateLayout>;
  templates: TemplateLookup;
  frameRate: number;
  locked?: string;
  run: (update: (definition: TransitionLogicDefinition) => TransitionLogicDefinition) => boolean;
  /** Show (or clear) an error for edits that don't go through run. */
  report: (message: string) => void;
  stateName: (stateId: string | null) => string;
}

const PHASE_LABELS: Record<ChoreographyPhase, string> = {
  enter: 'Take in',
  update: 'Update',
  switch: 'Switch',
  exit: 'Take out',
};

function seconds(frames: number, frameRate: number) {
  return `${(frames / frameRate).toFixed(2)} s`;
}

function styleLabel(style: TransitionStyle) {
  return TRANSITION_STYLES.find((entry) => entry.style === style)!.label;
}

function speedLabel(speed: TransitionSpeed | null) {
  return speed ? TRANSITION_SPEEDS.find((entry) => entry.speed === speed)!.label : 'Custom';
}

function cellTitle(model: Model, cell: TransitionCell) {
  return `${model.stateName(cell.from)} → ${model.stateName(cell.to)}`;
}

/* Thumbnails: rendered once per template revision, one at a time. */

const thumbnails = createPreviewThumbnailQueue<Blob>();

function useTemplateThumbnail(snapshot: ProjectSetDocument, templateId: string): string | null {
  const template = snapshot.templates.find((entry) => entry.id === templateId);
  const [thumbnail, setThumbnail] = useState<{ template: object; url: string } | null>(null);
  useEffect(() => {
    if (!template) return;
    const lease = thumbnails.acquire(template, () =>
      createTemplateThumbnail(resolveProjectSetTemplate(snapshot, templateId)),
    );
    return observePreviewThumbnailUrl(lease, (url) => setThumbnail({ template, url }));
  }, [snapshot, template, templateId]);
  return thumbnail && thumbnail.template === template ? thumbnail.url : null;
}

/* Small shared pieces */

function MiniBars({ recipe, phase }: { recipe: TransitionLogicRecipe; phase: ChoreographyPhase }) {
  const total = Math.max(1, phaseEnd(recipe) + holdFrames(recipe));
  const bar = (start: number, length: number) => ({
    left: `${(start / total) * 100}%`,
    width: `${Math.max(length ? 3 : 0, (length / total) * 100)}%`,
  });
  return (
    <span className="tr-minibars" aria-hidden="true">
      {phase !== 'enter' && <i className="is-out" style={bar(0, recipe.outgoingFrames)} />}
      {phase !== 'exit' && (
        <i className="is-in" style={bar(recipe.incomingStartFrame, recipe.incomingFrames)} />
      )}
      <i className="is-shared" style={bar(0, recipe.sharedFrames)} />
      {recipe.layoutPhase && (
        <i
          className="is-room"
          style={bar(recipe.layoutPhase.startFrame, recipe.layoutPhase.durationFrames)}
        />
      )}
    </span>
  );
}

function FrameField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isSafeInteger(next) && next >= 0 && next !== value) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <label className="tr-frame-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(String(value));
        }}
      />
      <small>f</small>
    </label>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  value: T | null;
  disabled?: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div className="tr-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.hint}
          disabled={disabled}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* Map */

function TemplateTile({
  model,
  slot,
  stateId,
}: {
  model: Model;
  slot: TransitionLogicSlot;
  stateId: string;
}) {
  const state = model.definition.states.find((entry) => entry.id === stateId)!;
  const url = useTemplateThumbnail(model.snapshot, state.templateId);
  const others = model.definition.slots.filter((entry) => entry.id !== slot.id);
  const takeoverOptions = templateTakeOutOptions(model.definition, stateId);
  return (
    <figure className="tr-template">
      <div className="tr-template-thumb">
        {url ? (
          <img src={url} alt="" />
        ) : (
          <span className="tr-template-placeholder">Rendering…</span>
        )}
      </div>
      <figcaption>
        <span title={state.name}>{state.name}</span>
        <select
          aria-label={`Move or remove ${state.name}`}
          title="Move to another lane or remove"
          value=""
          disabled={!!model.locked}
          onChange={(event) => {
            const choice = event.currentTarget.value;
            if (choice === 'remove')
              model.run((definition) =>
                removeTemplateFromLayer(definition, state.id, model.references),
              );
            else if (choice)
              model.run((definition) =>
                moveTemplateToLayer(
                  definition,
                  state.id,
                  choice,
                  model.references,
                  model.templates,
                ),
              );
          }}
        >
          <option value="">⋯</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              Move to {other.name}
            </option>
          ))}
          <option value="remove">Remove from playout</option>
        </select>
      </figcaption>
      {!!takeoverOptions.length && (
        <details className="tr-template-takeover">
          <summary>
            Take out before entering
            {!!state.takeOutSlotIds?.length && <strong>{state.takeOutSlotIds.length}</strong>}
          </summary>
          <div className="tr-template-takeover-options">
            {takeoverOptions.map((other) => (
              <label key={other.id}>
                <input
                  type="checkbox"
                  aria-label={`Before ${state.name} enters, take ${other.name} out`}
                  checked={state.takeOutSlotIds?.includes(other.id) ?? false}
                  disabled={!!model.locked}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    model.run((definition) => {
                      const current = definition.states.find((entry) => entry.id === stateId);
                      const slots = current?.takeOutSlotIds ?? [];
                      return setTemplateTakeOutSlots(
                        definition,
                        stateId,
                        checked ? [...slots, other.id] : slots.filter((id) => id !== other.id),
                        model.references,
                      );
                    });
                  }}
                />
                <span>{other.name}</span>
              </label>
            ))}
            <p>Waits for their Take out to finish. Leaving this template keeps them Off.</p>
          </div>
        </details>
      )}
    </figure>
  );
}

function CellButton({
  model,
  cell,
  selected,
  onSelect,
  onOpen,
}: {
  model: Model;
  cell: TransitionCell;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const timing = cellTiming(model.definition, cell);
  const recipe = timing.recipe;
  const style = recipe ? styleOf(recipe, timing.phase) : null;
  const speed = recipe ? speedOf(recipe, timing.phase, model.frameRate) : null;
  const time = recipe ? seconds(motionFrames(recipe, timing.phase), model.frameRate) : '';
  return (
    <button
      type="button"
      className={`tr-cell${selected ? ' is-selected' : ''}${timing.custom ? ' is-custom' : ''}${recipe ? '' : ' is-broken'}`}
      aria-pressed={selected}
      aria-label={`${cellTitle(model, cell)}: ${PHASE_LABELS[timing.phase]}, ${
        recipe ? `${styleLabel(style!)}, ${speedLabel(speed)}, ${time}` : timing.issue
      }${timing.custom ? ', custom' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="tr-cell-head">
        <span>{PHASE_LABELS[timing.phase]}</span>
        {timing.custom && <span className="tr-badge">Custom</span>}
      </span>
      {recipe ? (
        <>
          <strong>{styleLabel(style!)}</strong>
          <MiniBars recipe={recipe} phase={timing.phase} />
          <span className="tr-cell-time">
            {speedLabel(speed)} · {time}
          </span>
        </>
      ) : (
        <span className="tr-cell-issue">{timing.issue}</span>
      )}
    </button>
  );
}

function LaneGrid({
  model,
  slot,
  selected,
  onSelect,
  onOpen,
}: {
  model: Model;
  slot: TransitionLogicSlot;
  selected: TransitionCell | null;
  onSelect: (cell: TransitionCell) => void;
  onOpen: (cell: TransitionCell) => void;
}) {
  const states = layerStates(model.definition, slot.id);
  const cells = laneCells(model.definition, slot.id);
  const columns = [...states.map((state) => state.id), null];
  return (
    <div className="tr-grid-scroll">
      <div
        className="tr-grid"
        style={{
          gridTemplateColumns: `minmax(92px, 132px) repeat(${columns.length}, minmax(104px, 1fr))`,
        }}
      >
        <div className="tr-grid-corner">From ↓ · To →</div>
        {columns.map((column) => (
          <div className="tr-grid-col" key={column ?? 'off'} title={model.stateName(column)}>
            {model.stateName(column)}
          </div>
        ))}
        {cells.map((row, rowIndex) => {
          const from = rowIndex === 0 ? null : states[rowIndex - 1]!.id;
          return (
            <Fragment key={from ?? 'off'}>
              <div className="tr-grid-row" title={model.stateName(from)}>
                {model.stateName(from)}
              </div>
              {row.map((cell, columnIndex) =>
                cell ? (
                  <CellButton
                    key={columnIndex}
                    model={model}
                    cell={cell}
                    selected={sameCell(cell, selected)}
                    onSelect={() => onSelect(cell)}
                    onOpen={() => onOpen(cell)}
                  />
                ) : (
                  <div key={columnIndex} className="tr-grid-empty" />
                ),
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function LaneCard({
  model,
  slot,
  selected,
  onSelect,
  onOpen,
}: {
  model: Model;
  slot: TransitionLogicSlot;
  selected: TransitionCell | null;
  onSelect: (cell: TransitionCell) => void;
  onOpen: (cell: TransitionCell) => void;
}) {
  const { definition, snapshot, components, references, locked, run } = model;
  const states = layerStates(definition, slot.id);
  const ordered = layersTopFirst(definition);
  const position = ordered.findIndex((entry) => entry.id === slot.id);
  const unassigned = snapshot.templates.filter(
    (template) => !definition.states.some((state) => state.templateId === template.id),
  );
  const elements = definition.sharedInstances.filter(
    (instance) => elementOwner(definition, instance) === slot.id,
  );
  const addable = components.filter(
    (component) => !elements.some((instance) => instance.componentAssetId === component.id),
  );
  const blocker = layerRemovalBlocker(definition, slot.id);
  const selectedHere = selected?.slotId === slot.id ? selected : null;
  const selectedTiming = selectedHere ? cellTiming(definition, selectedHere) : null;
  return (
    <section className="tr-lane" aria-label={`${slot.name} lane`}>
      <header className="tr-lane-header">
        <input
          className="tr-lane-name"
          aria-label="Lane name"
          defaultValue={slot.name}
          key={slot.name}
          disabled={!!locked}
          onBlur={(event) => {
            const name = event.currentTarget.value;
            if (name !== slot.name)
              run((current) => renameLayer(current, slot.id, name, references));
          }}
        />
        <span className="tr-lane-meta">
          {states.length > 1 ? 'One at a time · ' : ''}
          {ordered.length > 1
            ? position === 0
              ? 'drawn on top'
              : `drawn under ${ordered[position - 1]!.name}`
            : 'only lane'}
        </span>
        <span className="tr-lane-tools">
          <button
            type="button"
            aria-label={`Draw ${slot.name} higher`}
            title="Draw above the lane over it"
            disabled={!!locked || position === 0}
            onClick={() => run((current) => moveLayer(current, slot.id, 1, references))}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Draw ${slot.name} lower`}
            title="Draw below the lane under it"
            disabled={!!locked || position === ordered.length - 1}
            onClick={() => run((current) => moveLayer(current, slot.id, -1, references))}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`Remove the ${slot.name} lane`}
            title={blocker ?? 'Remove this lane'}
            disabled={!!locked || !!blocker}
            onClick={() => run((current) => removeLayer(current, slot.id, references))}
          >
            ×
          </button>
        </span>
      </header>

      <label
        className="tr-lane-parent"
        title="Taking out or clearing the chosen lane also takes this lane off air. Taking either lane in remains manual."
      >
        <span>Take out with</span>
        <select
          aria-label={`Take ${slot.name} out with`}
          value={slot.parentSlotId ?? ''}
          disabled={!!locked}
          onChange={(event) => {
            const parentSlotId = event.currentTarget.value || null;
            run((current) => setLayerParent(current, slot.id, parentSlotId, references));
          }}
        >
          <option value="">Independent</option>
          {layerParentOptions(definition, slot.id).map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
      </label>

      <label
        className="tr-lane-parent"
        title={
          LANE_UPDATE_MODES.find((entry) => entry.mode === (slot.updateMode ?? 'transition'))?.hint
        }
      >
        <span>When its content changes</span>
        <select
          aria-label={`When ${slot.name} content changes`}
          value={slot.updateMode ?? 'transition'}
          disabled={!!locked}
          onChange={(event) => {
            const mode = event.currentTarget.value as NonNullable<typeof slot.updateMode>;
            run((current) => setLayerUpdateMode(current, slot.id, mode, references));
          }}
        >
          {LANE_UPDATE_MODES.map((entry) => (
            <option key={entry.mode} value={entry.mode} title={entry.hint}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <TransitionLaneConditions
        definition={definition}
        slot={slot}
        set={model.snapshot}
        references={references}
        disabled={!!locked}
        run={run}
      />

      <div className="tr-templates">
        {states.map((state) => (
          <TemplateTile key={state.id} model={model} slot={slot} stateId={state.id} />
        ))}
        {!!unassigned.length && (
          <label className="tr-template-add">
            <span>+ Add template</span>
            <select
              aria-label={`Add a template to ${slot.name}`}
              value=""
              disabled={!!locked}
              onChange={(event) => {
                const template = unassigned.find((entry) => entry.id === event.currentTarget.value);
                if (template)
                  run((current) =>
                    addTemplateToLayer(
                      current,
                      slot.id,
                      template.id,
                      template.name,
                      references,
                      model.templates,
                    ),
                  );
              }}
            >
              <option value="">Choose…</option>
              {unassigned.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="tr-elements">
        <span className="tr-elements-label">Morph automatically</span>
        {elements.map((instance) => (
          <span className="tr-chip" key={instance.id}>
            <span className="tr-chip-dot" aria-hidden="true" />
            {instance.name}
            <button
              type="button"
              aria-label={`Stop keeping ${instance.name} on screen`}
              title="Fade with each template instead of morphing"
              disabled={!!locked}
              onClick={() => run((current) => removeElement(current, instance.id, references))}
            >
              ×
            </button>
          </span>
        ))}
        {!elements.length && (
          <span className="tr-muted">Nothing yet: everything fades with its template.</span>
        )}
        {!!addable.length && (
          <select
            className="tr-chip-add"
            aria-label={`Keep a component on screen in ${slot.name}`}
            value=""
            disabled={!!locked}
            onChange={(event) => {
              const component = addable.find((entry) => entry.id === event.currentTarget.value);
              if (component)
                run((current) =>
                  addLaneElement(
                    current,
                    snapshot,
                    slot.id,
                    component,
                    model.templates,
                    references,
                  ),
                );
            }}
          >
            <option value="">+ Keep a component on screen…</option>
            {addable.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {states.length ? (
        <>
          <div className="tr-grid-head">
            <h4>Every moment in this lane</h4>
            <span className="tr-legend" aria-hidden="true">
              <span>
                <i className="is-out" />
                old leaves
              </span>
              <span>
                <i className="is-in" />
                new arrives
              </span>
              <span>
                <i className="is-shared" />
                elements morph
              </span>
            </span>
          </div>
          <LaneGrid
            model={model}
            slot={slot}
            selected={selected}
            onSelect={onSelect}
            onOpen={onOpen}
          />
          {selectedHere && selectedTiming && (
            <div className="tr-selection">
              <span>
                <strong>{cellTitle(model, selectedHere)}</strong>
                {selectedTiming.recipe
                  ? ` · ${styleLabel(styleOf(selectedTiming.recipe, selectedTiming.phase))} · ${seconds(
                      motionFrames(selectedTiming.recipe, selectedTiming.phase),
                      model.frameRate,
                    )}`
                  : ''}
                {selectedTiming.custom ? ' · its own timing' : ' · follows the lane'}
              </span>
              {selectedTiming.custom && (
                <button
                  type="button"
                  disabled={!!locked}
                  onClick={() => run((current) => resetCell(current, selectedHere, references))}
                >
                  Use the lane’s timing
                </button>
              )}
              <button type="button" className="tr-primary" onClick={() => onOpen(selectedHere)}>
                Open on stage
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="tr-muted">Add a template to give this lane a playout.</p>
      )}
    </section>
  );
}

function ChecksList({
  checks,
  locked,
  onRoom,
  onOpen,
  onTemplateValues,
  onKeepValues,
}: {
  checks: TransitionCheck[];
  locked?: string;
  onRoom: (room: NonNullable<TransitionCheck['room']>) => void;
  onOpen: (cell: TransitionCell) => void;
  onTemplateValues: (instanceId: string) => void;
  onKeepValues: (instanceId: string) => void;
}) {
  return (
    <section className="tr-checks" aria-labelledby="tr-checks-title">
      <h4 id="tr-checks-title">Checks</h4>
      {!checks.length && <p className="tr-muted">Nothing to look at. Lanes don’t clash.</p>}
      {checks.map((check) => (
        <div key={check.id} className={`tr-check is-${check.tone}`}>
          <strong>{check.title}</strong>
          <span>{check.detail}</span>
          {check.room && (
            <button type="button" onClick={() => onRoom(check.room!)}>
              {check.tone === 'warning' ? 'Make room…' : 'Adjust room…'}
            </button>
          )}
          {check.cell && (
            <button type="button" onClick={() => onOpen(check.cell!)}>
              Open
            </button>
          )}
          {check.drift && (
            <span className="tr-check-actions">
              <button
                type="button"
                className="tr-primary"
                disabled={!!locked}
                onClick={() => onTemplateValues(check.drift!.instanceId)}
              >
                Use template values
              </button>
              <button
                type="button"
                disabled={!!locked}
                onClick={() => onKeepValues(check.drift!.instanceId)}
              >
                Keep these values
              </button>
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

function MapView({
  model,
  selected,
  selectedLaneId,
  onSelectLane,
  onSelect,
  onOpen,
  onTogether,
  onShow,
}: {
  model: Model;
  selected: TransitionCell | null;
  selectedLaneId: string | null;
  onSelectLane: (slotId: string) => void;
  onSelect: (cell: TransitionCell) => void;
  onOpen: (cell: TransitionCell) => void;
  onTogether: (room: NonNullable<TransitionCheck['room']>) => void;
  onShow: () => void;
}) {
  const lanes = layersTopFirst(model.definition);
  const activeLane = activeTransitionLane(lanes, selectedLaneId);
  const checks = useMemo(
    () => [
      ...transitionChecks(model.definition, model.layouts),
      ...elementDriftChecks(model.definition, model.snapshot, model.templates, model.references),
      ...layoutChecks(model.definition, model.layouts, model.templates, model.references),
    ],
    [model.definition, model.layouts, model.snapshot, model.templates, model.references],
  );
  const unassigned = model.snapshot.templates.filter(
    (template) => !model.definition.states.some((state) => state.templateId === template.id),
  );
  return (
    <div className="tr-map">
      <div className="tr-map-main">
        <TransitionLaneList
          definition={model.definition}
          lanes={lanes}
          activeLaneId={activeLane?.id}
          locked={model.locked}
          onSelectLane={onSelectLane}
          onAddLane={() => {
            let slotId: string | null = null;
            const added = model.run((current) => {
              const result = addLayer(
                current,
                `Lane ${current.slots.length + 1}`,
                model.references,
              );
              slotId = result.slotId;
              return result.definition;
            });
            if (added && slotId) onSelectLane(slotId);
          }}
        />
        <div className="tr-map-lanes">
          {!!unassigned.length && (
            <p className="tr-muted">
              Not in any lane yet: {unassigned.map((template) => template.name).join(', ')}.
            </p>
          )}
          {activeLane ? (
            <LaneCard
              key={activeLane.id}
              model={model}
              slot={activeLane}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ) : (
            <p className="tr-muted">Add a lane to configure its transitions.</p>
          )}
        </div>
      </div>
      <details className="tr-map-tools">
        <summary>
          Checks and lane coordination{checks.length ? ` · ${checks.length} checks` : ''}
        </summary>
        <aside className="tr-map-aside">
          <section className="tr-checks">
            <h4>Rehearse</h4>
            <span className="tr-muted">
              Run a whole rundown with real timing: takes, switches and lanes on air together.
            </span>
            <button type="button" className="tr-show-button" onClick={onShow}>
              ▶ Play the show
            </button>
          </section>
          <ChecksList
            checks={checks}
            locked={model.locked}
            onRoom={onTogether}
            onOpen={onOpen}
            onTemplateValues={(instanceId) =>
              model.run((current) =>
                applyTemplateValues(current, instanceId, model.templates, model.references),
              )
            }
            onKeepValues={(instanceId) =>
              model.run((current) =>
                keepElementValues(
                  current,
                  model.snapshot,
                  instanceId,
                  model.templates,
                  model.references,
                ),
              )
            }
          />
          {lanes.length > 1 && (
            <section className="tr-checks">
              <h4>Together on air</h4>
              {lanes.flatMap((top, index) =>
                lanes.slice(index + 1).map((below) => (
                  <button
                    key={`${top.id}:${below.id}`}
                    type="button"
                    className="tr-pair-link"
                    onClick={() => onTogether({ triggerSlotId: top.id, affectedSlotId: below.id })}
                  >
                    {top.name} + {below.name}
                  </button>
                )),
              )}
            </section>
          )}
          <TurnOffPlayout locked={model.locked} />
        </aside>
      </details>
    </div>
  );
}

/* Stage */

function useStageSource(model: Model) {
  return useMemo(
    () => ({ ...model.snapshot, transitionLogic: model.definition }),
    [model.snapshot, model.definition],
  );
}

/** Update previews need new data: the first text field gets a visible change. */
function updatePreviewData(model: Model, stateId: string | null) {
  const state = model.definition.states.find((entry) => entry.id === stateId);
  const project = state ? model.templates(state.templateId) : undefined;
  const composition = project?.compositions.find((entry) => entry.id === project.mainCompositionId);
  const field = composition?.dataFields.find(
    (entry) =>
      (entry.type === 'text' || entry.type === 'textarea') &&
      typeof entry.defaultValue === 'string' &&
      entry.defaultValue.length > 0,
  );
  return field ? { [field.key]: `${String(field.defaultValue)} · UPDATED` } : undefined;
}

function StageViewport({
  stage,
  label,
  aspect,
  overlay,
}: {
  stage: TransitionStage;
  label: string;
  aspect: number;
  overlay?: ReactNode;
}) {
  return (
    <div className="tr-stage-frame" style={{ aspectRatio: String(aspect) }}>
      <div className="tr-stage-viewport" ref={stage.viewportRef} role="img" aria-label={label} />
      {overlay}
      {stage.loading && <span className="tr-stage-status">Preparing preview…</span>}
      {stage.error && (
        <span className="tr-stage-status is-error" role="alert">
          {stage.error}
        </span>
      )}
    </div>
  );
}

function Transport({ stage, frameRate }: { stage: TransitionStage; frameRate: number }) {
  return (
    <div className="tr-transport">
      <button
        type="button"
        className="tr-play"
        aria-label={stage.playing ? 'Pause' : 'Play'}
        onClick={stage.playing ? stage.pause : stage.play}
      >
        {stage.playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="1.5" width="3" height="9" fill="currentColor" />
            <rect x="7" y="1.5" width="3" height="9" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <input
        type="range"
        aria-label="Scrub the transition"
        min={0}
        max={stage.totalFrames}
        step={0.5}
        value={stage.frame}
        onChange={(event) => {
          stage.pause();
          stage.seek(Number(event.currentTarget.value));
        }}
      />
      <span className="tr-readout">
        {Math.max(0, Math.round(stage.frame - STAGE_LEAD_FRAMES))} f ·{' '}
        {seconds(Math.max(0, stage.frame - STAGE_LEAD_FRAMES), frameRate)}
      </span>
      <label className="tr-check-inline">
        <input
          type="checkbox"
          checked={stage.loop}
          onChange={(event) => stage.setLoop(event.currentTarget.checked)}
        />
        Loop
      </label>
    </div>
  );
}

type TrackKey = 'out' | 'in' | 'shared' | 'room';
interface Track {
  key: TrackKey;
  label: string;
  start: number;
  length: number;
  movableStart: boolean;
}

function stageTracks(model: Model, cell: TransitionCell, recipe: TransitionLogicRecipe): Track[] {
  const phase = cellPhase(cell);
  const tracks: Track[] = [];
  if (phase !== 'enter')
    tracks.push({
      key: 'out',
      label:
        phase === 'update' ? 'Old data leaves' : `${model.stateName(cell.from)} content leaves`,
      start: 0,
      length: recipe.outgoingFrames,
      movableStart: false,
    });
  if (phase !== 'exit')
    tracks.push({
      key: 'in',
      label:
        phase === 'update' ? 'New data arrives' : `${model.stateName(cell.to)} content arrives`,
      start: recipe.incomingStartFrame,
      length: recipe.incomingFrames,
      movableStart: true,
    });
  tracks.push({
    key: 'shared',
    label: 'Elements morph',
    start: 0,
    length: recipe.sharedFrames,
    movableStart: false,
  });
  if (recipe.layoutPhase)
    tracks.push({
      key: 'room',
      label: phase === 'exit' ? 'Room closes' : 'Room opens',
      start: recipe.layoutPhase.startFrame,
      length: recipe.layoutPhase.durationFrames,
      movableStart: true,
    });
  return tracks;
}

function trackPatch(track: Track, start: number, length: number): TimingPatch {
  if (track.key === 'out') return { outgoingFrames: length };
  if (track.key === 'in') return { incomingStartFrame: start, incomingFrames: length };
  if (track.key === 'shared') return { sharedFrames: length };
  return { layoutPhase: { startFrame: start, durationFrames: Math.max(1, length) } };
}

function StageTimeline({
  model,
  cell,
  recipe,
  stage,
  onRetime,
}: {
  model: Model;
  cell: TransitionCell;
  recipe: TransitionLogicRecipe;
  stage: TransitionStage;
  onRetime: (patch: TimingPatch) => void;
}) {
  const tracks = stageTracks(model, cell, recipe);
  const span = Math.max(1, phaseEnd(recipe) + holdFrames(recipe));
  const [drag, setDrag] = useState<{
    key: TrackKey;
    start: number;
    length: number;
  } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const toFrames = (pixels: number) => {
    const width = laneRef.current?.clientWidth ?? 1;
    return Math.round((pixels / width) * span);
  };
  const begin = (event: ReactPointerEvent<HTMLElement>, track: Track, mode: 'move' | 'end') => {
    if (model.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const originX = event.clientX;
    let current = { key: track.key, start: track.start, length: track.length };
    setDrag(current);
    const move = (moveEvent: PointerEvent) => {
      const delta = toFrames(moveEvent.clientX - originX);
      current =
        mode === 'move'
          ? { ...current, start: Math.max(0, track.start + delta) }
          : { ...current, length: Math.max(track.key === 'room' ? 1 : 0, track.length + delta) };
      setDrag(current);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDrag(null);
      if (current.start !== track.start || current.length !== track.length)
        onRetime(trackPatch(track, current.start, current.length));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  const ticks = useMemo(() => {
    const step = span > 60 ? 20 : span > 24 ? 8 : 4;
    const values: number[] = [];
    for (let frame = 0; frame <= span; frame += step) values.push(frame);
    return values;
  }, [span]);
  const playhead = ((stage.frame - STAGE_LEAD_FRAMES) / span) * 100;
  const seekAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    stage.pause();
    stage.seek(STAGE_LEAD_FRAMES + ((event.clientX - rect.left) / rect.width) * span);
  };
  return (
    <section className="tr-timeline" aria-label="Timeline">
      <div className="tr-track tr-ruler">
        <span />
        <div className="tr-track-lane" ref={laneRef} onPointerDown={seekAt}>
          {ticks.map((frame) => (
            <i key={frame} style={{ left: `${(frame / span) * 100}%` }}>
              {frame}
            </i>
          ))}
          <b className="tr-playhead" style={{ left: `${Math.min(100, Math.max(0, playhead))}%` }} />
        </div>
      </div>
      {tracks.map((track) => {
        const live = drag?.key === track.key ? drag : track;
        return (
          <div className={`tr-track is-${track.key}`} key={track.key}>
            <span className="tr-track-label">
              {track.label}
              <small>
                {live.start ? `${live.start}–` : '0–'}
                {live.start + live.length} f
              </small>
            </span>
            <div className="tr-track-lane" onPointerDown={seekAt}>
              <span
                className={`tr-bar${track.movableStart ? ' is-movable' : ''}`}
                style={{
                  left: `${(live.start / span) * 100}%`,
                  width: `${Math.max(0.5, (live.length / span) * 100)}%`,
                }}
                title={
                  track.movableStart
                    ? 'Drag to move, drag the end to resize'
                    : 'Drag the end to resize'
                }
                onPointerDown={(event) =>
                  track.movableStart ? begin(event, track, 'move') : event.stopPropagation()
                }
              >
                <span
                  className="tr-bar-end"
                  role="slider"
                  aria-label={`${track.label} length`}
                  aria-valuenow={live.length}
                  aria-valuemin={0}
                  tabIndex={model.locked ? -1 : 0}
                  onPointerDown={(event) => begin(event, track, 'end')}
                  onKeyDown={(event) => {
                    const step =
                      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (!step || model.locked) return;
                    event.preventDefault();
                    onRetime(trackPatch(track, track.start, Math.max(0, track.length + step)));
                  }}
                />
              </span>
              <b
                className="tr-playhead"
                style={{ left: `${Math.min(100, Math.max(0, playhead))}%` }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function StageView({
  model,
  cell,
  onBack,
  onCell,
  onResize,
}: {
  model: Model;
  cell: TransitionCell;
  onBack: () => void;
  onCell: (cell: TransitionCell) => void;
  onResize: (triggerSlotId: string, affectedSlotId: string) => void;
}) {
  const { definition, references, frameRate, locked, run } = model;
  const timing = cellTiming(definition, cell);
  const recipe = timing.recipe;
  const phase = timing.phase;
  const slot = definition.slots.find((entry) => entry.id === cell.slotId);
  const source = useStageSource(model);
  // Compared as text so timing edits don't reload an unchanged schedule.
  const updateJson = JSON.stringify(
    phase === 'update' ? (updatePreviewData(model, cell.from) ?? null) : null,
  );
  const schedule = useMemo(
    () =>
      stageSchedule(
        cell,
        frameRate,
        (JSON.parse(updateJson) as Record<string, unknown> | null) ?? undefined,
      ),
    [cell, frameRate, updateJson],
  );
  const totalFrames = STAGE_LEAD_FRAMES + stageLength(recipe);
  const stage = useTransitionStage(
    useMemo(
      () => ({ source, schedule, totalFrames, frameRate }),
      [source, schedule, totalFrames, frameRate],
    ),
  );
  const [pairScope, setPairScope] = useState(false);
  const [moving, setMoving] = useState(false);
  const [movingKey, setMovingKey] = useState('');
  const scope: 'lane' | 'pair' = timing.custom || pairScope ? 'pair' : 'lane';
  const motions = cellElementMotions(definition, model.components, cell);
  const style = recipe ? styleOf(recipe, phase) : null;
  const speed = recipe ? speedOf(recipe, phase, frameRate) : null;
  const retime = (patch: TimingPatch) =>
    run((current) => applyCellTiming(current, cell, patch, scope, references));
  const layout = model.layouts.values().next().value;
  const laneCount = layerStates(definition, cell.slotId).length;

  // Start playing once, so opening a moment shows it.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!autoplayed.current && !stage.loading && !stage.error) {
      autoplayed.current = true;
      stage.play();
    }
  }, [stage]);

  return (
    <div className="tr-stage-view">
      <header className="tr-stage-header">
        <button type="button" onClick={onBack}>
          ← Map
        </button>
        <span className="tr-stage-title">
          <small>
            {slot?.name ?? 'Lane'} · {PHASE_LABELS[phase]}
          </small>
          <strong>{cellTitle(model, cell)}</strong>
        </span>
        {phase === 'switch' && (
          <button
            type="button"
            title="Show the switch the other way round"
            onClick={() => onCell({ slotId: cell.slotId, from: cell.to, to: cell.from })}
          >
            ⇄ Reverse
          </button>
        )}
        {cell.to !== null && (
          <button
            type="button"
            aria-pressed={moving}
            disabled={!!locked}
            title={`Drag elements to move them in the ${model.stateName(cell.to)} template`}
            onClick={() => {
              const next = !moving;
              setMoving(next);
              if (next) stage.seek(totalFrames);
            }}
          >
            {moving ? 'Done moving' : 'Move elements'}
          </button>
        )}
        <span className="tr-stage-total">
          {recipe ? seconds(motionFrames(recipe, phase), frameRate) : ''}
        </span>
      </header>
      <div className="tr-stage-body">
        <div className="tr-stage-main">
          <StageViewport
            stage={stage}
            aspect={layout ? layout.width / layout.height : 16 / 9}
            label={`Preview of ${cellTitle(model, cell)}`}
            overlay={
              moving && cell.to !== null && layout ? (
                <StageHandles
                  width={layout.width}
                  height={layout.height}
                  mode="move"
                  boxes={landingBoxes(definition, model.components, cell.slotId, cell.to)}
                  selectedKey={movingKey}
                  disabled={!!locked}
                  onSelect={setMovingKey}
                  onCommit={(key, geometry) => {
                    const box = landingBoxes(
                      definition,
                      model.components,
                      cell.slotId,
                      cell.to!,
                    ).find((entry) => entry.key === key);
                    if (!box) return;
                    try {
                      // Move the element in the destination template itself.
                      applyLandingMove(
                        moveElementInTemplate(
                          model.snapshot,
                          definition,
                          box,
                          cell.to!,
                          { dx: geometry.x - box.x, dy: geometry.y - box.y },
                          references,
                        ),
                      );
                      model.report('');
                    } catch (cause) {
                      // A template that doesn't place the element keeps a deliberate difference.
                      if (
                        !run((current) => setLanding(current, box, cell.to!, geometry, references))
                      )
                        model.report(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                />
              ) : undefined
            }
          />
          <Transport stage={stage} frameRate={frameRate} />
          {recipe ? (
            <StageTimeline
              model={model}
              cell={cell}
              recipe={recipe}
              stage={stage}
              onRetime={retime}
            />
          ) : (
            <p className="tr-error">{timing.issue}</p>
          )}
          {!!motions.length && (
            <section className="tr-motions" aria-label="What morphs">
              <h4>What morphs</h4>
              <ul>
                {motions.map((motion) => (
                  <li key={motion.key}>
                    <span title={`${motion.instanceName} · ${motion.layerName}`}>
                      {motion.layerName}
                      <small> · {motion.instanceName.split(' / ').at(-1)}</small>
                    </span>
                    <span>{propertyLabel(motion.property)}</span>
                    <span className="tr-mono">
                      {Math.round(motion.from * 100) / 100} → {Math.round(motion.to * 100) / 100}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="tr-muted">
                Values come from where each template places the element. Move it in a template to
                change where it lands.
              </p>
            </section>
          )}
        </div>
        <aside className="tr-stage-inspector">
          {definition.slots.length > 1 && (
            <section>
              <button
                type="button"
                onClick={() => {
                  const affected =
                    definition.layoutRules?.find((rule) => rule.whenSlotId === cell.slotId)
                      ?.slotId ?? definition.slots.find((lane) => lane.id !== cell.slotId)?.id;
                  if (affected) onResize(cell.slotId, affected);
                }}
              >
                Resize objects…
              </button>
            </section>
          )}
          {recipe && (
            <>
              <section>
                <h4>Style</h4>
                <div className="tr-style-grid" role="radiogroup" aria-label="Style">
                  {TRANSITION_STYLES.map((entry) => (
                    <button
                      key={entry.style}
                      type="button"
                      role="radio"
                      aria-checked={style === entry.style}
                      disabled={!!locked}
                      onClick={() =>
                        retime(
                          stylePatch(
                            phase,
                            entry.style,
                            entry.style === 'cut'
                              ? 1
                              : speed
                                ? speedFrames(speed, frameRate)
                                : Math.max(2, motionFrames(recipe, phase)),
                            recipe,
                          ),
                        )
                      }
                    >
                      <strong>{entry.label}</strong>
                      <small>{entry.hint}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h4>Speed</h4>
                <Segmented
                  label="Speed"
                  value={speed}
                  disabled={!!locked || style === 'cut'}
                  options={TRANSITION_SPEEDS.map((entry) => ({
                    value: entry.speed,
                    label: entry.label,
                    hint: `${entry.seconds.toFixed(2)} s`,
                  }))}
                  onPick={(next) =>
                    retime(
                      stylePatch(phase, style ?? 'morph', speedFrames(next, frameRate), recipe),
                    )
                  }
                />
              </section>
              {phase !== 'update' ? (
                <section>
                  <h4>Content animation</h4>
                  {phase !== 'exit' && (
                    <TransitionContentAnimationEditor
                      definition={definition}
                      side="in"
                      value={recipe.incomingAnimation}
                      frames={recipe.incomingFrames}
                      frameRate={frameRate}
                      disabled={!!locked}
                      onChange={(value, snapshot) =>
                        run((current) =>
                          applyCellTiming(
                            pinTransitionAnimationPlugin(current, snapshot),
                            cell,
                            { incomingAnimation: value ?? null },
                            scope,
                            references,
                          ),
                        )
                      }
                    />
                  )}
                  {phase !== 'enter' && (
                    <TransitionContentAnimationEditor
                      definition={definition}
                      side="out"
                      value={recipe.outgoingAnimation}
                      frames={recipe.outgoingFrames}
                      frameRate={frameRate}
                      disabled={!!locked}
                      onChange={(value, snapshot) =>
                        run((current) =>
                          applyCellTiming(
                            pinTransitionAnimationPlugin(current, snapshot),
                            cell,
                            { outgoingAnimation: value ?? null },
                            scope,
                            references,
                          ),
                        )
                      }
                    />
                  )}
                  <p className="tr-muted">
                    Animates the whole incoming or outgoing content, not individual layers. Shared
                    objects keep their morph between template layouts. Template animation uses the
                    existing layer In/Out tracks.
                  </p>
                </section>
              ) : slot?.updateMode === 'in-place' ? (
                <p className="tr-muted">
                  This lane updates in place. The template stays on air and only layers whose data
                  changed animate, using their own Data change transition. Speed sets the length for
                  layers that have none. A resource only a new mount can load, such as a video or
                  Lottie file, still plays this transition.
                </p>
              ) : (
                <p className="tr-muted">
                  Data updates stay on air and use the existing update crossfade, without replaying
                  entrance or exit animations.
                </p>
              )}
              <section>
                <h4>Feel</h4>
                <Segmented
                  label="Feel"
                  value={recipe.easing}
                  disabled={!!locked}
                  options={TRANSITION_FEELS.map((entry) => ({
                    value: entry.easing,
                    label: entry.label,
                  }))}
                  onPick={(easing) => retime({ easing })}
                />
              </section>
              <section>
                <h4>Use this for</h4>
                <label className="tr-radio">
                  <input
                    type="radio"
                    name={`scope-${cell.slotId}`}
                    checked={scope === 'lane'}
                    disabled={!!locked}
                    onChange={() => {
                      setPairScope(false);
                      if (timing.custom) run((current) => resetCell(current, cell, references));
                    }}
                  />
                  <span>
                    Every {PHASE_LABELS[phase].toLowerCase()} in {slot?.name ?? 'this lane'}
                    <small>
                      {phase === 'switch'
                        ? `${laneCount * (laneCount - 1)} switches follow the lane`
                        : `All ${laneCount} templates follow the lane`}
                    </small>
                  </span>
                </label>
                <label className="tr-radio">
                  <input
                    type="radio"
                    name={`scope-${cell.slotId}`}
                    checked={scope === 'pair'}
                    disabled={!!locked}
                    onChange={() => {
                      setPairScope(true);
                      run((current) => makeCellCustom(current, cell, references));
                    }}
                  />
                  <span>
                    Only {cellTitle(model, cell)}
                    <small>Shown as Custom on the map</small>
                  </span>
                </label>
              </section>
              <details className="tr-exact">
                <summary>Exact frames</summary>
                <div className="tr-exact-fields">
                  {phase !== 'enter' && (
                    <FrameField
                      label="Old leaves for"
                      value={recipe.outgoingFrames}
                      disabled={!!locked}
                      onCommit={(outgoingFrames) => retime({ outgoingFrames })}
                    />
                  )}
                  {phase !== 'exit' && (
                    <>
                      <FrameField
                        label="New arrives at"
                        value={recipe.incomingStartFrame}
                        disabled={!!locked}
                        onCommit={(incomingStartFrame) => retime({ incomingStartFrame })}
                      />
                      <FrameField
                        label="New arrives for"
                        value={recipe.incomingFrames}
                        disabled={!!locked}
                        onCommit={(incomingFrames) => retime({ incomingFrames })}
                      />
                    </>
                  )}
                  <FrameField
                    label="Elements morph for"
                    value={recipe.sharedFrames}
                    disabled={!!locked}
                    onCommit={(sharedFrames) => retime({ sharedFrames })}
                  />
                  <FrameField
                    label="Hold after"
                    value={holdFrames(recipe)}
                    disabled={!!locked}
                    onCommit={(next) => retime({ holdFrames: next })}
                  />
                </div>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/* Together on air */

function TogetherView({
  model,
  triggerSlotId,
  affectedSlotId,
  onBack,
  onPair,
}: {
  model: Model;
  triggerSlotId: string;
  affectedSlotId: string;
  onBack: () => void;
  onPair: (triggerSlotId: string, affectedSlotId: string) => void;
}) {
  const { definition, components, references, layouts, frameRate, locked, run } = model;
  const trigger = definition.slots.find((slot) => slot.id === triggerSlotId);
  const affected = definition.slots.find((slot) => slot.id === affectedSlotId);
  const triggerStates = layerStates(definition, triggerSlotId);
  const affectedStates = layerStates(definition, affectedSlotId);
  const [chosenTriggerState, setTriggerStateId] = useState(triggerStates[0]?.id ?? '');
  const [chosenAffectedState, setAffectedStateId] = useState(affectedStates[0]?.id ?? '');
  const triggerStateId = triggerStates.some((state) => state.id === chosenTriggerState)
    ? chosenTriggerState
    : (triggerStates[0]?.id ?? '');
  const affectedStateId = affectedStates.some((state) => state.id === chosenAffectedState)
    ? chosenAffectedState
    : (affectedStates[0]?.id ?? '');
  const setting = roomSetting(definition, triggerSlotId, affectedSlotId);
  const [resizePhase, setResizePhase] = useState<'enter' | 'exit'>('enter');
  const [targetKey, setTargetKey] = useState('');
  // Clearing automatically shrinks the tallest element and lifts what sits below it.
  const clearAutomatically = (amount: number) =>
    run((current) =>
      applyRoom(
        current,
        components,
        triggerSlotId,
        affectedSlotId,
        affectedStateId || null,
        amount,
        'shrink',
        references,
      ),
    );
  const overlapFor = (affectedId: string) =>
    Math.max(
      ...triggerStates.map(
        (state) => overlapWithLayout(definition, layouts, affectedId, state.id) ?? -Infinity,
      ),
    );
  const overlap = overlapWithLayout(definition, layouts, affectedStateId, triggerStateId);
  const targets = resizeTargets(definition, components, affectedSlotId, affectedStateId || null);
  const selectedTarget =
    targets.find((target) => target.key === targetKey) ??
    targets.find((target) => !target.disabledReason) ??
    targets[0];
  const resizeBoxes = targets.map((target) => {
    const resized = readResizeSetting(definition, triggerSlotId, affectedSlotId, target);
    const [ax, ay] = resizeAnchorFraction(resized.anchor);
    return {
      key: target.key,
      label: target.label,
      width: resized.width,
      height: resized.height,
      x: target.x + (target.width - resized.width) * ax,
      y: target.y + (target.height - resized.height) * ay,
      ...(target.disabledReason ? { disabledReason: target.disabledReason } : {}),
    };
  });
  const anchorFor = (held: readonly [number, number]) =>
    RESIZE_ANCHORS.find(({ value }) => {
      const [ax, ay] = resizeAnchorFraction(value);
      return ax === held[0] && ay === held[1];
    })?.value ?? 'top-left';
  const enter = cellTiming(definition, { slotId: triggerSlotId, from: null, to: triggerStateId });
  const roomFirst =
    !!enter.recipe?.layoutPhase &&
    enter.recipe.layoutPhase.startFrame === 0 &&
    enter.recipe.incomingStartFrame >=
      enter.recipe.layoutPhase.startFrame + enter.recipe.layoutPhase.durationFrames;
  const roomTogether =
    enter.recipe?.incomingStartFrame === 0 &&
    (!enter.recipe.layoutPhase || enter.recipe.layoutPhase.startFrame === 0);
  const resizeCell = useMemo<TransitionCell>(
    () => ({
      slotId: triggerSlotId,
      from: resizePhase === 'exit' ? triggerStateId : null,
      to: resizePhase === 'enter' ? triggerStateId : null,
    }),
    [triggerSlotId, triggerStateId, resizePhase],
  );
  const resizeRecipe = cellTiming(definition, resizeCell).recipe;
  const source = useStageSource(model);
  const schedule = useMemo(
    () =>
      stageSchedule(
        resizeCell,
        frameRate,
        undefined,
        affectedStateId ? [{ slotId: affectedSlotId, stateId: affectedStateId }] : [],
      ),
    [resizeCell, affectedSlotId, affectedStateId, frameRate],
  );
  const totalFrames = STAGE_LEAD_FRAMES + stageLength(resizeRecipe);
  const stage = useTransitionStage(
    useMemo(
      () => ({ source, schedule, totalFrames, frameRate, initialFrame: totalFrames }),
      [source, schedule, totalFrames, frameRate],
    ),
  );
  const layout = layouts.values().next().value;
  const lanes = layersTopFirst(definition);
  const roomFrames = Math.max(1, Math.round(frameRate * 0.6));
  const setOrder = (first: boolean) =>
    run((current) => {
      const incomingCell = { slotId: triggerSlotId, from: null, to: triggerStateId };
      const outgoingCell = { slotId: triggerSlotId, from: triggerStateId, to: null };
      const incoming = cellTiming(current, incomingCell);
      const exit = cellTiming(current, { slotId: triggerSlotId, from: triggerStateId, to: null });
      const incomingRoom = incoming.recipe?.layoutPhase?.durationFrames || roomFrames;
      const outgoingRoom = exit.recipe?.layoutPhase?.durationFrames || roomFrames;
      let next = applyCellTiming(
        current,
        incomingCell,
        first
          ? {
              layoutPhase: { startFrame: 0, durationFrames: incomingRoom },
              incomingStartFrame: Math.max(incoming.recipe?.incomingStartFrame ?? 0, incomingRoom),
            }
          : { layoutPhase: { startFrame: 0, durationFrames: incomingRoom }, incomingStartFrame: 0 },
        'pair',
        references,
      );
      next = applyCellTiming(
        next,
        outgoingCell,
        first
          ? {
              layoutPhase: {
                startFrame: exit.recipe?.outgoingFrames ?? 0,
                durationFrames: outgoingRoom,
              },
            }
          : { layoutPhase: { startFrame: 0, durationFrames: outgoingRoom } },
        'pair',
        references,
      );
      return next;
    });

  if (!trigger || !affected) {
    return (
      <div className="tr-stage-view">
        <header className="tr-stage-header">
          <button type="button" onClick={onBack}>
            ← Map
          </button>
        </header>
        <p className="tr-muted">This lane was removed.</p>
      </div>
    );
  }

  return (
    <div className="tr-stage-view">
      <header className="tr-stage-header">
        <button type="button" onClick={onBack}>
          ← Map
        </button>
        <span className="tr-stage-title">
          <small>Together on air</small>
          <strong>
            {affected.name} + {trigger.name}
          </strong>
        </span>
        <span
          className={`tr-status-chip ${overlap !== null && overlap > 0 ? 'is-warning' : 'is-ok'}`}
        >
          {overlap === null
            ? 'No layout to compare'
            : overlap > 0
              ? `${trigger.name} covers ${overlap} px`
              : Number.isFinite(overlap)
                ? `Clear by ${-overlap} px`
                : 'Clear'}
        </span>
      </header>
      <div className="tr-stage-body">
        <nav className="tr-together-nav" aria-label="Lanes on air together">
          <h4>On air together</h4>
          {lanes.flatMap((top, index) =>
            lanes.slice(index + 1).map((below) => (
              <button
                key={`${top.id}:${below.id}`}
                type="button"
                aria-current={top.id === triggerSlotId && below.id === affectedSlotId}
                onClick={() => onPair(top.id, below.id)}
              >
                {below.name} + {top.name}
              </button>
            )),
          )}
          <h4>Show {affected.name} with</h4>
          {affectedStates.map((state) => {
            const clash = overlapFor(state.id);
            return (
              <button
                key={state.id}
                type="button"
                aria-current={state.id === affectedStateId}
                onClick={() => setAffectedStateId(state.id)}
              >
                <span>{state.name}</span>
                <small className={clash > 0 ? 'is-warning' : 'is-ok'}>
                  {clash > 0 ? `covered ${clash} px` : 'clear'}
                </small>
              </button>
            );
          })}
          {triggerStates.length > 1 && (
            <>
              <h4>{trigger.name} template</h4>
              {triggerStates.map((state) => (
                <button
                  key={state.id}
                  type="button"
                  aria-current={state.id === triggerStateId}
                  onClick={() => setTriggerStateId(state.id)}
                >
                  {state.name}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="tr-stage-main">
          <StageViewport
            stage={stage}
            aspect={layout ? layout.width / layout.height : 16 / 9}
            label={`${affected.name} resizing as ${trigger.name} ${resizePhase === 'enter' ? 'appears' : 'leaves'}`}
            overlay={
              layout ? (
                <StageHandles
                  width={layout.width}
                  height={layout.height}
                  mode="resize"
                  boxes={resizeBoxes}
                  selectedKey={selectedTarget?.key}
                  disabled={!!locked}
                  onSelect={setTargetKey}
                  onCommit={(key, geometry, held) => {
                    const target = targets.find((entry) => entry.key === key);
                    if (target)
                      run((current) =>
                        applyResize(
                          current,
                          triggerSlotId,
                          affectedSlotId,
                          target,
                          {
                            width: Math.round(geometry.width),
                            height: Math.round(geometry.height),
                            anchor: anchorFor(held),
                          },
                          references,
                        ),
                      );
                  }}
                />
              ) : undefined
            }
          />
          <Transport stage={stage} frameRate={frameRate} />
          {resizeRecipe && (
            <StageTimeline
              model={model}
              cell={resizeCell}
              recipe={resizeRecipe}
              stage={stage}
              onRetime={(patch) =>
                run((current) =>
                  patch.layoutPhase
                    ? setResizeTiming(
                        current,
                        triggerSlotId,
                        triggerStateId,
                        resizePhase,
                        patch.layoutPhase,
                        references,
                      )
                    : applyCellTiming(current, resizeCell, patch, 'pair', references),
                )
              }
            />
          )}
          <p className="tr-muted">
            Select an element on the stage and drag a corner to resize it while {trigger.name} is on
            air; the opposite corner stays put.
          </p>
          <details className="tr-exact">
            <summary>Exact size, anchor and timing</summary>
            <TransitionResizeEditor
              definition={definition}
              components={components}
              references={references}
              triggerSlotId={triggerSlotId}
              affectedSlotId={affectedSlotId}
              affectedStateId={affectedStateId || null}
              triggerStateId={triggerStateId || null}
              affectedName={affected.name}
              triggerName={trigger.name}
              frameRate={frameRate}
              locked={locked}
              run={run}
              onPhaseChange={setResizePhase}
              selectedKey={selectedTarget?.key}
              onSelectedKeyChange={setTargetKey}
            />
          </details>
          {overlap !== null && overlap > 0 && (
            <div className="tr-check is-warning">
              <strong>
                {trigger.name} covers {affected.name} by {overlap} px
              </strong>
              <span>
                Drag a corner on the stage to resize an element, or clear it in one step: the
                tallest element gets shorter and what sits below it moves up.
              </span>
              <span className="tr-check-actions">
                <button
                  type="button"
                  className="tr-primary"
                  disabled={!!locked}
                  onClick={() =>
                    clearAutomatically(
                      Math.min(200, Math.ceil((setting.amount + overlap + 12) / 2) * 2),
                    )
                  }
                >
                  Clear it automatically
                </button>
              </span>
            </div>
          )}
          <p className="tr-muted">
            Only elements that stay on screen in {affected.name} can make room; each template’s own
            content keeps its place.
          </p>
        </div>
        <aside className="tr-stage-inspector">
          <section>
            <h4>When {trigger.name} comes on</h4>
            <label className="tr-radio">
              <input
                type="radio"
                name={`room-order-${triggerSlotId}`}
                checked={roomFirst}
                disabled={!!locked}
                onChange={() => setOrder(true)}
              />
              <span>
                Make room first, then show {trigger.name}
                <small>When it leaves, the room closes after it</small>
              </span>
            </label>
            <label className="tr-radio">
              <input
                type="radio"
                name={`room-order-${triggerSlotId}`}
                checked={roomTogether}
                disabled={!!locked}
                onChange={() => setOrder(false)}
              />
              <span>
                Both at once
                <small>Room opens while {trigger.name} appears</small>
              </span>
            </label>
            {!roomFirst && !roomTogether && (
              <p className="tr-muted">Custom timing. Adjust the Resize start and duration.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* Rehearse a rundown */

function ShowView({ model, onBack }: { model: Model; onBack: () => void }) {
  const { definition, frameRate } = model;
  // The rundown is saved with the set; until it's edited, a starting rundown is proposed.
  const steps: ShowStep[] = definition.rehearsal ?? defaultShow(definition);
  const setSteps = (next: ShowStep[]) => model.run((current) => ({ ...current, rehearsal: next }));
  const moveStep = (index: number, offset: -1 | 1) => {
    const next = [...valid];
    const [step] = next.splice(index, 1);
    next.splice(index + offset, 0, step!);
    setSteps(next);
  };
  const [addSlot, setAddSlot] = useState(() => layersTopFirst(definition).at(-1)?.id ?? '');
  const [addState, setAddState] = useState('');
  const valid = steps.filter(
    (step) =>
      definition.slots.some((slot) => slot.id === step.slotId) &&
      (step.stateId === null || definition.states.some((state) => state.id === step.stateId)),
  );
  const validKey = JSON.stringify(valid);
  const plan = useMemo(
    () => showPlan(definition, JSON.parse(validKey) as ShowStep[], frameRate),
    [definition, validKey, frameRate],
  );
  const source = useStageSource(model);
  const stage = useTransitionStage(
    useMemo(
      () => ({ source, schedule: plan.schedule, totalFrames: plan.totalFrames, frameRate }),
      [source, plan, frameRate],
    ),
  );
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!autoplayed.current && !stage.loading && !stage.error) {
      autoplayed.current = true;
      stage.play();
    }
  }, [stage]);
  const current = plan.starts.reduce(
    (found, start, index) => (start >= 0 && start <= stage.frame ? index : found),
    -1,
  );
  const layout = model.layouts.values().next().value;
  const laneName = (slotId: string) =>
    definition.slots.find((slot) => slot.id === slotId)?.name ?? 'Lane';
  const addStates = layerStates(definition, addSlot);
  return (
    <div className="tr-stage-view">
      <header className="tr-stage-header">
        <button type="button" onClick={onBack}>
          ← Map
        </button>
        <span className="tr-stage-title">
          <small>Rehearsal</small>
          <strong>Play the show</strong>
        </span>
        <span className="tr-stage-total">{seconds(plan.totalFrames, frameRate)}</span>
      </header>
      <div className="tr-stage-body">
        <div className="tr-stage-main">
          <StageViewport
            stage={stage}
            aspect={layout ? layout.width / layout.height : 16 / 9}
            label="Rehearsal of the rundown"
          />
          <Transport stage={stage} frameRate={frameRate} />
        </div>
        <aside className="tr-stage-inspector">
          <section>
            <h4>Rundown</h4>
            <ol className="tr-rundown">
              {valid.map((step, index) => (
                <li
                  key={`${index}:${step.slotId}:${step.stateId}`}
                  className={`${index === current ? 'is-current' : ''}${
                    plan.starts[index]! < 0 ? ' is-skipped' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="tr-rundown-step"
                    disabled={plan.starts[index]! < 0}
                    title={
                      plan.starts[index]! < 0
                        ? 'Already off; this step changes nothing'
                        : 'Go to this step'
                    }
                    onClick={() => stage.seek(plan.starts[index]!)}
                  >
                    <span className="tr-mono">{index + 1}</span>
                    <span>
                      {step.stateId === null
                        ? `${laneName(step.slotId)} off`
                        : model.stateName(step.stateId)}
                      <small>{laneName(step.slotId)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} earlier`}
                    disabled={!!model.locked || index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} later`}
                    disabled={!!model.locked || index === valid.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={!!model.locked}
                    onClick={() => setSteps(valid.filter((_, other) => other !== index))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            {!valid.length && <p className="tr-muted">Add a step to start the rundown.</p>}
            {!!showEndsOnAir(definition, valid).length && (
              <div className="tr-check is-info">
                <strong>The rundown ends on air</strong>
                <span>
                  {showEndsOnAir(definition, valid).join(', ')}{' '}
                  {showEndsOnAir(definition, valid).length === 1 ? 'is' : 'are'} still on air after
                  the last step. Add a step that takes{' '}
                  {showEndsOnAir(definition, valid).length === 1 ? 'it' : 'them'} off to end
                  cleanly.
                </span>
              </div>
            )}
          </section>
          <section>
            <h4>Add a step</h4>
            <select
              aria-label="Lane"
              value={addSlot}
              onChange={(event) => {
                setAddSlot(event.currentTarget.value);
                setAddState('');
              }}
            >
              {layersTopFirst(definition).map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Template"
              value={addState}
              onChange={(event) => setAddState(event.currentTarget.value)}
            >
              <option value="">Take it off</option>
              {addStates.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addSlot}
              onClick={() => setSteps([...valid, { slotId: addSlot, stateId: addState || null }])}
            >
              + Add step
            </button>
            <button
              type="button"
              disabled={!!model.locked || !definition.rehearsal}
              onClick={() =>
                model.run((current) => {
                  const { rehearsal: _saved, ...rest } = current;
                  return rest;
                })
              }
            >
              Reset rundown
            </button>
            <p className="tr-muted">
              The rundown is saved with the template set. Playout ignores it.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* First run */

function SetupView({ authoring }: { authoring: TransitionRuleAuthoring }) {
  const snapshot = authoring.snapshot;
  const components = authoring.components;
  const layouts = useMemo(
    () => (snapshot ? templateLayouts(snapshot) : new Map<string, TemplateLayout>()),
    [snapshot],
  );
  const proposed = useMemo(
    () => (snapshot ? proposeLanes(snapshot, layouts) : []),
    [snapshot, layouts],
  );
  const [lanes, setLanes] = useState<LaneProposal[]>(proposed);
  useEffect(() => setLanes(proposed), [proposed]);
  const [style, setStyle] = useState<TransitionStyle>('morph');
  const [speed, setSpeed] = useState<TransitionSpeed>('natural');
  const [error, setError] = useState('');
  if (!snapshot)
    return (
      <div className="tr-setup">
        <h3>Plan how templates go on and off air</h3>
        <div className="tr-setup-intro">
          <div>
            <p className="tr-muted">
              Transitions coordinate the templates of a template set. Turn this template into a set
              to start.
            </p>
            <button
              type="button"
              className="tr-primary"
              onClick={() => {
                if (!authoring.createSet()) setError(authoring.error);
              }}
            >
              Create a template set
            </button>
          </div>
          <svg
            className="tr-setup-illustration"
            viewBox="0 0 300 96"
            role="img"
            aria-label="A headline and ticker play in separate lanes while a shared panel changes shape"
          >
            <rect
              x="2"
              y="2"
              width="296"
              height="92"
              rx="4"
              fill="var(--bg-panel-raised)"
              stroke="var(--border)"
            />
            <text x="12" y="23" fill="var(--text-dim)" fontSize="10">
              HEADLINE LANE
            </text>
            <rect
              x="105"
              y="12"
              width="64"
              height="18"
              rx="2"
              fill="var(--accent)"
              opacity="0.45"
            />
            <path d="M176 21h30m-5-4 5 4-5 4" fill="none" stroke="var(--text-dim)" />
            <rect x="213" y="12" width="74" height="18" rx="2" fill="var(--accent)" opacity="0.7" />
            <text x="12" y="53" fill="var(--text-dim)" fontSize="10">
              TICKER LANE
            </text>
            <rect
              x="105"
              y="42"
              width="182"
              height="17"
              rx="2"
              fill="var(--accent)"
              opacity="0.3"
            />
            <text x="12" y="81" fill="var(--text-dim)" fontSize="10">
              SHARED PANEL MORPHS BETWEEN TEMPLATES
            </text>
          </svg>
        </div>
        {error && <p className="tr-error">{error}</p>}
      </div>
    );
  const name = (templateId: string) =>
    snapshot.templates.find((template) => template.id === templateId)?.name ?? 'Template';
  const frameRate = layouts.values().next().value?.frameRate ?? 50;
  const moveTemplate = (templateId: string, target: number) =>
    setLanes((current) => {
      const next = current.map((lane) => ({
        ...lane,
        templateIds: lane.templateIds.filter((id) => id !== templateId),
      }));
      if (target === next.length)
        next.push({ name: name(templateId), templateIds: [templateId], componentIds: [] });
      else next[target]!.templateIds.push(templateId);
      return next.filter((lane) => lane.templateIds.length);
    });
  const toggleComponent = (index: number, componentId: string) =>
    setLanes((current) =>
      current.map((lane, laneIndex) =>
        laneIndex !== index
          ? lane
          : {
              ...lane,
              componentIds: lane.componentIds.includes(componentId)
                ? lane.componentIds.filter((id) => id !== componentId)
                : [...lane.componentIds, componentId],
            },
      ),
    );
  const create = () => {
    const result = authoring.commit(
      (base) =>
        buildPlayoutSetup(base, {
          set: snapshot,
          lanes,
          components,
          templates: templateLookup(snapshot),
          references: transitionReferences(snapshot, components),
          style,
          speed,
          frameRate,
        }),
      { initialize: true },
    );
    setError(result.ok ? '' : result.error);
  };
  return (
    <div className="tr-setup">
      <header>
        <h3>Set up playout for {snapshot.name}</h3>
        <p className="tr-muted">
          We looked at your {snapshot.templates.length} templates. Here’s the playout we’d build
          from them. Change anything, then create it.
        </p>
      </header>
      <div className="tr-setup-columns">
        <section>
          <h4>1 · Lanes: what can be on air together</h4>
          <p className="tr-muted">
            Templates that cover the same area replace each other in one lane. Different lanes can
            be on air together.
          </p>
          {lanes.map((lane, index) => (
            <div className="tr-setup-lane" key={`${index}:${lane.name}`}>
              <input
                aria-label="Lane name"
                value={lane.name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setLanes((current) =>
                    current.map((entry, laneIndex) =>
                      laneIndex === index ? { ...entry, name: value } : entry,
                    ),
                  );
                }}
              />
              <div className="tr-setup-templates">
                {lane.templateIds.map((templateId) => (
                  <label key={templateId} className="tr-chip">
                    {name(templateId)}
                    <select
                      aria-label={`Move ${name(templateId)} to another lane`}
                      value={index}
                      onChange={(event) =>
                        moveTemplate(templateId, Number(event.currentTarget.value))
                      }
                    >
                      {lanes.map((other, otherIndex) => (
                        <option key={otherIndex} value={otherIndex}>
                          {other.name}
                        </option>
                      ))}
                      <option value={lanes.length}>A new lane</option>
                    </select>
                  </label>
                ))}
              </div>
              <span className="tr-muted">
                {lane.templateIds.length > 1 ? 'One at a time' : 'On air with the other lanes'}
              </span>
            </div>
          ))}
        </section>
        <section>
          <h4>2 · Stays on screen and morphs</h4>
          <p className="tr-muted">
            Components placed in several templates of a lane glide to each template’s layout instead
            of fading out and back in.
          </p>
          {lanes.map((lane, index) => {
            const candidates = components.filter((component) =>
              lane.templateIds.some((templateId) =>
                layouts.get(templateId)?.layers.some((layer) => layer.componentId === component.id),
              ),
            );
            if (!candidates.length) return null;
            return (
              <div key={`${index}:${lane.name}`} className="tr-setup-elements">
                <strong>{lane.name}</strong>
                {candidates.map((component) => {
                  const count = lane.templateIds.filter((templateId) =>
                    layouts
                      .get(templateId)
                      ?.layers.some((layer) => layer.componentId === component.id),
                  ).length;
                  return (
                    <label key={component.id} className="tr-check-row">
                      <input
                        type="checkbox"
                        checked={lane.componentIds.includes(component.id)}
                        onChange={() => toggleComponent(index, component.id)}
                      />
                      <span>
                        {component.name}
                        <small>
                          in {count} of {lane.templateIds.length} templates
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </section>
        <section>
          <h4>3 · House style</h4>
          <div className="tr-style-grid" role="radiogroup" aria-label="Style">
            {TRANSITION_STYLES.map((entry) => (
              <button
                key={entry.style}
                type="button"
                role="radio"
                aria-checked={style === entry.style}
                onClick={() => setStyle(entry.style)}
              >
                <strong>{entry.label}</strong>
                <small>{entry.hint}</small>
              </button>
            ))}
          </div>
          <h4>Speed</h4>
          <Segmented
            label="Speed"
            value={speed}
            options={TRANSITION_SPEEDS.map((entry) => ({
              value: entry.speed,
              label: `${entry.label} ${entry.seconds.toFixed(2)} s`,
            }))}
            onPick={setSpeed}
          />
          <p className="tr-muted">
            Take in, update, switch and take out all use this style. Any single moment can get its
            own later.
          </p>
        </section>
      </div>
      <footer className="tr-setup-footer">
        <span className="tr-muted">
          {lanes.length} {lanes.length === 1 ? 'lane' : 'lanes'} ·{' '}
          {lanes.reduce((count, lane) => count + lane.componentIds.length, 0)} morphing elements ·{' '}
          {styleLabel(style)}, {speedLabel(speed).toLowerCase()}
        </span>
        <button type="button" className="tr-primary" onClick={create}>
          Create playout
        </button>
      </footer>
      {error && (
        <p className="tr-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* Pane */

function TransitionsWorkspace({ authoring }: { authoring: TransitionRuleAuthoring }) {
  const [view, setView] = useState<View>({ kind: 'map' });
  const [selected, setSelected] = useState<TransitionCell | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  // Each view starts at its top: a stage opened from far down the map shows its preview first.
  const viewKey = view.kind === 'stage' ? JSON.stringify(view.cell) : view.kind;
  useEffect(() => {
    const scroller = workspaceRef.current?.closest('.panel-body');
    if (scroller) scroller.scrollTop = 0;
  }, [viewKey]);
  const [error, setError] = useState('');
  const { definition, snapshot, components, commit } = authoring;
  const layouts = useMemo(
    () => (snapshot ? templateLayouts(snapshot) : new Map<string, TemplateLayout>()),
    [snapshot],
  );
  const references = useMemo(
    () => (snapshot ? transitionReferences(snapshot, components) : {}),
    [snapshot, components],
  );
  const templates = useMemo<TemplateLookup>(
    () => (snapshot ? templateLookup(snapshot) : () => undefined),
    [snapshot],
  );
  const run = useCallback(
    (update: (current: TransitionLogicDefinition) => TransitionLogicDefinition) => {
      const result = commit(update);
      setError(result.ok ? '' : result.error);
      return result.ok;
    },
    [commit],
  );
  const locked = authoring.dirty
    ? 'Apply or discard the older playout transitions draft first.'
    : authoring.conflict
      ? 'The transition definitions changed elsewhere.'
      : undefined;
  const model = useMemo<Model | null>(
    () =>
      definition && snapshot
        ? {
            definition,
            snapshot,
            components,
            references,
            layouts,
            templates,
            frameRate: layouts.values().next().value?.frameRate ?? 50,
            locked,
            run,
            report: setError,
            stateName: (stateId) =>
              stateId === null
                ? 'Off'
                : (definition.states.find((state) => state.id === stateId)?.name ?? 'Missing'),
          }
        : null,
    [definition, snapshot, components, references, layouts, templates, locked, run],
  );

  // Other panes (Rules) open a moment here.
  const focusRequest = useTransitionsFocusStore((state) => state.request);
  useEffect(() => {
    if (!focusRequest) return;
    setSelectedLaneId(focusRequest.cell.slotId);
    setSelected(focusRequest.cell);
    setView({ kind: 'stage', cell: focusRequest.cell });
    useTransitionsFocusStore.getState().consume();
  }, [focusRequest]);

  // A view whose lanes or templates were removed (or rebuilt by setup) goes back to the map.
  const hasSlot = (slotId: string) => !!definition?.slots.some((slot) => slot.id === slotId);
  const viewValid =
    view.kind === 'map' ||
    view.kind === 'show' ||
    (view.kind === 'stage'
      ? hasSlot(view.cell.slotId) &&
        [view.cell.from, view.cell.to].every(
          (id) => id === null || !!definition?.states.some((state) => state.id === id),
        )
      : hasSlot(view.triggerSlotId) && hasSlot(view.affectedSlotId));
  useEffect(() => {
    if (!viewValid) setView({ kind: 'map' });
  }, [viewValid]);
  useEffect(() => {
    if (!definition) setView({ kind: 'map' });
  }, [definition]);

  if (authoring.loading) return <p className="tr-muted tr-pad">Loading transitions…</p>;
  if (!model) return <SetupView authoring={authoring} />;
  const errors = authoring.errors;
  return (
    <div className="tr-workspace" ref={workspaceRef}>
      <TransitionsToolbar
        name={model.snapshot.name}
        ready={!authoring.dirty && !authoring.conflict && !errors.length}
      />
      {authoring.dirty && (
        <div className="tr-banner" role="status">
          <span>There is an older unapplied playout transitions draft.</span>
          <button
            type="button"
            disabled={authoring.conflict || !!errors.length}
            onClick={authoring.apply}
          >
            Apply it
          </button>
          <button type="button" onClick={authoring.revert}>
            Discard it
          </button>
        </div>
      )}
      {!!errors.length && (
        <div className="tr-banner is-error" role="alert">
          <strong>
            {errors.length} {errors.length === 1 ? 'problem' : 'problems'} to fix before playout
          </strong>
          <ul>
            {errors.map((entry, index) => (
              <li key={`${index}:${entry}`}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      {(error || authoring.error) && (
        <p className="tr-error tr-pad" role="alert">
          {error || authoring.error}
        </p>
      )}
      {view.kind === 'stage' && viewValid ? (
        <StageView
          key={`${view.cell.slotId}:${view.cell.from}:${view.cell.to}`}
          model={model}
          cell={view.cell}
          onBack={() => setView({ kind: 'map' })}
          onResize={(triggerSlotId, affectedSlotId) =>
            setView({ kind: 'together', triggerSlotId, affectedSlotId })
          }
          onCell={(cell) => {
            setSelected(cell);
            setSelectedLaneId(cell.slotId);
            setView({ kind: 'stage', cell });
          }}
        />
      ) : view.kind === 'show' ? (
        <ShowView model={model} onBack={() => setView({ kind: 'map' })} />
      ) : view.kind === 'together' && viewValid ? (
        <TogetherView
          key={`${view.triggerSlotId}:${view.affectedSlotId}`}
          model={model}
          triggerSlotId={view.triggerSlotId}
          affectedSlotId={view.affectedSlotId}
          onBack={() => setView({ kind: 'map' })}
          onPair={(triggerSlotId, affectedSlotId) =>
            setView({ kind: 'together', triggerSlotId, affectedSlotId })
          }
        />
      ) : (
        <MapView
          model={model}
          selected={selected}
          selectedLaneId={selectedLaneId}
          onSelectLane={(slotId) => {
            setSelectedLaneId(slotId);
            setSelected(null);
            const scroller = workspaceRef.current?.closest('.panel-body');
            if (scroller) scroller.scrollTop = 0;
          }}
          onSelect={setSelected}
          onOpen={(cell) => {
            setSelected(cell);
            setSelectedLaneId(cell.slotId);
            setView({ kind: 'stage', cell });
          }}
          onTogether={(room) => setView({ kind: 'together', ...room })}
          onShow={() => setView({ kind: 'show' })}
        />
      )}
    </div>
  );
}

export function TransitionsPanel() {
  const authoring = useTransitionRuleAuthoring();
  return (
    <Panel title="Transitions">
      <TransitionsWorkspace authoring={authoring} />
    </Panel>
  );
}
