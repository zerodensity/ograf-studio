import { create } from 'zustand';
import type { Project } from '@ograf-editor/scene-model';

export type StartupRequestKind =
  'startup' | 'new-template' | 'new-set' | 'set-template' | 'second-template';
export interface StartupRequest {
  kind: StartupRequestKind;
  projectId: string | null;
  compositionId: string | null;
  setId: string | null;
  activeTemplateId: string | null;
  targetId?: string | null;
  side?: 'before' | 'after';
}

/** Only the empty first-run session lacks an existing document worth autosaving. */
export function shouldSuspendAutosave(
  request: StartupRequest | null,
  pristineProject?: Project | null,
  currentProject?: Project,
  hasTemplateSet = false,
): boolean {
  return (
    request?.kind === 'startup' ||
    Boolean(pristineProject && pristineProject === currentProject && !hasTemplateSet)
  );
}

/** This is session state, not part of a saved template or workspace. */
export const useStartupScreenStore = create<{
  visible: boolean;
  request: StartupRequest | null;
  /** Exact blank created at boot, used only while choosing initial welcome preferences. */
  bootCreatedProject: Project | null;
  setBootCreatedProject: (project: Project | null) => void;
  /** The exact untouched boot-created blank; never persisted in a project. */
  pristineStartupProject: Project | null;
  setPristineStartupProject: (project: Project | null) => void;
  open: (request: StartupRequest) => void;
  close: () => void;
  setVisible: (visible: boolean) => void;
}>((set) => ({
  visible: false,
  request: null,
  bootCreatedProject: null,
  setBootCreatedProject: (project) =>
    set((state) =>
      state.bootCreatedProject === project ? state : { bootCreatedProject: project },
    ),
  pristineStartupProject: null,
  setPristineStartupProject: (project) =>
    set((state) =>
      state.pristineStartupProject === project ? state : { pristineStartupProject: project },
    ),
  open: (request) => set({ visible: true, request }),
  close: () => set({ visible: false, request: null }),
  setVisible: (visible) =>
    set({
      visible,
      request: visible
        ? {
            kind: 'startup',
            projectId: null,
            compositionId: null,
            setId: null,
            activeTemplateId: null,
          }
        : null,
    }),
}));
