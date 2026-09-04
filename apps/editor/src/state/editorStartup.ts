import type { Project } from '@ograf-editor/scene-model';
import { loadAutosave } from './fileIO';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';

/** Initializes project and transport state before React mounts the editor UI. */
export function initializeEditorSession(autosavedProject: Project | null = loadAutosave()): void {
  if (autosavedProject) {
    useProjectStore.getState().loadProject(autosavedProject);
    return;
  }
  useTimelineStore.getState().resetForProjectLoad();
}
