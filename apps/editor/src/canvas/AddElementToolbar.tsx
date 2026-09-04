import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePicker } from '../components/ImagePicker';
import { parseLottieJson } from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore, type NewLayerKind } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { isPersistentGroupSelection } from './groupSelection';
import { arrangeSelectedLayers, type LayerArrangeAction } from '../state/layerZOrder';
import './AddElementToolbar.css';

const KINDS: { kind: NewLayerKind; label: string }[] = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
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

const ARRANGE_ACTIONS: Array<{ action: LayerArrangeAction; label: string }> = [
  { action: 'send-to-back', label: 'Send to Back' },
  { action: 'send-backward', label: 'Send Backward' },
  { action: 'bring-forward', label: 'Bring Forward' },
  { action: 'bring-to-front', label: 'Bring to Front' },
];

function ArrangeIcon({ action }: { action: LayerArrangeAction }) {
  const movesForward = action === 'bring-forward' || action === 'bring-to-front';
  const movesToEnd = action === 'send-to-back' || action === 'bring-to-front';
  return (
    <svg className="arrange-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="8.5" width="9.5" height="9.5" rx="1" />
      <rect x="7.5" y="4.5" width="9.5" height="9.5" rx="1" />
      <path
        d={movesForward ? 'M20 15V5M17.5 7.5 20 5l2.5 2.5' : 'M20 5v10m-2.5-2.5L20 15l2.5-2.5'}
      />
      {movesToEnd && <path d={movesForward ? 'M17.5 3h5' : 'M17.5 17h5'} />}
    </svg>
  );
}

export function AddElementToolbar() {
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const composition = useActiveComposition();
  const addLayer = useProjectStore((s) => s.addLayer);
  const addLowerThird = useProjectStore((s) => s.addLowerThird);
  const addBug = useProjectStore((s) => s.addBug);
  const addTicker = useProjectStore((s) => s.addTicker);
  const addScoreboard = useProjectStore((s) => s.addScoreboard);
  const addClock = useProjectStore((s) => s.addClock);
  const addRepeater = useProjectStore((s) => s.addRepeater);
  const alignLayers = useProjectStore((s) => s.alignLayers);
  const distributeLayers = useProjectStore((s) => s.distributeLayers);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const select = useSelectionStore((s) => s.select);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const updateLayerElement = useProjectStore((s) => s.updateLayerElement);
  const renameLayer = useProjectStore((s) => s.renameLayer);
  const lottieInputRef = useRef<HTMLInputElement>(null);
  const selectionIsPersistentGroup = isPersistentGroupSelection(composition, selectedLayerIds);
  const orderedLayerIds = composition.layers.map((layer) => layer.id);

  const arrangementFor = (action: LayerArrangeAction) =>
    arrangeSelectedLayers(orderedLayerIds, selectedLayerIds, action);

  const canArrange = (action: LayerArrangeAction) =>
    arrangementFor(action).some((layerId, index) => layerId !== orderedLayerIds[index]);

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

  const addRecipe = (event: ChangeEvent<HTMLSelectElement>) => {
    const recipe = event.target.value;
    event.target.value = '';
    const result =
      recipe === 'lower-third'
        ? addLowerThird()
        : recipe === 'bug'
          ? addBug()
          : recipe === 'ticker'
            ? addTicker()
            : recipe === 'scoreboard'
              ? addScoreboard()
              : recipe === 'clock'
                ? addClock()
                : null;
    if (result) selectMany(Object.values(result.layers));
  };

  return (
    <div className="add-element-toolbar">
      <select
        className="recipe-select"
        aria-label="Add broadcast recipe"
        defaultValue=""
        onChange={addRecipe}
      >
        <option value="" disabled>
          + Recipe…
        </option>
        <option value="lower-third">Lower Third</option>
        <option value="bug">Bug / DOG</option>
        <option value="ticker">Ticker / Crawl</option>
        <option value="scoreboard">Scoreboard</option>
        <option value="clock">Clock</option>
      </select>
      {selectedLayerIds.length > 0 && (
        <button
          type="button"
          title="Materialize the selected item as a three-item horizontal data repeater"
          onClick={() => {
            const repeater = addRepeater(selectedLayerIds);
            if (repeater) {
              selectMany(repeater.items.flatMap((item) => Object.values(item.layers)));
            }
          }}
        >
          Repeat ×3
        </button>
      )}
      <div className="element-tools" role="group" aria-label="Add element">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="element-tool-button"
            aria-label={`Add ${label}`}
            title={`Add ${label}`}
            data-tooltip={label}
            onClick={() => (kind === 'image' ? setImagePickerOpen(true) : select(addLayer(kind)))}
          >
            <ElementIcon kind={kind} />
          </button>
        ))}
        <button
          type="button"
          className="element-tool-button"
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
      {selectedLayerIds.length > 0 && (
        <div className="arrange-toolbar" role="group" aria-label="Arrange selected layers">
          {ARRANGE_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className="arrange-tool-button"
              aria-label={label}
              title={label}
              data-tooltip={label}
              disabled={!canArrange(action)}
              onClick={() => reorderLayers(arrangementFor(action))}
            >
              <ArrangeIcon action={action} />
            </button>
          ))}
        </div>
      )}
      {selectedLayerIds.length > 1 && (
        <div className="layout-toolbar" role="group" aria-label="Align and group selected layers">
          {[
            ['left', 'Align left', '⇤'],
            ['horizontal-center', 'Align horizontal centers', '↔'],
            ['right', 'Align right', '⇥'],
            ['top', 'Align top', '↥'],
            ['vertical-center', 'Align vertical centers', '↕'],
            ['bottom', 'Align bottom', '↧'],
          ].map(([mode, title, label]) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() =>
                alignLayers(
                  selectedLayerIds,
                  currentFrame,
                  mode as Parameters<typeof alignLayers>[2],
                )
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            title="Distribute horizontally"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'horizontal')}
          >
            H≡
          </button>
          <button
            type="button"
            title="Distribute vertically"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'vertical')}
          >
            V≡
          </button>
          <span className="layout-toolbar-divider" aria-hidden="true" />
          {selectionIsPersistentGroup ? (
            <button type="button" onClick={() => ungroupLayers(selectedLayerIds)}>
              Ungroup
            </button>
          ) : (
            <button type="button" onClick={() => groupLayers(selectedLayerIds)}>
              Group
            </button>
          )}
        </div>
      )}
    </div>
  );
}
