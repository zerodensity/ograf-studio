import { animatablePropertyLabel, type AnimatableLayerProperty } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { runDiscreteHistoryStep } from '../state/historyStore';

/** One command shared by the visible reset control and every channel context-menu target. */
export function resetTimelineChannelAnimation(layerId: string, property: AnimatableLayerProperty) {
  const state = useProjectStore.getState();
  const layer = state.project.compositions
    .find((item) => item.id === state.activeCompositionId)
    ?.layers.find((item) => item.id === layerId);
  const label = animatablePropertyLabel(property, layer);
  const frame = useTimelineStore.getState().currentFrame;
  runDiscreteHistoryStep(() => {
    useProjectStore.getState().resetLayerPropertyAnimation(layerId, property, frame);
    useSelectionStore.getState().selectLayerProperty(layerId, property);
  }, `Reset ${label} animation`);
  return frame;
}
