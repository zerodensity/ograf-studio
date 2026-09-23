import { create } from 'zustand';
import type { ShaderPaintSlot, ShaderParameterValue } from '@ograf-editor/scene-model';

export interface LiveShaderParameterPreview {
  layerId: string;
  slot: ShaderPaintSlot;
  name: string;
  value: ShaderParameterValue;
}

interface ShaderParameterPreviewState {
  preview: LiveShaderParameterPreview | null;
  previewParameter: (
    layerId: string,
    slot: ShaderPaintSlot,
    name: string,
    value: ShaderParameterValue,
  ) => void;
  clearPreview: () => void;
}

/** Transient canvas-only values keep slider drags out of the authored project/history path. */
export const useShaderParameterPreviewStore = create<ShaderParameterPreviewState>((set) => ({
  preview: null,
  previewParameter: (layerId, slot, name, value) =>
    set({ preview: { layerId, slot, name, value } }),
  clearPreview: () => set({ preview: null }),
}));
