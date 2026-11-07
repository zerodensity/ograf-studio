import type { Composition } from '@ograf-editor/scene-model';

/** Expands one layer to its complete persistent group; ungrouped layers stay singular. */
export function selectionIdsForLayer(composition: Composition, layerId: string): string[] {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer?.groupId) return layer ? [layer.id] : [];
  return composition.layers
    .filter((candidate) => candidate.groupId === layer.groupId)
    .map((candidate) => candidate.id);
}

/** Resolve a canvas hit without changing how shader drops target complete groups. */
export function selectionForPointer(
  composition: Composition,
  layerId: string,
  options: { enteredGroupId?: string | null; deep?: boolean } = {},
): string[] {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return [];
  if (options.deep || (layer.groupId && layer.groupId === options.enteredGroupId)) return [layerId];
  return selectionIdsForLayer(composition, layerId);
}

/** True only when the selection is exactly one complete persistent group. */
export function isPersistentGroupSelection(composition: Composition, layerIds: string[]): boolean {
  if (layerIds.length < 2) return false;
  const wanted = new Set(layerIds);
  const selected = composition.layers.filter((layer) => wanted.has(layer.id));
  const groupId = selected[0]?.groupId;
  if (!groupId || selected.some((layer) => layer.groupId !== groupId)) return false;
  const members = composition.layers.filter((layer) => layer.groupId === groupId);
  return members.length === selected.length && members.every((layer) => wanted.has(layer.id));
}
