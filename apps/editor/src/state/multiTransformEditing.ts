import type { LayerTransform } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { runDiscreteHistoryStep } from './historyStore';

/** Edit unlocked targets together while preserving their existing animation and binding paths. */
export function applySharedTransform(
  ids: string[],
  frame: number,
  property: keyof LayerTransform,
  value: number,
  label: string,
): void {
  const state = useProjectStore.getState();
  const targets = getActiveComposition(state.project, state.activeCompositionId).layers.filter(
    (layer) => ids.includes(layer.id) && !layer.isLocked,
  );
  if (!targets.length) return;
  runDiscreteHistoryStep(() => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerTransform(layer.id, frame, { [property]: value });
  }, `Set ${label} for selected layers`);
}
