import { useState, type CSSProperties, type DragEvent } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { Panel } from './Panel';
import { selectionIdsForLayer } from '../canvas/groupSelection';
import {
  canAssignLayerParent,
  layerDropIntent,
  layerIndentDepth,
  reorderLayerDisplayOrder,
  type LayerDropIntent,
} from './layerListHierarchy';
import './LayerListPanel.css';

export function LayerListPanel() {
  const composition = useActiveComposition();
  const toggleLayerVisibility = useProjectStore((s) => s.toggleLayerVisibility);
  const toggleLayerGuide = useProjectStore((s) => s.toggleLayerGuide);
  const toggleLayerLock = useProjectStore((s) => s.toggleLayerLock);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const setLayerParent = useProjectStore((s) => s.setLayerParent);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const deselectLayer = useSelectionStore((s) => s.deselectLayer);

  // Displayed top-to-bottom, i.e. highest z-order (end of the array) first.
  const layers = [...composition.layers].reverse();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    layerId: string;
    intent: LayerDropIntent;
  } | null>(null);

  const handleDrop = (targetId: string, intent: LayerDropIntent) => {
    if (!draggedId || draggedId === targetId) return;
    if (intent === 'parent') {
      if (canAssignLayerParent(composition.layers, draggedId, targetId)) {
        setLayerParent(draggedId, targetId);
      }
      return;
    }
    const displayOrder = layers.map((l) => l.id);
    const reordered = reorderLayerDisplayOrder(displayOrder, draggedId, targetId, intent);
    // Displayed order is top-to-bottom; the store wants bottom-to-top (z-order/array order).
    reorderLayers([...reordered].reverse());
  };

  return (
    <Panel title="Layers">
      {layers.length === 0 ? (
        <p className="panel-placeholder">No layers yet. Add one from the canvas toolbar.</p>
      ) : (
        <>
          <p className="layer-list-drag-hint">Drop in row centre to parent · edges reorder</p>
          <ul className="layer-list">
            {layers.map((layer) => {
              const depth = layerIndentDepth(composition.layers, layer.id);
              const parent = layer.parentId
                ? composition.layers.find((candidate) => candidate.id === layer.parentId)
                : null;
              const targetIntent = dropTarget?.layerId === layer.id ? dropTarget.intent : null;
              return (
                <li
                  key={layer.id}
                  draggable={!layer.isLocked}
                  className={[
                    selectedLayerIds.includes(layer.id) && 'active',
                    layer.id === draggedId && 'dragging',
                    targetIntent && draggedId && draggedId !== layer.id && `drop-${targetIntent}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={(event) => {
                    const selectionIds = selectionIdsForLayer(composition, layer.id);
                    if (event.ctrlKey || event.metaKey) toggleManyLayerSelection(selectionIds);
                    else selectMany(selectionIds);
                  }}
                  onDragStart={(e: DragEvent<HTMLLIElement>) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', layer.id);
                    setDraggedId(layer.id);
                  }}
                  onDragOver={(e: DragEvent<HTMLLIElement>) => {
                    e.preventDefault();
                    if (!draggedId || draggedId === layer.id) {
                      e.dataTransfer.dropEffect = 'none';
                      setDropTarget(null);
                      return;
                    }
                    const bounds = e.currentTarget.getBoundingClientRect();
                    const intent = layerDropIntent(e.clientY, bounds.top, bounds.height);
                    if (
                      intent === 'parent' &&
                      !canAssignLayerParent(composition.layers, draggedId, layer.id)
                    ) {
                      e.dataTransfer.dropEffect = 'none';
                      setDropTarget(null);
                      return;
                    }
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget({ layerId: layer.id, intent });
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    )
                      return;
                    setDropTarget((current) => (current?.layerId === layer.id ? null : current));
                  }}
                  onDrop={(e: DragEvent<HTMLLIElement>) => {
                    e.preventDefault();
                    const bounds = e.currentTarget.getBoundingClientRect();
                    handleDrop(layer.id, layerDropIntent(e.clientY, bounds.top, bounds.height));
                    setDraggedId(null);
                    setDropTarget(null);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDropTarget(null);
                  }}
                >
                  <span
                    className="layer-list-drag-handle"
                    title="Drag to parent on a row, or reorder at its upper/lower edge"
                  >
                    {'⠿'}
                  </span>
                  <button
                    type="button"
                    className="layer-list-icon-btn"
                    title={layer.isVisible ? 'Hide layer' : 'Show layer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisibility(layer.id);
                    }}
                  >
                    {layer.isVisible ? '◉' : '○'}
                  </button>
                  <span
                    className="layer-list-name"
                    style={{ '--layer-depth': depth } as CSSProperties}
                    title={parent ? `${layer.name} · child of ${parent.name}` : layer.name}
                  >
                    {layer.groupId ? '● ' : ''}
                    {layer.name}
                  </span>
                  <button
                    type="button"
                    className={`layer-list-icon-btn${layer.isLocked ? ' active' : ''}`}
                    title={layer.isLocked ? 'Unlock layer' : 'Lock layer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerLock(layer.id);
                    }}
                  >
                    {layer.isLocked ? '🔒' : '🔓'}
                  </button>
                  <button
                    type="button"
                    className={`layer-list-icon-btn${layer.isGuide ? ' active' : ''}`}
                    title="Toggle guide layer (excluded from export)"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerGuide(layer.id);
                    }}
                  >
                    G
                  </button>
                  <button
                    type="button"
                    className="layer-list-icon-btn"
                    title="Delete layer"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLayer(layer.id);
                      if (selectedLayerIds.includes(layer.id)) deselectLayer(layer.id);
                    }}
                  >
                    {'✕'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
