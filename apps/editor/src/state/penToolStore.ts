import { create } from 'zustand';
import { usePathEditStore } from './pathEditStore';
import { useTimelineStore } from './timelineStore';

export const usePenToolStore = create<{ active: boolean; start: () => void; stop: () => void }>(
  (set) => ({
    active: false,
    start: () => {
      usePathEditStore.getState().stop();
      useTimelineStore.getState().setPlaying(false);
      set({ active: true });
    },
    stop: () => set({ active: false }),
  }),
);
