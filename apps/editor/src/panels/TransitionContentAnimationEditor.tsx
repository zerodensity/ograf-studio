import { useEffect } from 'react';
import {
  layerMotionDefaultEasing,
  layerMotionDirections,
  studioPluginReference,
  type AnimationPresetPluginSnapshot,
  type EasingPreset,
  type LayerMotionDirection,
  type LayerMotionSide,
  type TransitionLogicContentAnimation,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import {
  defaultTransitionContentMotion,
  TRANSITION_CONTENT_MOTIONS,
  transitionAnimationChoiceKey,
  transitionAnimationPacks,
  transitionAnimationPresetKey,
} from '../state/transitionContentAnimationEditing';
import './TransitionContentAnimationEditor.css';

const DIRECTIONS: Record<LayerMotionDirection, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Top',
  down: 'Bottom',
  center: 'Centre',
};
const FEELS: Array<{ label: string; in: EasingPreset; out: EasingPreset }> = [
  { label: 'Smooth', in: 'cubic-out', out: 'cubic-in' },
  { label: 'Gentle', in: 'sine-out', out: 'sine-in' },
  { label: 'Snappy', in: 'expo-out', out: 'expo-in' },
  { label: 'Overshoot', in: 'back-out', out: 'back-in' },
  { label: 'Bounce', in: 'bounce-out', out: 'bounce-in' },
  { label: 'Elastic', in: 'elastic-out', out: 'elastic-in' },
  { label: 'Linear', in: 'linear', out: 'linear' },
];

interface Props {
  definition: TransitionLogicDefinition;
  side: LayerMotionSide;
  value?: TransitionLogicContentAnimation;
  frames: number;
  frameRate: number;
  disabled?: boolean;
  onChange: (
    value: TransitionLogicContentAnimation | undefined,
    snapshot?: AnimationPresetPluginSnapshot,
  ) => void;
}

