import type { Composition } from '@ograf-editor/scene-model';
import { selectionIdsForLayer } from './groupSelection';

/** A hit on the current selection retains it; another object becomes the explicit drop target. */
export function shaderDropTargetIds(
  composition: Composition,
  selectedIds: readonly string[],
  hitLayerId?: string | null,
): string[] {
  if (hitLayerId && composition.layers.some((layer) => layer.id === hitLayerId)) {
    return selectedIds.includes(hitLayerId)
      ? [...new Set(selectedIds)]
      : selectionIdsForLayer(composition, hitLayerId);
  }
  return [...new Set(selectedIds)];
}
