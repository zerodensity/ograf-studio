import { useEffect, useState } from 'react';
import {
  chartMarkAnimationKind,
  layerMotionWindows,
  studioPluginReference,
  type ChartElement,
  type ChartMarkAnimationPhase,
  type Composition,
  type StudioPluginReference,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import {
  chartMarkAnimationChoiceKey,
  chartMarkAnimationDraft,
  chartMarkAnimationPacks,
  parseChartMarkAnimationDraft,
  type ChartMarkAnimationPack,
} from '../state/chartMarkAnimationEditing';
import './ChartMarkAnimationEditor.css';
import { FrameDurationControl } from './FrameDurationControl';

type Options = Omit<ChartMarkAnimationPhase, 'reference' | 'presetId'>;
interface ControlsProps {
  element: ChartElement;
  side: 'in' | 'out';
  packs: ChartMarkAnimationPack[];
  availableFrames: number;
  frameRate: number;
  disabled?: boolean;
  canClear?: boolean;
  onApply(reference: StudioPluginReference, presetId: string, options: Options): void;
  onClear(): void;
}

/** Numeric edits stay local until Apply, including plugin parameters. */
export function ChartMarkAnimationControls({
  element,
  side,
  packs,
  availableFrames,
  frameRate,
  disabled,
  canClear = true,
  onApply,
  onClear,
}: ControlsProps) {
  const phase = element.markAnimations?.[side];
  const savedKey = chartMarkAnimationChoiceKey(phase);
  const entries = packs.flatMap((pack) =>
    pack.presets.map((preset) => ({
      ...pack,
      preset,
      key: chartMarkAnimationChoiceKey({
        reference: studioPluginReference(pack.snapshot),
        presetId: preset.id,
      }),
    })),
  );
  const savedPreset = entries.find((entry) => entry.key === savedKey)?.preset;
  const [choice, setChoice] = useState(savedKey);
  const [draft, setDraft] = useState(() =>
    chartMarkAnimationDraft(phase, savedPreset, availableFrames),
  );
  const [error, setError] = useState('');
  // Changing objects or undoing an Apply replaces the draft; ordinary plugin catalog reads do not.
  useEffect(() => {
    setChoice(savedKey);
    setDraft(chartMarkAnimationDraft(phase, savedPreset, availableFrames));
    setError('');
  }, [phase, savedKey, availableFrames, savedPreset]);
  const selected = entries.find((entry) => entry.key === choice);
  const missing = !!choice && !selected;
  const label = side === 'in' ? 'In' : 'Out';
  return (
    <div className="chart-mark-animation-side" data-side={side}>
      <div className="chart-mark-animation-choice">
        <label>
          <span>{label}</span>
          <select
            aria-label={`Bars / slices ${label} animation`}
            value={choice}
            disabled={disabled}
            onChange={(event) => {
              const key = event.currentTarget.value;
              const next = entries.find((entry) => entry.key === key);
              setChoice(key);
              setDraft(
                chartMarkAnimationDraft(
                  key === savedKey ? phase : undefined,
                  next?.preset,
                  availableFrames,
                ),
              );
              setError('');
            }}
          >
            <option value="">{side === 'in' ? 'Use chart animation' : 'None'}</option>
            {packs.map((pack) => (
              <optgroup
                key={JSON.stringify(studioPluginReference(pack.snapshot))}
                label={`${pack.snapshot.manifest.name} ${pack.snapshot.manifest.version}${pack.retained ? ' · saved pack' : ''}`}
              >
                {pack.presets.map((preset) => (
                  <option
                    key={preset.id}
                    value={chartMarkAnimationChoiceKey({
                      reference: studioPluginReference(pack.snapshot),
                      presetId: preset.id,
                    })}
                  >
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {missing && (
              <option value={choice} disabled>
                Unavailable saved preset · {phase?.presetId}
              </option>
            )}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || !selected}
          onClick={() => {
            if (!selected) return;
            try {
              const options = parseChartMarkAnimationDraft(
                draft,
                selected.preset,
                element,
                availableFrames,
              );
              onApply(studioPluginReference(selected.snapshot), selected.preset.id, options);
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Apply
        </button>
        <button
          type="button"
          aria-label={`Clear bars / slices ${label} animation`}
          disabled={!canClear || !phase}
          onClick={() => {
            try {
              onClear();
              setChoice('');
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Clear
        </button>
      </div>
      {selected && (
        <div className="chart-mark-animation-options">
          {(
            [
              ['durationFrames', 'Duration', 1, 1500],
              ['delayFrames', 'Delay', 0, 1500],
              ['staggerFrames', 'Stagger', 0, 100],
            ] as const
          ).map(([key, title, min, max]) => (
            <FrameDurationControl
              key={key}
              compact
              label={`Bars / slices ${label} ${title.toLowerCase()}`}
              frames={Number(draft[key]) || 0}
              frameRate={frameRate}
              minFrames={min}
              maxFrames={max}
              disabled={disabled}
              onChange={(frames) => setDraft({ ...draft, [key]: String(frames) })}
            />
          ))}
          {(selected.preset.parameters ?? []).map((parameter) => (
            <label key={parameter.id}>
              <span>{parameter.label}</span>
              <input
                aria-label={`Bars / slices ${label}: ${parameter.label}`}
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={draft.parameters[parameter.id] ?? String(parameter.default)}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    parameters: { ...draft.parameters, [parameter.id]: event.currentTarget.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      {missing && (
        <p className="chart-editor-error" role="alert">
          This saved preset is missing or incompatible. Choose a compatible preset or Clear; no
          animation is substituted.
        </p>
      )}
      {error && (
        <p className="chart-editor-error" role="alert">
          {error}
        </p>
      )}
      <small className="chart-mark-animation-hint">
        {availableFrames} f available · duration + delay + all staggered marks must fit.
      </small>
    </div>
  );
}

export function ChartMarkAnimationEditor({
  composition,
  element,
  layerId,
  supported,
}: {
  composition: Composition;
  element: ChartElement;
  layerId?: string;
  supported: boolean;
}) {
  const settings = useRendererPluginSettingsStore();
  const initialize = settings.initialize;
  const apply = useProjectStore((state) => state.applyChartMarkPreset);
  const clear = useProjectStore((state) => state.clearChartMarkPreset);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  const windows = layerMotionWindows(composition);
  const kind = chartMarkAnimationKind(element.preset);
  const locked = !layerId || !!composition.layers.find((layer) => layer.id === layerId)?.isLocked;
  return (
    <details
      className="chart-mark-animation-editor"
      open={!!element.markAnimations?.in || !!element.markAnimations?.out}
    >
      <summary>Bars / slices animation</summary>
      {!supported && (
        <p className="chart-mark-animation-hint">
          Choose Chart.js renderer 1.3.0 or another renderer supporting mark-animation-v1.
        </p>
      )}
      {!kind && (
        <p className="chart-mark-animation-hint">
          Individual animation supports bar, horizontal bar, stacked bar, pie, doughnut and polar
          area charts. Line, area and radar are not supported.
        </p>
      )}
      {!windows && (
        <p className="chart-mark-animation-hint">
          Add a Step on the timeline to provide In and Out windows.
        </p>
      )}
      {(settings.loading || !settings.initialized) && (
        <p className="chart-mark-animation-hint" role="status">
          Loading animation plugins…
        </p>
      )}
      {settings.error && (
        <p className="chart-editor-error" role="alert">
          Could not load animation plugins: {settings.error}{' '}
          <button type="button" disabled={settings.loading} onClick={() => void settings.refresh()}>
            Retry
          </button>
        </p>
      )}
      {(['in', 'out'] as const).map((side) => (
        <ChartMarkAnimationControls
          key={`${layerId ?? ''}:${side}`}
          element={element}
          side={side}
          packs={chartMarkAnimationPacks(composition, element, settings.installed, side)}
          availableFrames={windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0}
          frameRate={composition.frameRate}
          disabled={locked || !supported || !kind || !windows}
          canClear={!locked}
          onApply={(reference, presetId, options) =>
            apply(layerId!, reference, presetId, side, options)
          }
          onClear={() => clear(layerId!, side)}
        />
      ))}
      <p className="chart-mark-animation-hint">
        In replaces the built-in chart entrance. Data updates keep their chart update behavior;
        Animate In / Out still controls the whole chart.
      </p>
    </details>
  );
}
