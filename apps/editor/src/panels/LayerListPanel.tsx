import { Fragment, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  pausedShaderLayerIds,
  restoreShaderLayer,
  subscribeShaderContexts,
} from '@ograf-editor/ograf-runtime';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { Panel } from './Panel';
import { CollapsibleSection } from '../components/CollapsibleSection';
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
import { isDomNode } from '../layout/EditorWindow';
import {
  LayerCropContextMenu,
  type LayerCropMenuPosition,
} from '../components/LayerCropContextMenu';

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
  const [pausedShaders, setPausedShaders] = useState<string[]>(() => pausedShaderLayerIds());
  useEffect(() => {
    const update = () => setPausedShaders(pausedShaderLayerIds());
    const unsubscribe = subscribeShaderContexts(update);
    update();
    return unsubscribe;
  }, []);
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
  const firstGroupIndex = new Map<string, number>();
  layers.forEach((layer, index) => {
    if (layer.groupId && !firstGroupIndex.has(layer.groupId))
      firstGroupIndex.set(layer.groupId, index);
  });

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const [parentError, setParentError] = useState('');
  const [cropMenu, setCropMenu] = useState<LayerCropMenuPosition | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    layerId: string;
    intent: LayerDropIntent;
  } | null>(null);

  const handleDrop = (targetId: string, intent: LayerDropIntent) => {
    if (!draggedId || draggedId === targetId) return;
    if (intent === 'parent') {
      if (canAssignLayerParent(composition.layers, draggedId, targetId)) {
        try {
          runDiscreteHistoryStep(() => setLayerParent(draggedId, targetId), 'Change layer parent');
          setParentError('');
        } catch (cause) {
          setParentError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      return;
    }
    const displayOrder = layers.map((l) => l.id);
    const reordered = reorderLayerDisplayOrder(displayOrder, draggedId, targetId, intent);
    // Displayed order is top-to-bottom; the store wants bottom-to-top (z-order/array order).
    runDiscreteHistoryStep(() => reorderLayers([...reordered].reverse()), 'Reorder layers');
  };

  return (
    <Panel title="Layers">
      {parentError && (
        <p role="alert" className="layer-list-error">
          {parentError}
        </p>
      )}
      <CollapsibleSection
        sectionId="layers.stack"
        title={`Layer stack (${layers.length})`}
        contentClassName="layer-list-section-content"
      >
        {layers.length === 0 ? (
          <p className="panel-placeholder">No layers yet. Add one from the canvas toolbar.</p>
        ) : (
          <>
            <p className="layer-list-drag-hint">
              Drag onto a row to parent · onto a row edge to reorder · into AI Assistant to mention
            </p>
            <ul className="layer-list">
              {layers.map((layer, index) => {
                const depth = layerIndentDepth(composition.layers, layer.id);
                const parent = layer.parentId
                  ? composition.layers.find((candidate) => candidate.id === layer.parentId)
                  : null;
                const targetIntent = dropTarget?.layerId === layer.id ? dropTarget.intent : null;
                return (
                  <Fragment key={layer.id}>
                    {layer.groupId && firstGroupIndex.get(layer.groupId) === index ? (
                      <li className="layer-list-group-header">
                        <button
                          type="button"
                          onClick={() => {
                            selectMany(
                              composition.layers
                                .filter((item) => item.groupId === layer.groupId)
                                .map((item) => item.id),
                            );
                            selectionAnchor.current = layer.id;
                          }}
                        >
                          Group ·{' '}
                          {
                            composition.layers.filter((item) => item.groupId === layer.groupId)
                              .length
                          }{' '}
                          layers
                        </button>
                      </li>
                    ) : null}
                    <li
                      draggable
                      className={[
                        selectedLayerIds.includes(layer.id) && 'active',
                        layer.id === draggedId && 'dragging',
                        targetIntent &&
                          draggedId &&
                          draggedId !== layer.id &&
                          `drop-${targetIntent}`,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={(event) => {
                        if (event.shiftKey && selectionAnchor.current) {
                          const first = layers.findIndex(
                            (item) => item.id === selectionAnchor.current,
                          );
                          const last = layers.findIndex((item) => item.id === layer.id);
                          if (first >= 0 && last >= 0) {
                            selectMany(
                              layers
                                .slice(Math.min(first, last), Math.max(first, last) + 1)
                                .map((item) => item.id),
                            );
                            return;
                          }
                        }
                        selectionAnchor.current = layer.id;
                        if (event.ctrlKey || event.metaKey) toggleManyLayerSelection([layer.id]);
                        else selectMany([layer.id]);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const layerIds = selectedLayerIds.includes(layer.id)
                          ? selectedLayerIds
                          : [layer.id];
                        selectMany(layerIds);
                        setCropMenu({ x: event.clientX, y: event.clientY, layerIds });
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
                          isDomNode(event.relatedTarget) &&
                          event.currentTarget.contains(event.relatedTarget)
                        )
                          return;
                        setDropTarget((current) =>
                          current?.layerId === layer.id ? null : current,
                        );
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
                        title="Drag to parent/reorder, or drop in AI Assistant to reference this layer"
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
                      {pausedShaders.includes(layer.id) && (
                        <button
                          type="button"
                          className="layer-list-shader-paused"
                          title="Shader paused: too many WebGL views. Request restoration."
                          onClick={(event) => {
                            event.stopPropagation();
                            restoreShaderLayer(layer.id);
                          }}
                        >
                          ⚠ Restore
                        </button>
                      )}
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
                          runDiscreteHistoryStep(
                            () => removeLayer(layer.id),
                            `Delete “${layer.name}”`,
                          );
                          if (selectedLayerIds.includes(layer.id)) deselectLayer(layer.id);
                        }}
                      >
                        {'✕'}
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}
      </CollapsibleSection>
      {cropMenu ? <LayerCropContextMenu menu={cropMenu} onClose={() => setCropMenu(null)} /> : null}
    </Panel>
  );
}