/** One content wrapper, separate from shared-object morphing and existing phase timing. */
export function TransitionContentAnimationEditor({
  definition,
  side,
  value,
  frames,
  frameRate,
  disabled,
  onChange,
}: Props) {
  const installed = useRendererPluginSettingsStore((state) => state.installed);
  const initialize = useRendererPluginSettingsStore((state) => state.initialize);
  const refresh = useRendererPluginSettingsStore((state) => state.refresh);
  const loading = useRendererPluginSettingsStore((state) => state.loading);
  const initialized = useRendererPluginSettingsStore((state) => state.initialized);
  const catalogError = useRendererPluginSettingsStore((state) => state.error);
  useEffect(() => {
    // Transitions may be opened before Plugins. This only reads the existing local catalog.
    void initialize();
  }, [initialize]);
  const packs = transitionAnimationPacks(definition, installed, side);
  const key = transitionAnimationChoiceKey(value);
  const label = side === 'in' ? 'Incoming animation' : 'Outgoing animation';
  const selected = packs
    .flatMap((pack) => pack.presets.map((preset) => ({ ...pack, preset })))
    .find((entry) => transitionAnimationPresetKey(entry.snapshot, entry.preset) === key);
  const missing = value?.type === 'plugin' && !selected;
  const motion = value?.type === 'builtin' ? value.motion : null;
  const directions = motion ? layerMotionDirections(motion.style) : [];
  const easing = motion
    ? (motion.easing ?? layerMotionDefaultEasing(motion.style, side))
    : undefined;
  const feel = FEELS.find((entry) => entry[side] === easing);
  return (
    <div className="tr-content-animation" data-side={side}>
      <label className="tr-content-animation-choice">
        <span>{label}</span>
        <select
          aria-label={label}
          value={key}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === 'default') return onChange(undefined);
            if (next === 'template') return onChange({ type: 'template' });
            const builtin = TRANSITION_CONTENT_MOTIONS.find(
              ([style]) => next === `builtin:${style}`,
            );
            if (builtin) return onChange(defaultTransitionContentMotion(builtin[0]));
            const plugin = packs
              .flatMap((pack) => pack.presets.map((preset) => ({ ...pack, preset })))
              .find((entry) => transitionAnimationPresetKey(entry.snapshot, entry.preset) === next);
            if (plugin)
              onChange(
                {
                  type: 'plugin',
                  reference: studioPluginReference(plugin.snapshot),
                  presetId: plugin.preset.id,
                  parameters: Object.fromEntries(
                    (plugin.preset.parameters ?? []).map((parameter) => [
                      parameter.id,
                      parameter.default,
                    ]),
                  ),
                },
                plugin.snapshot,
              );
          }}
        >
          <option value="default">Transition style (default)</option>
          <option value="template">Template animation</option>
          <optgroup label="Built-in animations">
            {TRANSITION_CONTENT_MOTIONS.map(([style, name]) => (
              <option key={style} value={`builtin:${style}`}>
                {name}
              </option>
            ))}
          </optgroup>
          {packs.map((pack) => (
            <optgroup
              key={JSON.stringify(studioPluginReference(pack.snapshot))}
              label={`${pack.snapshot.manifest.name} ${pack.snapshot.manifest.version}${pack.retained ? ' · saved pack' : ''}`}
            >
              {pack.presets.map((preset) => (
                <option key={preset.id} value={transitionAnimationPresetKey(pack.snapshot, preset)}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          ))}
          {missing && (
            <option value={key} disabled>
              Unavailable saved animation · {value.presetId}
            </option>
          )}
        </select>
      </label>
      {(loading || !initialized) && (
        <small className="tr-content-animation-duration" role="status">
          Loading animation plugins…
        </small>
      )}
      {catalogError && (
        <small className="tr-content-animation-error" role="alert">
          Could not load animation plugins: {catalogError}{' '}
          <button type="button" disabled={loading} onClick={() => void refresh()}>
            Retry
          </button>
        </small>
      )}
      {motion && (
        <div className="tr-content-animation-options">
          {!!directions.length && (
            <label>
              <span>{motion.style === 'spin' ? 'Rotation' : side === 'in' ? 'From' : 'To'}</span>
              <select
                aria-label={`${label} direction`}
                value={motion.direction ?? directions[0]}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    type: 'builtin',
                    motion: {
                      ...motion,
                      direction: event.currentTarget.value as LayerMotionDirection,
                    },
                  })
                }
              >
                {directions.map((direction) => (
                  <option key={direction} value={direction}>
                    {motion.style === 'spin'
                      ? direction === 'right'
                        ? 'Clockwise'
                        : 'Counter-clockwise'
                      : DIRECTIONS[direction]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {motion.style === 'slide' && (
            <label>
              <span>Distance (px)</span>
              <input
                aria-label={`${label} distance`}
                type="number"
                min={0}
                value={motion.distance ?? 80}
                disabled={disabled}
                onChange={(event) => {
                  const distance = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(distance) && distance >= 0)
                    onChange({ type: 'builtin', motion: { ...motion, distance } });
                }}
              />
            </label>
          )}
          <label>
            <span>Feel</span>
            <select
              aria-label={`${label} feel`}
              value={feel?.label ?? 'custom'}
              disabled={disabled}
              onChange={(event) => {
                const next = FEELS.find((entry) => entry.label === event.currentTarget.value);
                if (next) onChange({ type: 'builtin', motion: { ...motion, easing: next[side] } });
              }}
            >
              {FEELS.map((entry) => (
                <option key={entry.label} value={entry.label}>
                  {entry.label}
                </option>
              ))}
              {!feel && (
                <option value="custom" disabled>
                  Custom easing
                </option>
              )}
            </select>
          </label>
        </div>
      )}
      {value?.type === 'plugin' && selected && !!selected.preset.parameters?.length && (
        <div className="tr-content-animation-options">
          {selected.preset.parameters.map((parameter) => (
            <label key={parameter.id}>
              <span>{parameter.label}</span>
              <input
                aria-label={`${label}: ${parameter.label}`}
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={value.parameters?.[parameter.id] ?? parameter.default}
                disabled={disabled}
                onChange={(event) => {
                  const number = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(number) && number >= parameter.min && number <= parameter.max)
                    onChange({
                      ...value,
                      parameters: { ...value.parameters, [parameter.id]: number },
                    });
                }}
              />
            </label>
          ))}
        </div>
      )}
      {missing && (
        <small className="tr-content-animation-error" role="alert">
          The saved preset is missing or incompatible with this side. Choose another animation; it
          is not replaced automatically.
        </small>
      )}
      <small className="tr-content-animation-duration">
        Uses {side === 'in' ? 'reveal' : 'hide'} duration · {frames} f ·{' '}
        {(frames / frameRate).toFixed(2)} s
      </small>
    </div>
  );
}
