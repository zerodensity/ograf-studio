import { create } from 'zustand';
import type { Layer } from '@ograf-editor/scene-model';

interface LayerClipboardState {
  layers: Layer[];
  copy: (layers: Layer[]) => void;
}

export const useLayerClipboardStore = create<LayerClipboardState>((set) => ({
  layers: [],
  copy: (layers) => set({ layers: structuredClone(layers) }),
}));
