import { create } from 'zustand';
import type { DockPaneId } from '../layout/dockModel';

interface PaneRequestState {
  /** The latest request; the id changes on every call so repeated requests still fire. */
  request: { id: number; pane: DockPaneId; section?: string } | null;
  /** Brings a pane into view, reopening it if it was closed. */
  reveal: (pane: DockPaneId, section?: string) => void;
  ruleRequest: { id: number; compositionId: string; layerId: string; ruleId: string } | null;
  revealRule: (compositionId: string, layerId: string, ruleId: string) => void;
  /** Changes on every request to put the docked panes back where Studio first placed them. */
  resetRequest: number;
  resetLayout: () => void;
}

export const usePaneRequestStore = create<PaneRequestState>((set, get) => ({
  request: null,
  reveal: (pane, section) =>
    set({ request: { id: (get().request?.id ?? 0) + 1, pane, ...(section ? { section } : {}) } }),
  ruleRequest: null,
  revealRule: (compositionId, layerId, ruleId) =>
    set({
      request: { id: (get().request?.id ?? 0) + 1, pane: 'rules' },
      ruleRequest: { id: (get().ruleRequest?.id ?? 0) + 1, compositionId, layerId, ruleId },
    }),
  resetRequest: 0,
  resetLayout: () => set({ resetRequest: get().resetRequest + 1 }),
}));
