import { create } from 'zustand';
import type { RepeatDirection } from '../panels/repeaterLayout';

export interface RepeatPreview {
  count: number;
  direction: RepeatDirection;
  gap: number;
}

/** Ghost copies the canvas draws while the Repeat section is being edited. */
export const useRepeatPreviewStore = create<{
  preview: RepeatPreview | null;
  setPreview: (preview: RepeatPreview | null) => void;
}>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}));
