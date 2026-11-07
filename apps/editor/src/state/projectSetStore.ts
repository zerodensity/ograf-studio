import { create } from 'zustand';
import type { ProjectSetDocument } from './projectSet';

interface ProjectSetSessionState {
  projectSet: ProjectSetDocument | null;
  activeTemplateId: string | null;
  setProjectSet: (projectSet: ProjectSetDocument | null) => void;
  setActiveTemplateId: (templateId: string | null) => void;
  clearProjectSet: () => void;
}

/** Shared editor-session state for the open .ogp and its active child template. */
export const useProjectSetStore = create<ProjectSetSessionState>((set) => ({
  projectSet: null,
  activeTemplateId: null,
  setProjectSet: (projectSet) => set({ projectSet }),
  setActiveTemplateId: (activeTemplateId) =>
    set((state) => ({
      activeTemplateId,
      projectSet: state.projectSet
        ? { ...state.projectSet, activeTemplateId: activeTemplateId ?? undefined }
        : null,
    })),
  clearProjectSet: () => set({ projectSet: null, activeTemplateId: null }),
}));
