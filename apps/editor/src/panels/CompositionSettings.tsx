import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { colorPickerValue } from '../canvas/compositionBackground';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from './compositionPresets';
import { FrameDurationControl } from './FrameDurationControl';

export function CompositionSettings() {
  const composition = useActiveComposition();
  const project = useProjectStore((s) => s.project);
  const setProjectMeta = useProjectStore((s) => s.setProjectMeta);
  const update = useProjectStore((s) => s.updateCompositionSettings);
  const updateLayout = useProjectStore((s) => s.updateCompositionLayout);
  const addGuide = useProjectStore((s) => s.addCanvasGuide);
  const updateGuide = useProjectStore((s) => s.updateCanvasGuide);
  const removeGuide = useProjectStore((s) => s.removeCanvasGuide);

  const activePresetIndex = COMPOSITION_PRESETS.findIndex((preset) =>
    matchesCompositionPreset(preset, composition.width, composition.height, composition.frameRate),
  );
  const isTransparent = composition.backgroundColor === 'transparent';
  const pickerColor = colorPickerValue(composition.backgroundColor);

  return (
    <div className="inspector">
      <p className="panel-placeholder">Nothing selected — editing composition settings.</p>

      <h3 className="inspector-section">Composition</h3>
      <label className="inspector-row">
        <span>Name</span>
        <input
          type="text"
          value={composition.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>

      <label className="inspector-row">
        <span>Preset</span>
        <select
          value={activePresetIndex}
          onChange={(e) => {
            const preset = COMPOSITION_PRESETS[Number(e.target.value)];
            if (preset)
              update({ width: preset.width, height: preset.height, frameRate: preset.frameRate });
          }}
        >
          {activePresetIndex === -1 && <option value={-1}>Custom</option>}
          {COMPOSITION_PRESETS.map((preset, i) => (
            <option key={preset.label} value={i}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <div className="inspector-grid">
        <label className="inspector-row">
          <span>Width</span>
          <input
            type="number"
            min={1}
            value={composition.width}
            onChange={(e) => update({ width: Number(e.target.value) })}
          />
        </label>
        <label className="inspector-row">
          <span>Height</span>
          <input
            type="number"
            min={1}
            value={composition.height}
            onChange={(e) => update({ height: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="inspector-row">
        <span>Frame rate</span>
        <input
          type="number"
          min={1}
          step="any"
          value={Number(composition.frameRate.toFixed(3))}
          onChange={(e) => update({ frameRate: Number(e.target.value) })}
        />
      </label>
      <FrameDurationControl
        label="Update crossfade"
        frames={composition.updateTransitionFrames}
        frameRate={composition.frameRate}
        minFrames={0}
        onChange={(updateTransitionFrames) => update({ updateTransitionFrames })}
      />

      <h3 className="inspector-section">Render modes</h3>
      <label className="inspector-row inspector-checkbox-row">
        <span>Real-time</span>
        <input
          type="checkbox"
          checked={project.supportsRealTime}
          onChange={(event) => setProjectMeta({ supportsRealTime: event.target.checked })}
        />
      </label>
      <label className="inspector-row inspector-checkbox-row">
        <span>Non-real-time</span>
        <input
          type="checkbox"
          checked={project.supportsNonRealTime}
          onChange={(event) => setProjectMeta({ supportsNonRealTime: event.target.checked })}
        />
      </label>

      <h3 className="inspector-section">Background</h3>
      <label className="inspector-row">
        <span>Transparent output</span>
        <input
          type="checkbox"
          checked={isTransparent}
          onChange={(e) =>
            update({ backgroundColor: e.target.checked ? 'transparent' : '#000000' })
          }
        />
      </label>
      <label className="inspector-row inspector-background-color">
        <span>Color</span>
        <input
          type="color"
          value={pickerColor}
          onInput={(e) => update({ backgroundColor: e.currentTarget.value })}
        />
      </label>
      {isTransparent && (
        <p className="inspector-hint">
          The checkerboard is editor-only and will not be exported. Choosing a color switches to an
          opaque background.
        </p>
      )}

      <h3 className="inspector-section">Canvas layout</h3>
      {(
        [
          ['showRulers', 'Rulers'],
          ['showActionSafe', 'Action safe (5%)'],
          ['showTitleSafe', 'Title safe (10%)'],
          ['snappingEnabled', 'Snapping'],
          ['snapToGrid', 'Snap to grid'],
          ['snapToGuides', 'Snap to guides'],
          ['snapToLayers', 'Snap to layers'],
        ] as const
      ).map(([key, label]) => (
        <label className="inspector-row inspector-checkbox-row" key={key}>
          <span>{label}</span>
          <input
            type="checkbox"
            checked={composition.layout[key]}
            onChange={(event) => updateLayout({ [key]: event.target.checked })}
          />
        </label>
      ))}
      <div className="inspector-grid">
        <label className="inspector-row">
          <span>Grid</span>
          <input
            type="number"
            min={1}
            value={composition.layout.gridSize}
            onChange={(event) => updateLayout({ gridSize: Number(event.target.value) })}
          />
        </label>
        <label className="inspector-row">
          <span>Threshold</span>
          <input
            type="number"
            min={0}
            value={composition.layout.snapThreshold}
            onChange={(event) => updateLayout({ snapThreshold: Number(event.target.value) })}
          />
        </label>
      </div>
      <label className="inspector-row">
        <span>Bounds</span>
        <select
          value={composition.layout.boundsMode}
          onChange={(event) =>
            updateLayout({ boundsMode: event.target.value as 'allow' | 'contain' })
          }
        >
          <option value="allow">Allow outside</option>
          <option value="contain">Contain in canvas</option>
        </select>
      </label>
      <label className="inspector-row">
        <span>Overflow preview</span>
        <select
          value={composition.layout.overflowPreview}
          onChange={(event) =>
            updateLayout({ overflowPreview: event.target.value as 'visible' | 'clip' })
          }
        >
          <option value="visible">Show pasteboard objects</option>
          <option value="clip">Clip to canvas</option>
        </select>
      </label>

      <h3 className="inspector-section">Guides</h3>
      <div className="inspector-button-row">
        <button type="button" onClick={() => addGuide('vertical')}>
          + Vertical
        </button>
        <button type="button" onClick={() => addGuide('horizontal')}>
          + Horizontal
        </button>
      </div>
      {composition.layout.guides.map((guide) => (
        <label className="inspector-row" key={guide.id}>
          <span>{guide.axis === 'vertical' ? 'V' : 'H'}</span>
          <input
            type="number"
            value={guide.position}
            onChange={(event) => updateGuide(guide.id, Number(event.target.value))}
          />
          <button type="button" title="Remove guide" onClick={() => removeGuide(guide.id)}>
            ×
          </button>
        </label>
      ))}
    </div>
  );
}
