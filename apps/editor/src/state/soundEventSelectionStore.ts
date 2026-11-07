import { create } from 'zustand';

interface SoundEventSelectionState {
  selectedSoundEventId: string | null;
  selectSoundEvent: (cueId: string | null) => void;
}

export const useSoundEventSelectionStore = create<SoundEventSelectionState>((set) => ({
  selectedSoundEventId: null,
  selectSoundEvent: (selectedSoundEventId) => set({ selectedSoundEventId }),
}));
