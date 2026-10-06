import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePicker } from '../components/ImagePicker';
import { ChartPresetGallery } from '../panels/ChartPresetGallery';
import { parseLottieJson } from '@ograf-editor/scene-model';
import { useProjectStore, type NewLayerKind } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { usePatternDialogStore } from '../state/patternDialogStore';
import './AddElementTools.css';

const KINDS: { kind: NewLayerKind; label: string }[] = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'chart', label: 'Chart' },
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'path', label: 'Path' },
  { kind: 'pattern', label: 'Procedural Pattern' },
  { kind: 'image-sequence', label: 'Image Sequence' },
];

function ElementIcon({ kind }: { kind: NewLayerKind }) {
  return (
    <svg className="element-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'pattern' && (
        <>
          <circle cx="7" cy="7" r="3" />
          <circle cx="17" cy="7" r="3" />
          <circle cx="7" cy="17" r="3" />
          <circle cx="17" cy="17" r="3" />
        </>
      )}
      {kind === 'rectangle' && <rect x="3.5" y="5" width="17" height="14" rx="1.4" />}
      {kind === 'ellipse' && <ellipse cx="12" cy="12" rx="8.5" ry="6.8" />}
      {kind === 'chart' && (
        <>
          <path d="M3 3v18h18" />
          <rect x="6" y="12" width="3" height="6" />
          <rect x="11" y="8" width="3" height="10" />
          <rect x="16" y="5" width="3" height="13" />
        </>
      )}
      {kind === 'text' && (
        <>
          <path d="M4 5.5h16M12 5.5v13M8.2 18.5h7.6" />
          <path d="M5.5 5.5v3M18.5 5.5v3" />
        </>
      )}
      {kind === 'image' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
          <circle cx="8.5" cy="9" r="1.6" />
          <path d="m5.5 17 4.2-4.3 2.8 2.7 2.5-2.4 3.5 4" />
        </>
      )}
      {kind === 'path' && (
        <>
          <path d="M5 17C7 7 15 7 19 16" />
          <path d="M5 17 9 8M19 16l-4-8M9 8h6" className="element-tool-guide" />
          <circle cx="5" cy="17" r="1.7" />
          <circle cx="9" cy="8" r="1.35" />
          <circle cx="15" cy="8" r="1.35" />
          <circle cx="19" cy="16" r="1.7" />
        </>
      )}
      {kind === 'image-sequence' && (
        <>
          <rect x="5.5" y="3.5" width="14.5" height="12" rx="1.4" />
          <path d="M3.5 7.5v11.2c0 1 .8 1.8 1.8 1.8h13.2" />
          <circle cx="10" cy="7.8" r="1.2" />
          <path d="m7.5 13 3-2.8 2.1 2 2-1.8 2.8 2.6" />
        </>
      )}
      {kind === 'lottie' && (
        <>
          <path d="M5.2 14.8c1.3 3.4 5.3 5.1 8.8 3.8 3.6-1.3 5.4-5.3 4-8.8-1.3-3.4-5.2-5.2-8.7-4" />
          <path d="M5.2 14.8 4 10.7M5.2 14.8l4-1.4" />
          <path d="m11.2 9 4.3 3-4.3 3z" />
        </>
      )}
    </svg>
  );
}

/** Buttons that add a new layer, shown at the top of the Layers panel. */
export function AddElementTools() {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [chartPickerOpen, setChartPickerOpen] = useState(false);
  const addLayer = useProjectStore((s) => s.addLayer);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const renameLayer = useProjectStore((s) => s.renameLayer);
  const select = useSelectionStore((s) => s.select);
  const lottieInputRef = useRef<HTMLInputElement>(null);

  const importLottie = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const animationData = parseLottieJson(await file.text());
      const layerId = addLayer('lottie');
      updateLayerElement(layerId, { animationData });
      renameLayer(layerId, file.name.replace(/\.json$/i, '') || 'Lottie');
      select(layerId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="add-element-tools">
      <div className="element-tools" role="group" aria-label="Add element">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="element-tool-button"
            data-editor-shortcuts="allow"
            aria-label={`Add ${label}`}
            title={`Add ${label}`}
            data-tooltip={label}
            onClick={() => {
              if (kind === 'chart') setChartPickerOpen((open) => !open);
              else if (kind === 'image') setImagePickerOpen(true);
              else if (kind === 'pattern') usePatternDialogStore.getState().open();
              else select(addLayer(kind));
            }}
          >
            <ElementIcon kind={kind} />
          </button>
        ))}
        <button
          type="button"
          className="element-tool-button"
          data-editor-shortcuts="allow"
          aria-label="Add Lottie JSON"
          title="Add Lottie JSON"
          data-tooltip="Lottie"
          onClick={() => lottieInputRef.current?.click()}
        >
          <ElementIcon kind="lottie" />
        </button>
      </div>
      <input
        ref={lottieInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void importLottie(event)}
      />
      {imagePickerOpen && <ImagePicker onClose={() => setImagePickerOpen(false)} />}
      {chartPickerOpen && (
        <div className="chart-picker-popover" role="dialog" aria-label="Choose chart type">
          <div className="chart-picker-header">
            <span>Choose chart type</span>
            <button
              type="button"
              aria-label="Close chart gallery"
              onClick={() => setChartPickerOpen(false)}
            >
              ×
            </button>
          </div>
          <ChartPresetGallery
            onSelect={(preset) => {
              const id = addLayer('chart');
              updateLayerElement(id, { preset });
              select(id);
              setChartPickerOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
