import { useRef, useState } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { colorPickerValue } from '../canvas/compositionBackground';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from './compositionPresets';
import { FrameDurationControl } from './FrameDurationControl';
import type { CanvasPresentationBackground } from '@ograf-editor/scene-model';

const MAX_PRESENTATION_IMAGE_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

export function CompositionSettings() {
  const presentationImageInputRef = useRef<HTMLInputElement>(null);
  const [presentationImageError, setPresentationImageError] = useState('');
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
  const presentationImageSource = composition.layout.presentationBackgroundImageSource;
  const presentationImageIsEmbedded = presentationImageSource.startsWith('data:image/');

  const importPresentationImage = async (file: File | undefined) => {
    if (!file) return;
    setPresentationImageError('');
    if (!file.type.startsWith('image/')) {
      setPresentationImageError('Choose a supported image file.');
      return;
    }
    if (file.size > MAX_PRESENTATION_IMAGE_BYTES) {
      setPresentationImageError('The presentation image must be 10 MB or smaller.');
      return;
    }
    try {
      updateLayout({
        presentationBackground: 'still-image',
        presentationBackgroundImageSource: await readFileAsDataUrl(file),
        presentationBackgroundImageName: file.name,
      });
    } catch (error) {
      setPresentationImageError(
        error instanceof Error ? error.message : 'Failed to read the selected image.',
      );
    }
  };

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
          ['showActionSafe', 'Action safe · EBU R 95 (3.5%)'],
          ['showTitleSafe', 'Title safe · EBU R 95 (5%)'],
          ['showCenterMarker', 'Center marker'],
          ['dimOutsideCanvas', 'Outside canvas · 20% gray'],
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
      <label className="inspector-row">
        <span>Presentation background</span>
        <select
          value={composition.layout.presentationBackground}
          onChange={(event) =>
            updateLayout({
              presentationBackground: event.target.value as CanvasPresentationBackground,
            })
          }
        >
          <option value="none">None</option>
          <option value="big-buck-bunny">Big Buck Bunny · looping video</option>
          <option value="still-image">Still image</option>
        </select>
      </label>
      {composition.layout.presentationBackground === 'big-buck-bunny' ? (
        <p className="inspector-hint">
          Editor-only video bed; use Transparent output to see it through the composition. Big Buck
          Bunny © 2008 Blender Foundation,{' '}
          <a href="https://peach.blender.org/about/" target="_blank" rel="noreferrer">
            CC BY 3.0
          </a>
          .
        </p>
      ) : null}
      {composition.layout.presentationBackground === 'still-image' ? (
        <div className="inspector-presentation-background-controls">
          <label className="inspector-row inspector-row-stacked">
            <span>Image URL</span>
            <input
              type="url"
              value={presentationImageIsEmbedded ? '' : presentationImageSource}
              placeholder="https://example.com/background.jpg"
              onChange={(event) => {
                setPresentationImageError('');
                updateLayout({
                  presentationBackgroundImageSource: event.target.value,
                  presentationBackgroundImageName: '',
                });
              }}
            />
          </label>
          <div className="inspector-button-row">
            <button type="button" onClick={() => presentationImageInputRef.current?.click()}>
              Choose local image…
            </button>
            {presentationImageSource ? (
              <button
                type="button"
                onClick={() => {
                  setPresentationImageError('');
                  updateLayout({
                    presentationBackgroundImageSource: '',
                    presentationBackgroundImageName: '',
                  });
                }}
              >
                Clear
              </button>
            ) : null}
            <input
              ref={presentationImageInputRef}
              className="inspector-file-input"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void importPresentationImage(file);
              }}
            />
          </div>
          <p className="inspector-hint">
            {presentationImageIsEmbedded
              ? `${composition.layout.presentationBackgroundImageName || 'Local image'} is embedded in this .ogs project.`
              : presentationImageSource
                ? 'Using the image URL above.'
                : 'Enter an image URL or choose a local image up to 10 MB.'}{' '}
            This background is editor-only and is not exported.
          </p>
          {presentationImageError ? (
            <p className="inspector-error">{presentationImageError}</p>
          ) : null}
        </div>
      ) : null}
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
