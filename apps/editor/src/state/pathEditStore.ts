import { create } from 'zustand';
import { pathConversionError } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { runDiscreteHistoryStep } from './historyStore';

export const usePathEditStore = create<{
  layerId: string | null;
  error: string | null;
  start: (layerId: string) => void;
  stop: () => void;
}>((set) => ({
  layerId: null,
  error: null,
  start: (layerId) => {
    const state = useProjectStore.getState();
    const layer = state.project.compositions
      .find((c) => c.id === state.activeCompositionId)
      ?.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const error = pathConversionError(layer);
    if (error) {
      set({ error });
      return;
    }
    useTimelineStore.getState().controller?.pause();
    useTimelineStore.getState().setPlaying(false);
    try {
      runDiscreteHistoryStep(() =>
        state.editLayerPath(
          layerId,
          { action: 'convert' },
          useTimelineStore.getState().currentFrame,
        ),
      );
      useSelectionStore.getState().select(layerId);
      set({ layerId, error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  stop: () => set({ layerId: null, error: null }),
}));
