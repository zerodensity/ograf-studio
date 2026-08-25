import { useRef, type ChangeEvent } from 'react';
import { parseLottieJson } from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore, type NewLayerKind } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { isPersistentGroupSelection } from './groupSelection';
import './AddElementToolbar.css';

const KINDS: { kind: NewLayerKind; label: string }[] = [
  { kind: 'rectangle', label: '+ Rectangle' },
  { kind: 'ellipse', label: '+ Ellipse' },
  { kind: 'text', label: '+ Text' },
  { kind: 'image', label: '+ Image' },
  { kind: 'path', label: '+ Path' },
  { kind: 'image-sequence', label: '+ Image Sequence' },
];

export function AddElementToolbar({ onEnterOgrafPreview }: { onEnterOgrafPreview?: () => void }) {
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
      <div className="stage-mode-switch" role="group" aria-label="Canvas mode">
        <button type="button" className="active" aria-pressed="true">
          Edit
        </button>
        <button type="button" onClick={onEnterOgrafPreview} aria-pressed="false">
          OGraf Preview
        </button>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
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
      {KINDS.map(({ kind, label }) => (
        <button key={kind} type="button" onClick={() => select(addLayer(kind))}>
          {label}
        </button>
      ))}
      <button type="button" onClick={() => lottieInputRef.current?.click()}>
        + Lottie JSON
      </button>
      <input
        ref={lottieInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void importLottie(event)}
      />
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
