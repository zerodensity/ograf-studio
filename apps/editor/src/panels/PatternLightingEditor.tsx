import { LIGHTING_HELP } from './propertyHelp';
import { PropertyRow } from '../components/PropertyRow';
import { useState } from 'react';
import {
  createPatternLighting,
  type TilingPattern,
  type PatternLighting,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';

export function PatternLightingEditor({
  pattern,
  frameRate,
}: {
  pattern: TilingPattern;
  frameRate: number;
}) {
  const composition = useActiveComposition();
  const selected = useSelectionStore((s) => s.selectedLayerIds);
  const setPattern = useProjectStore((s) => s.setTilingPattern);
  const setLink = useProjectStore((s) => s.setLayerLighting);
  const [error, setError] = useState('');
  const settings = pattern.lighting ?? createPatternLighting(pattern.cycleFrames / 8);
  const linked = composition.layers.filter((layer) => layer.lighting?.patternId === pattern.id);
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const update = (patch: Partial<PatternLighting>) =>
    run(() => {
      setPattern({ lighting: patch }, pattern.id);
    });
  const number = (
    label: string,
    key: Exclude<keyof PatternLighting, 'enabled'>,
    min: number,
    max: number,
    step: number,
  ) => (
    <PropertyRow help={LIGHTING_HELP[key]} className="inspector-row" key={key}>
      <span>{label}</span>
      <input
        aria-label={`Shared lighting ${label}`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={settings[key]}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
      />
    </PropertyRow>
  );
  return (
    <details open={Boolean(pattern.lighting)} className="pattern-lighting-editor">
      <summary>Shared lighting · {linked.length} layers</summary>
      <PropertyRow
        help={
          "Enable shared timing and appearance controls for linked light layers. Disabling restores each layer's own timing and authored appearance."
        }
        className="inspector-row"
      >
        <span>Enable controller</span>
        <input
          aria-label="Enable shared lighting"
          type="checkbox"
          checked={Boolean(pattern.lighting?.enabled)}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      </PropertyRow>
      {pattern.lighting && (
        <>
          {number('Cycle frames', 'cycleFrames', 1, 1000000, 1)}
          <p className="inspector-hint">
            {(settings.cycleFrames / frameRate).toFixed(3)} seconds per shared light cycle. Row
            motion keeps its own timing.
          </p>
          {number('Phase', 'phase', 0, 1, 0.01)}
          {number('Intensity', 'intensity', 0, 4, 0.05)}
          {number('Glow strength', 'glow', 0, 4, 0.05)}
          {number('Glow softness', 'softness', 0, 4, 0.05)}
          <p className="inspector-hint">
            1× keeps authored strength and softness. Disabling restores each layer’s own timing and
            appearance.
          </p>
          <div className="resources-tree-actions">
            {(['light', 'glow'] as const).map((role) => (
              <button
                type="button"
                key={role}
                disabled={!selected.length}
                onClick={() =>
                  run(() =>
                    setLink(selected, {
                      patternId: pattern.id,
                      role,
                      phaseOffset: 0,
                      gain: 1,
                      cyclesPerLoop: 1,
                    }),
                  )
                }
              >
                Link selection as {role}
              </button>
            ))}
          </div>
          {linked.length > 0 && (
            <details>
              <summary>Linked layers ({linked.length})</summary>
              {linked.map((layer) => (
                <div className="resources-tree-actions" key={layer.id}>
                  <span>
                    {layer.name} · {layer.lighting!.role}
                  </span>
                  <button
                    type="button"
                    disabled={layer.isLocked}
                    onClick={() => run(() => setLink(layer.id, null))}
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </details>
          )}
          <p className="inspector-hint">
            Sweeps use the linked layer’s infinite lifecycle loop. Its keys, colors and effects stay
            editable. Static layers can share strength and glow.
          </p>
        </>
      )}
      {error && (
        <p className="inspector-hint" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
