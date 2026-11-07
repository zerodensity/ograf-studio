import { useState } from 'react';
import {
  defaultLayerMotionSpec,
  layerMotionDefaultEasing,
  layerMotionDirections,
  layerMotionStagger,
  layerMotionState,
  layerMotionStyleAvailable,
  layerMotionWindows,
  LAYER_MOTION_DEFAULT_DISTANCE,
  LAYER_MOTION_STAGGER_ORDERS,
  type Composition,
  type Layer,
  type LayerMotionDirection,
  type LayerMotionSide,
  type LayerMotionSpec,
  type LayerMotionStagger,
  type LayerMotionStaggerOrder,
  type LayerMotionStyle,
  isAnimationPresetPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import './LayerMotionEditor.css';
import { AnimationPresetGallery } from './AnimationPresetGallery';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { LAYER_MOTION_FEELS as FEELS } from './layerMotionFeels';
import { FrameDurationControl } from './FrameDurationControl';
import { groupMotionPlan } from './groupMotion';
import { runDiscreteHistoryStep } from '../state/historyStore';

const STYLES: Array<[LayerMotionStyle, string]> = [
  ['fade', 'Fade'],
  ['slide', 'Slide'],
  ['fly', 'Fly'],
  ['drop', 'Drop'],
  ['wipe', 'Wipe'],
  ['grow', 'Grow'],
  ['scale', 'Scale'],
  ['pop', 'Pop'],
  ['spin', 'Spin'],
  ['focus', 'Focus'],
];

const UNAVAILABLE_HINT: Partial<Record<LayerMotionStyle, string>> = {
  focus: 'Needs the layer’s built-in blur effect',
  grow: 'Text would reflow while it grows; try Wipe or Scale',
};

/** Arrow, and how to finish "From …" / "To …" for each direction. */
const DIRECTION_LABELS: Record<LayerMotionDirection, [string, string]> = {
  left: ['←', 'left'],
  right: ['→', 'right'],
  up: ['↑', 'top'],
  down: ['↓', 'bottom'],
  center: ['↔', 'centre'],
};

function directionName(
  style: LayerMotionStyle,
  side: LayerMotionSide,
  direction: LayerMotionDirection,
) {
  if (style === 'spin') return direction === 'right' ? 'Clockwise' : 'Counter-clockwise';
  return `${side === 'in' ? 'From' : 'To'} ${DIRECTION_LABELS[direction][1]}`;
}

const STAGGER_ORDER_LABELS: Record<LayerMotionStaggerOrder, string> = {
  'left-to-right': 'Left to right',
  'right-to-left': 'Right to left',
  'top-to-bottom': 'Top to bottom',
  'bottom-to-top': 'Bottom to top',
};

interface LayerMotionEditorProps {
  composition: Composition;
  layer: Layer;
  /** Every selected layer; the choice applies to all unlocked ones. */
  layerIds: string[];
}

function MotionSide({
  composition,
  layer,
  layerIds,
  side,
}: LayerMotionEditorProps & { side: LayerMotionSide }) {
  const setLayerMotion = useProjectStore((state) => state.setLayerMotion);
  const settings = useRendererPluginSettingsStore();
  const [pluginAnchor, setPluginAnchor] = useState<HTMLButtonElement | null>(null);
  const hasPacks = settings.installed.some(
    (entry) => entry.enabled && entry.trusted && isAnimationPresetPluginSnapshot(entry.snapshot),
  );
  const lastApplied = layer.animationPresets?.[side];
  const lastPack = lastApplied
    ? composition.animationPresetPlugins?.find(
        (snapshot) =>
          rendererPluginKey(studioPluginReference(snapshot)) ===
          rendererPluginKey(lastApplied.reference),
      )
    : undefined;
  const lastPreset = lastPack?.presets.find((preset) => preset.id === lastApplied?.presetId);
  const windows = layerMotionWindows(composition);
  const state = layerMotionState(composition, layer, side);
  const spec = state && state !== 'custom' ? state : null;
  const windowFrames = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
  const disabled = layer.isLocked || !windows || windowFrames < 1;
  const group = composition.layers.filter(
    (candidate) => layerIds.includes(candidate.id) && !candidate.isLocked,
  );
  const stagger = group.length > 1 ? layerMotionStagger(composition, group, side) : undefined;
  const apply = (next: LayerMotionSpec | null, nextStagger = stagger) =>
    setLayerMotion(layerIds, side, next, nextStagger);
  const update = (patch: Partial<LayerMotionSpec>) => spec && apply({ ...spec, ...patch });
  const restagger = (patch: Partial<LayerMotionStagger>) =>
    spec && stagger && apply(spec, { ...stagger, ...patch });
  const easing = spec ? (spec.easing ?? layerMotionDefaultEasing(spec.style, side)) : undefined;
  const feel = FEELS.find((candidate) => candidate[side] === easing) ?? FEELS[0]!;
  const directions = spec ? layerMotionDirections(spec.style) : [];
  const label = side === 'in' ? 'In' : 'Out';

  const preview = () => {
    const controller = useTimelineStore.getState().controller;
    if (!controller || !windows) return;
    controller.seek(side === 'in' ? windows.start : windows.lastStep);
    controller.play();
  };

  return (
    <div className="layer-motion-side" data-side={side}>
      <div className="layer-motion-row">
        <span className="layer-motion-label">{label}</span>
        <select
          aria-label={`Animate ${label} style`}
          value={state === 'custom' ? 'custom' : (spec?.style ?? 'none')}
          disabled={disabled}
          onChange={(event) => {
            const style = event.target.value;
            if (style === 'custom') return;
            if (style === 'none') return apply(null);
            const next = defaultLayerMotionSpec(style as LayerMotionStyle, windowFrames);
            const keepDirection =
              spec?.direction && layerMotionDirections(next.style).includes(spec.direction);
            apply(
              spec
                ? {
                    ...next,
                    durationFrames: spec.durationFrames,
                    ...(spec.easing ? { easing: spec.easing } : {}),
                    ...(keepDirection ? { direction: spec.direction } : {}),
                  }
                : next,
            );
          }}
        >
          <option value="none">None (cut)</option>
          {STYLES.map(([style, name]) => (
            <option
              key={style}
              value={style}
              disabled={!layerMotionStyleAvailable(layer, style)}
              title={layerMotionStyleAvailable(layer, style) ? undefined : UNAVAILABLE_HINT[style]}
            >
              {name}
            </option>
          ))}
          {state === 'custom' ? (
            <option value="custom" disabled>
              Custom keys
            </option>
          ) : null}
        </select>
        {spec && directions.length ? (
          <div
            className="layer-motion-directions"
            role="radiogroup"
            aria-label={`${label} direction`}
          >
            {directions.map((direction) => {
              const active = (spec.direction ?? directions[0]) === direction;
              const name = directionName(spec.style, side, direction);
              return (
                <button
                  key={direction}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={name}
                  title={name}
                  className={active ? 'active' : ''}
                  disabled={disabled}
                  onClick={() => update({ direction })}
                >
                  {spec.style === 'spin'
                    ? direction === 'right'
                      ? '↻'
                      : '↺'
                    : DIRECTION_LABELS[direction][0]}
                </button>
              );
            })}
          </div>
        ) : null}
        <button
          type="button"
          className="layer-motion-plugins"
          aria-label={`Animation plugins ${label}`}
          aria-haspopup="dialog"
          aria-expanded={Boolean(pluginAnchor)}
          disabled={layer.isLocked || !windows || !hasPacks}
          title={
            hasPacks
              ? 'Apply a preset pack as editable timeline keys'
              : 'Install an animation preset pack in Plugins'
          }
          onClick={(event) => setPluginAnchor(pluginAnchor ? null : event.currentTarget)}
        >
          Plugins…
        </button>
        <button
          type="button"
          className="layer-motion-preview"
          aria-label={`Preview ${label}`}
          title={`Play the ${side === 'in' ? 'entrance' : 'exit'} on the canvas`}
          disabled={!windows}
          onClick={preview}
        >
          ▶
        </button>
      </div>
      {spec ? (
        <div className="layer-motion-row layer-motion-details">
          <FrameDurationControl
            label={`${label} duration`}
            frames={spec.durationFrames}
            frameRate={composition.frameRate}
            minFrames={1}
            maxFrames={windowFrames}
            disabled={disabled}
            compact
            onChange={(frames) => update({ durationFrames: frames })}
          />
          {spec.style === 'slide' ? (
            <label title="How far it travels, in pixels">
              <input
                aria-label={`${label} distance in pixels`}
                type="number"
                min={0}
                value={spec.distance ?? LAYER_MOTION_DEFAULT_DISTANCE}
                disabled={disabled}
                onChange={(event) => {
                  const distance = Number(event.target.value);
                  if (Number.isFinite(distance) && distance >= 0) update({ distance });
                }}
              />
              px
            </label>
          ) : null}
          <select
            aria-label={`${label} feel`}
            value={feel.label}
            disabled={disabled}
            onChange={(event) => {
              const next = FEELS.find((candidate) => candidate.label === event.target.value);
              if (next) update({ easing: next[side] });
            }}
          >
            {FEELS.map((candidate) => (
              <option key={candidate.label} value={candidate.label}>
                {candidate.label}
              </option>
            ))}
          </select>
          {stagger ? (
            <span className="layer-motion-stagger">
              <FrameDurationControl
                label={`${label} stagger`}
                frames={stagger.frames}
                frameRate={composition.frameRate}
                minFrames={0}
                maxFrames={windowFrames}
                disabled={disabled}
                compact
                onChange={(frames) => restagger({ frames })}
              />
              <select
                aria-label={`${label} stagger order`}
                value={stagger.order}
                disabled={disabled || stagger.frames === 0}
                onChange={(event) =>
                  restagger({ order: event.target.value as LayerMotionStaggerOrder })
                }
              >
                {LAYER_MOTION_STAGGER_ORDERS.map((order) => (
                  <option key={order} value={order}>
                    {STAGGER_ORDER_LABELS[order]}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
        </div>
      ) : state === 'custom' ? (
        <p className="layer-motion-hint">
          This layer has its own keys here. Choosing a style replaces them.
        </p>
      ) : null}
      {lastApplied ? (
        <p className="layer-motion-hint">
          Last applied: {lastPreset?.name || lastApplied.presetId} · editable keys
        </p>
      ) : null}
      {pluginAnchor ? (
        <AnimationPresetGallery
          composition={composition}
          layerIds={layerIds}
          initialSide={side}
          initialReference={lastApplied?.reference}
          initialApplication={lastApplied}
          anchor={pluginAnchor}
          onClose={() => setPluginAnchor(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One-click entrance and exit. Choices bake into ordinary keys between Start and the first Step
 * (In) and between the last Step and End (Out), so the timeline stays the source of truth.
 */
export function LayerMotionEditor(props: LayerMotionEditorProps) {
  const windows = layerMotionWindows(props.composition);
  return (
    <div className="layer-motion-editor">
      {windows ? (
        <>
          {props.layerIds.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                const layers = props.composition.layers.filter((layer) =>
                  props.layerIds.includes(layer.id),
                );
                const plans = (['in', 'out'] as const).map((side) => ({
                  side,
                  items: groupMotionPlan(props.composition, layers, side),
                }));
                runDiscreteHistoryStep(() => {
                  for (const plan of plans)
                    for (const item of plan.items)
                      useProjectStore.getState().setLayerMotion(item.layerId, plan.side, item.spec);
                }, 'Animate group');
              }}
            >
              Animate group
            </button>
          ) : null}
          <MotionSide {...props} side="in" />
          <MotionSide {...props} side="out" />
        </>
      ) : (
        <p className="layer-motion-hint">Add a Step on the timeline to animate in and out.</p>
      )}
    </div>
  );
}
