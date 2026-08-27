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
import {
  AGENT_LAYER_REFERENCE_MIME,
  encodeAgentLayerReference,
} from '../state/agentLayerReference';
import './LayerListPanel.css';

function LayerVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        className="layer-visibility-eye"
        d="M1.7 9c1.45-2.55 4.05-4.25 7.3-4.25s5.85 1.7 7.3 4.25c-1.45 2.55-4.05 4.25-7.3 4.25S3.15 11.55 1.7 9Z"
      />
      <circle className="layer-visibility-pupil" cx="9" cy="9" r="2.35" />
      {!visible && <path className="layer-visibility-slash" d="M3 3 15 15" />}
    </svg>
  );
}

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
          <p className="layer-list-drag-hint">
            Row centre parents · edges reorder · drop in Chat to reference
          </p>
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
                  draggable
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
                    e.dataTransfer.effectAllowed = layer.isLocked ? 'copy' : 'copyMove';
                    e.dataTransfer.setData(
                      AGENT_LAYER_REFERENCE_MIME,
                      encodeAgentLayerReference({
                        layerId: layer.id,
                        name: layer.name,
                        elementType: layer.element.type,
                      }),
                    );
                    if (!layer.isLocked) {
                      e.dataTransfer.setData('text/plain', layer.id);
                      setDraggedId(layer.id);
                    }
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
                    title="Drag to parent/reorder, or drop in Chat to reference this layer"
                  >
                    {'⠿'}
                  </span>
                  <button
                    type="button"
                    className={`layer-list-icon-btn layer-list-visibility-btn${layer.isVisible ? ' is-visible' : ''}`}
                    title={layer.isVisible ? 'Hide layer' : 'Show layer'}
                    aria-label={layer.isVisible ? 'Hide layer' : 'Show layer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisibility(layer.id);
                    }}
                  >
                    <LayerVisibilityIcon visible={layer.isVisible} />
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
