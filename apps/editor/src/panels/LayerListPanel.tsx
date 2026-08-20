import { useState, type DragEvent } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { Panel } from './Panel';
import { selectionIdsForLayer } from '../canvas/groupSelection';
import './LayerListPanel.css';

export function LayerListPanel() {
  const composition = useActiveComposition();
  const toggleLayerVisibility = useProjectStore((s) => s.toggleLayerVisibility);
  const toggleLayerGuide = useProjectStore((s) => s.toggleLayerGuide);
  const toggleLayerLock = useProjectStore((s) => s.toggleLayerLock);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const toggleManyLayerSelection = useSelectionStore((s) => s.toggleManyLayerSelection);
  const deselectLayer = useSelectionStore((s) => s.deselectLayer);

  // Displayed top-to-bottom, i.e. highest z-order (end of the array) first.
  const layers = [...composition.layers].reverse();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const displayOrder = layers.map((l) => l.id);
    const fromIndex = displayOrder.indexOf(draggedId);
    const toIndex = displayOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    displayOrder.splice(fromIndex, 1);
    displayOrder.splice(toIndex, 0, draggedId);
    // Displayed order is top-to-bottom; the store wants bottom-to-top (z-order/array order).
    reorderLayers([...displayOrder].reverse());
  };

  return (
    <Panel title="Layers">
      {layers.length === 0 ? (
        <p className="panel-placeholder">No layers yet. Add one from the canvas toolbar.</p>
      ) : (
        <ul className="layer-list">
          {layers.map((layer) => (
            <li
              key={layer.id}
              draggable={!layer.isLocked}
              className={[
                selectedLayerIds.includes(layer.id) && 'active',
                layer.id === draggedId && 'dragging',
                layer.id === dropTargetId && draggedId && draggedId !== layer.id && 'drop-target',
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
                setDraggedId(layer.id);
              }}
              onDragOver={(e: DragEvent<HTMLLIElement>) => {
                e.preventDefault();
                setDropTargetId(layer.id);
              }}
              onDragLeave={() =>
                setDropTargetId((current) => (current === layer.id ? null : current))
              }
              onDrop={(e: DragEvent<HTMLLIElement>) => {
                e.preventDefault();
                handleDrop(layer.id);
                setDraggedId(null);
                setDropTargetId(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDropTargetId(null);
              }}
            >
              <span className="layer-list-drag-handle" title="Drag to reorder">
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
              <span className="layer-list-name">
                {layer.parentId ? '↳ ' : ''}
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
          ))}
        </ul>
      )}
    </Panel>
  );
}
