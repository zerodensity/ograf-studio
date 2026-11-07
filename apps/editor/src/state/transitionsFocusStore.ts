import { create } from 'zustand';
import { usePaneRequestStore } from './paneRequestStore';
import type { TransitionCell } from './transitionsDesign';

interface TransitionsFocusState {
  /** The latest request; the id changes on every call so repeated requests still fire. */
  request: { id: number; cell: TransitionCell } | null;
  /** Reveal the Transitions pane with one moment open on its stage. */
  focus: (cell: TransitionCell) => void;
  /** The Transitions pane takes the request once it has opened it. */
  consume: () => void;
}

export const useTransitionsFocusStore = create<TransitionsFocusState>((set, get) => ({
  request: null,
  focus: (cell) => {
    set({ request: { id: (get().request?.id ?? 0) + 1, cell } });
    usePaneRequestStore.getState().reveal('transitions');
  },
  consume: () => set({ request: null }),
}));
