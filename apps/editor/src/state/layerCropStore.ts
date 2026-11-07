import { useProjectStore } from './projectStore';
import { runDiscreteHistoryStep } from './historyStore';

/** Existing layer entry points share the direct canvas crop session. */
export { useCropToolStore as useLayerCropStore } from './cropToolStore';

export function resetLayerCrops(layerIds: string[]) {
  runDiscreteHistoryStep(
    () =>
      useProjectStore
        .getState()
        .setLayerCrops(Object.fromEntries(layerIds.map((id) => [id, undefined]))),
    'Reset layer crop',
  );
}
