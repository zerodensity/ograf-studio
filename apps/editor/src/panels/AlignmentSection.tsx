import { useState } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';
import { isPersistentGroupSelection } from '../canvas/groupSelection';
import type { AlignmentMode } from '../canvas/layoutGeometry';
import { arrangeSelectedLayers, type LayerArrangeAction } from '../state/layerZOrder';
import { useActiveComposition, useProjectStore, type AlignmentTarget } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { effectiveAlignmentTarget } from './alignmentTarget';
import './AlignmentSection.css';

const ALIGN_ACTIONS: Array<{ mode: AlignmentMode; label: string; icon: string } | null> = [
  {
    mode: 'left',
    label: 'Align left',
    icon: 'M3 2v16M5 4h10v4H5zM5 11h6v4H5z',
  },
  {
    mode: 'horizontal-center',
    label: 'Align horizontal centers',
    icon: 'M10 2v16M4 4h12v4H4zM6 11h8v4H6z',
  },
  {
    mode: 'right',
    label: 'Align right',
    icon: 'M17 2v16M5 4h10v4H5zM9 11h6v4H9z',
  },
  null,
  {
    mode: 'top',
    label: 'Align top',
    icon: 'M2 3h16M4 5h4v10H4zM11 5h4v6h-4z',
  },
  {
    mode: 'vertical-center',
    label: 'Align vertical centers',
    icon: 'M2 10h16M4 4h4v12H4zM11 6h4v8h-4z',
  },
  {
    mode: 'bottom',
    label: 'Align bottom',
    icon: 'M2 17h16M4 5h4v10H4zM11 9h4v6h-4z',
  },
];

const DISTRIBUTE_ACTIONS = [
  { mode: 'horizontal', label: 'Distribute horizontally', icon: 'M2 3v14M18 3v14M7 6h6v8H7z' },
  { mode: 'vertical', label: 'Distribute vertically', icon: 'M3 2h14M3 18h14M6 7h8v6H6z' },
] as const;

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
    <svg className="alignment-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="8.5" width="9.5" height="9.5" rx="1" />
      <rect x="7.5" y="4.5" width="9.5" height="9.5" rx="1" />
      <path
        d={movesForward ? 'M20 15V5M17.5 7.5 20 5l2.5 2.5' : 'M20 5v10m-2.5-2.5L20 15l2.5-2.5'}
      />
      {movesToEnd && <path d={movesForward ? 'M17.5 3h5' : 'M17.5 17h5'} />}
    </svg>
  );
}

function PathIcon({ d }: { d: string }) {
  return (
    <svg className="alignment-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Properties section that lines up, spaces, orders and groups the selected layers. */
export function AlignmentSection() {
  const [pickedTarget, setPickedTarget] = useState<AlignmentTarget | null>(null);
  const composition = useActiveComposition();
  const alignLayers = useProjectStore((s) => s.alignLayers);
  const distributeLayers = useProjectStore((s) => s.distributeLayers);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const count = selectedLayerIds.length;
  const target = effectiveAlignmentTarget(count, pickedTarget);
  const orderedLayerIds = composition.layers.map((layer) => layer.id);
  const arrangementFor = (action: LayerArrangeAction) =>
    arrangeSelectedLayers(orderedLayerIds, selectedLayerIds, action);
  const canArrange = (action: LayerArrangeAction) =>
    arrangementFor(action).some((layerId, index) => layerId !== orderedLayerIds[index]);
  const isGroup = isPersistentGroupSelection(composition, selectedLayerIds);

  if (count === 0) return null;

  const hint =
    target === 'selection'
      ? `Aligns the ${count} layers to their shared bounds.`
      : count === 1
        ? `Aligns the layer to the canvas (${composition.width}×${composition.height}).`
        : `Aligns each of the ${count} layers to the canvas.`;

  return (
    <CollapsibleSection sectionId="properties.alignment" title="Alignment">
      <PropertyRow
        as="div"
        className="inspector-row"
        help="Align against the shared bounds of the selected layers, or against the whole canvas. A single layer always aligns to the canvas."
      >
        <span>Align to</span>
        <div className="alignment-segmented" role="radiogroup" aria-label="Align to">
          {(['selection', 'canvas'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={target === option}
              disabled={option === 'selection' && count < 2}
              onClick={() => setPickedTarget(option)}
            >
              {option === 'selection' ? 'Selection' : 'Canvas'}
            </button>
          ))}
        </div>
      </PropertyRow>
      <p className="inspector-hint">{hint}</p>
      <PropertyRow
        as="div"
        className="inspector-row"
        help="Line up the selected layers by an edge or centre."
      >
        <span>Align</span>
        <div className="alignment-buttons" role="group" aria-label="Align">
          {ALIGN_ACTIONS.map((item, index) =>
            item ? (
              <button
                key={item.mode}
                type="button"
                className="alignment-button"
                aria-label={item.label}
                title={item.label}
                onClick={() => alignLayers(selectedLayerIds, currentFrame, item.mode, target)}
              >
                <PathIcon d={item.icon} />
              </button>
            ) : (
              <span key={`gap-${index}`} className="alignment-gap" aria-hidden="true" />
            ),
          )}
        </div>
      </PropertyRow>
      <PropertyRow
        as="div"
        className="inspector-row"
        help="Space three or more selected layers evenly between the outermost two."
      >
        <span>Distribute</span>
        <div className="alignment-buttons" role="group" aria-label="Distribute">
          {DISTRIBUTE_ACTIONS.map((item) => (
            <button
              key={item.mode}
              type="button"
              className="alignment-button"
              aria-label={item.label}
              title={count < 3 ? `${item.label} (select 3 or more layers)` : item.label}
              disabled={count < 3}
              onClick={() => distributeLayers(selectedLayerIds, currentFrame, item.mode)}
            >
              <PathIcon d={item.icon} />
            </button>
          ))}
        </div>
      </PropertyRow>
      <PropertyRow
        as="div"
        className="inspector-row"
        help="Move the selected layers back or forward in the stacking order."
      >
        <span>Order</span>
        <div className="alignment-buttons" role="group" aria-label="Arrange selected layers">
          {ARRANGE_ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className="alignment-button"
              aria-label={label}
              title={label}
              disabled={!canArrange(action)}
              onClick={() => reorderLayers(arrangementFor(action))}
            >
              <ArrangeIcon action={action} />
            </button>
          ))}
        </div>
      </PropertyRow>
      <PropertyRow
        as="div"
        className="inspector-row"
        help="Group the selected layers so they select and move together, or split a group apart."
      >
        <span>Group</span>
        <div className="alignment-buttons">
          {isGroup ? (
            <button type="button" onClick={() => ungroupLayers(selectedLayerIds)}>
              Ungroup
            </button>
          ) : (
            <button
              type="button"
              disabled={count < 2}
              onClick={() => groupLayers(selectedLayerIds)}
            >
              Group
            </button>
          )}
        </div>
      </PropertyRow>
    </CollapsibleSection>
  );
}
