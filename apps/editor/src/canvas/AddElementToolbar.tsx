import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { isPersistentGroupSelection } from './groupSelection';
import { arrangeSelectedLayers, type LayerArrangeAction } from '../state/layerZOrder';
import './AddElementToolbar.css';

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

/** Canvas top bar: actions on the current selection (repeat, arrange, align, group). */
export function AddElementToolbar() {
  const composition = useActiveComposition();
  const addRepeater = useProjectStore((s) => s.addRepeater);
  const alignLayers = useProjectStore((s) => s.alignLayers);
  const distributeLayers = useProjectStore((s) => s.distributeLayers);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const selectionIsPersistentGroup = isPersistentGroupSelection(composition, selectedLayerIds);
  const orderedLayerIds = composition.layers.map((layer) => layer.id);

  const arrangementFor = (action: LayerArrangeAction) =>
    arrangeSelectedLayers(orderedLayerIds, selectedLayerIds, action);

  const canArrange = (action: LayerArrangeAction) =>
    arrangementFor(action).some((layerId, index) => layerId !== orderedLayerIds[index]);

  return (
    <div className="add-element-toolbar">
      {selectedLayerIds.length > 0 && (
        <button
          type="button"
          title="Turn the selection into a data-driven row of three copies"
          onClick={() => {
            const repeater = addRepeater(selectedLayerIds);
            if (repeater) {
              selectMany(repeater.items.flatMap((item) => Object.values(item.layers)));
            }
          }}
        >
          Repeat selection ×3
        </button>
      )}
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
