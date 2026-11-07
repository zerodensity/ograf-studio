import { create } from 'zustand';

export type CanvasBackdropMode = 'dark' | 'light' | 'solid';
const KEY = 'ograf-studio:canvas-backdrop';

function storedBackdrop(): { mode: CanvasBackdropMode; color: string; showPresentation: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      mode: value.mode === 'light' || value.mode === 'solid' ? value.mode : 'dark',
      color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#30343b',
      // Existing profiles showed the shared presentation bed over the editor backdrop.
      showPresentation: value.showPresentation !== false,
    };
  } catch {
    return { mode: 'dark', color: '#30343b', showPresentation: true };
  }
}

export const useCanvasBackdropStore = create<{
  mode: CanvasBackdropMode;
  color: string;
  showPresentation: boolean;
  setBackdrop: (
    patch: Partial<{ mode: CanvasBackdropMode; color: string; showPresentation: boolean }>,
  ) => void;
}>((set) => ({
  ...storedBackdrop(),
  setBackdrop: (patch) =>
    set((state) => {
      const next = {
        mode: patch.mode ?? state.mode,
        color: patch.color ?? state.color,
        showPresentation: patch.showPresentation ?? state.showPresentation,
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // The backdrop still works for the current session without browser storage.
      }
      return next;
    }),
}));
