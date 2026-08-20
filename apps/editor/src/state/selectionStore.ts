import { create } from 'zustand';
import type { AnimatableLayerProperty, LayerTransform } from '@ograf-editor/scene-model';

interface LiveTransform {
  layerId: string;
  patch: Partial<LayerTransform>;
}

interface SelectionState {
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  selectedLayerKeyframeId: string | null;
  selectedLayerProperty: AnimatableLayerProperty | null;
  liveTransform: LiveTransform | null;
  select: (layerId: string | null) => void;
  selectMany: (layerIds: string[]) => void;
  toggleLayerSelection: (layerId: string) => void;
  toggleManyLayerSelection: (layerIds: string[]) => void;
  deselectLayer: (layerId: string) => void;
  selectLayerKeyframe: (
    layerId: string,
    keyframeId: string,
    property?: AnimatableLayerProperty | null,
  ) => void;
  clearLayerKeyframe: () => void;
  setLiveTransform: (layerId: string, patch: Partial<LayerTransform>) => void;
  clearLiveTransform: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedLayerId: null,
  selectedLayerIds: [],
  selectedLayerKeyframeId: null,
  selectedLayerProperty: null,
  liveTransform: null,
  select: (layerId) =>
    set({
      selectedLayerId: layerId,
      selectedLayerIds: layerId ? [layerId] : [],
      selectedLayerKeyframeId: null,
      selectedLayerProperty: null,
      liveTransform: null,
    }),
  selectMany: (layerIds) => {
    const selectedLayerIds = [...new Set(layerIds)];
    set({
      selectedLayerIds,
      selectedLayerId: selectedLayerIds.at(-1) ?? null,
      selectedLayerKeyframeId: null,
      selectedLayerProperty: null,
      liveTransform: null,
    });
  },
  toggleLayerSelection: (layerId) =>
    set((state) => {
      const isSelected = state.selectedLayerIds.includes(layerId);
      const selectedLayerIds = isSelected
        ? state.selectedLayerIds.filter((candidate) => candidate !== layerId)
        : [...state.selectedLayerIds, layerId];
      return {
        selectedLayerIds,
        selectedLayerId: isSelected ? (selectedLayerIds.at(-1) ?? null) : layerId,
        selectedLayerKeyframeId: null,
        selectedLayerProperty: null,
        liveTransform: null,
      };
    }),
  toggleManyLayerSelection: (layerIds) =>
    set((state) => {
      const candidates = [...new Set(layerIds)];
      const allSelected = candidates.every((layerId) => state.selectedLayerIds.includes(layerId));
      const selectedLayerIds = allSelected
        ? state.selectedLayerIds.filter((layerId) => !candidates.includes(layerId))
        : [...new Set([...state.selectedLayerIds, ...candidates])];
      return {
        selectedLayerIds,
        selectedLayerId: allSelected
          ? (selectedLayerIds.at(-1) ?? null)
          : (candidates.at(-1) ?? state.selectedLayerId),
        selectedLayerKeyframeId: null,
        selectedLayerProperty: null,
        liveTransform: null,
      };
    }),
  deselectLayer: (layerId) =>
    set((state) => {
      if (!state.selectedLayerIds.includes(layerId)) return state;
      const selectedLayerIds = state.selectedLayerIds.filter((candidate) => candidate !== layerId);
      return {
        selectedLayerIds,
        selectedLayerId:
          state.selectedLayerId === layerId
            ? (selectedLayerIds.at(-1) ?? null)
            : state.selectedLayerId,
        selectedLayerKeyframeId: null,
        selectedLayerProperty: null,
        liveTransform: null,
      };
    }),
  selectLayerKeyframe: (layerId, keyframeId, property = null) =>
    set({
      selectedLayerId: layerId,
      selectedLayerIds: [layerId],
      selectedLayerKeyframeId: keyframeId,
      selectedLayerProperty: property,
      liveTransform: null,
    }),
  clearLayerKeyframe: () => set({ selectedLayerKeyframeId: null, selectedLayerProperty: null }),
  setLiveTransform: (layerId, patch) => set({ liveTransform: { layerId, patch } }),
  clearLiveTransform: () => set({ liveTransform: null }),
}));
