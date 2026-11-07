import type { Composition, Layer } from '@ograf-editor/scene-model';
import { isPersistentGroupSelection } from '../canvas/groupSelection';
import { runDiscreteHistoryStep } from './historyStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';

/**
 * Layer commands shared by the Edit menu, the canvas context menu, and keyboard shortcuts, so
 * all three behave the same. Each works on the given layers or, by default, the selection.
 */

function composition(): Composition {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

function selected(): string[] {
  return useSelectionStore.getState().selectedLayerIds;
}

function snapshot(layerIds: string[]): Layer[] {
  const wanted = new Set(layerIds);
  return composition()
    .layers.filter((layer) => wanted.has(layer.id))
    .map((layer) => structuredClone(layer));
}

export function copyLayers(layerIds: string[] = selected()): number {
  const layers = snapshot(layerIds);
  if (layers.length > 0) useLayerClipboardStore.getState().copy(layers);
  return layers.length;
}

export function deleteLayers(layerIds: string[] = selected()): number {
  const ids = composition()
    .layers.filter((layer) => layerIds.includes(layer.id) && !layer.isLocked)
    .map((layer) => layer.id);
  if (ids.length === 0) return 0;
  runDiscreteHistoryStep(
    () => {
      for (const layerId of ids) useProjectStore.getState().removeLayer(layerId);
    },
    ids.length === 1 ? 'Delete layer' : `Delete ${ids.length} layers`,
  );
  useSelectionStore.getState().select(null);
  return ids.length;
}

export function cutLayers(layerIds: string[] = selected()): number {
  if (copyLayers(layerIds) === 0) return 0;
  return deleteLayers(layerIds);
}

export function canPasteLayers(): boolean {
  return useLayerClipboardStore.getState().layers.length > 0;
}

export function pasteLayers(): string[] {
  const layers = useLayerClipboardStore.getState().layers;
  if (layers.length === 0) return [];
  const pasted = runDiscreteHistoryStep(
    () => useProjectStore.getState().pasteLayers(layers),
    'Paste layers',
  );
  if (pasted.length > 0) useSelectionStore.getState().selectMany(pasted);
  return pasted;
}

export function canGroupLayers(layerIds: string[] = selected()): boolean {
  return layerIds.length >= 2 && !isPersistentGroupSelection(composition(), layerIds);
}

export function canUngroupLayers(layerIds: string[] = selected()): boolean {
  return layerIds.length > 0 && isPersistentGroupSelection(composition(), layerIds);
}

export function groupLayers(layerIds: string[] = selected()): boolean {
  if (!canGroupLayers(layerIds)) return false;
  const grouped = runDiscreteHistoryStep(
    () => useProjectStore.getState().groupLayers(layerIds),
    'Group layers',
  );
  if (grouped) useSelectionStore.getState().selectMany(layerIds);
  return Boolean(grouped);
}

export function ungroupLayers(layerIds: string[] = selected()): boolean {
  if (!canUngroupLayers(layerIds)) return false;
  const primary = layerIds.at(-1) ?? null;
  runDiscreteHistoryStep(
    () => useProjectStore.getState().ungroupLayers(layerIds),
    'Ungroup layers',
  );
  useSelectionStore.getState().select(primary);
  return true;
}
