import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import type { EditorWindow } from '../layout/EditorWindow';

interface PatternDialogRequest {
  projectId: string;
  compositionId: string;
  patternId?: string;
  owner: EditorWindow;
}
export const usePatternDialogStore = create<{
  request: PatternDialogRequest | null;
  open: (patternId?: string, owner?: EditorWindow) => void;
  close: () => void;
}>((set) => ({
  request: null,
  open: (patternId, owner = window) => {
    const state = useProjectStore.getState();
    set({
      request: {
        projectId: state.project.id,
        compositionId: state.activeCompositionId,
        patternId,
        owner,
      },
    });
  },
  close: () => set({ request: null }),
}));
