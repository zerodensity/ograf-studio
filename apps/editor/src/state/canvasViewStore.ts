import { create } from 'zustand';
import type { Composition } from '@ograf-editor/scene-model';
import { onAirFrame } from './onAirFrame';
import { useTimelineStore } from './timelineStore';
export type CanvasViewMode = 'design' | 'animate';
export const useCanvasViewStore = create<{
  mode: CanvasViewMode;
  setMode: (mode: CanvasViewMode) => void;
}>((set, get) => ({
  mode: 'animate',
  setMode: (mode) => {
    if (get().mode === mode) return;
    useTimelineStore.getState().controller?.pause();
    set({ mode });
  },
}));
export function canvasFrame(
  composition: Composition,
  frame = useTimelineStore.getState().currentFrame,
  mode = useCanvasViewStore.getState().mode,
) {
  return mode === 'design' ? onAirFrame(composition) : frame;
}
export function canvasAutoKeyframe() {
  return (
    useCanvasViewStore.getState().mode === 'animate' && useTimelineStore.getState().autoKeyframe
  );
}
