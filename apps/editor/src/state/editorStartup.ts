import { createProject, type Project } from '@ograf-editor/scene-model';
import { clearProjectSetAutosave, loadAutosave, loadProjectSetAutosave } from './fileIO';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { useProjectSetStore } from './projectSetStore';
import { migrateProjectSetDocument, resolveProjectSetTemplate } from './projectSet';
import { onAirFrame } from './onAirFrame';
import { useStartupScreenStore } from './startupScreenStore';
import { useWorkspaceStore } from './workspaceStore';
import { isUntouchedBlankTiming } from './newTemplateTiming';

/** Initializes project and transport state before React mounts the editor UI. */
export async function initializeEditorSession(
  autosavedProject: Project | null = loadAutosave(),
  workspaceReady: Promise<unknown> = Promise.resolve(),
  bootCreatedProject?: Project,
): Promise<void> {
  useStartupScreenStore.getState().setPristineStartupProject(null);
  useStartupScreenStore.getState().setBootCreatedProject(null);
  useStartupScreenStore.getState().setVisible(false);
  const autosavedSet = await loadProjectSetAutosave();
  if (autosavedSet) {
    try {
      const projectSet = migrateProjectSetDocument(autosavedSet.projectSet);
      const activeTemplateId = projectSet.templates.some(
        (template) => template.id === autosavedSet.activeTemplateId,
      )
        ? autosavedSet.activeTemplateId
        : projectSet.activeTemplateId;
      const activeTemplate = projectSet.templates.find(
        (template) => template.id === activeTemplateId,
      );
      if (!activeTemplate && projectSet.templates.length)
        throw new Error('Autosaved template set has no active template.');
      const project = activeTemplate
        ? resolveProjectSetTemplate(projectSet, activeTemplate.id)
        : createProject({ name: 'No Template' });
      useProjectSetStore.getState().setProjectSet(projectSet);
      useProjectSetStore.getState().setActiveTemplateId(activeTemplate?.id ?? null);
      useProjectStore.getState().loadProject(project);
      return;
    } catch {
      await clearProjectSetAutosave();
    }
  }
  if (autosavedProject) {
    useProjectStore.getState().loadProject(autosavedProject);
    return;
  }
  // Standalone profile hydration can finish after autosave recovery starts.
  // Decide whether to show the welcome screen only after that preference is ready.
  await workspaceReady.catch(() => undefined);
  const project = useProjectStore.getState().project;
  const showWelcome = useWorkspaceStore.getState().editorPreferences.showWelcomeOnStartup !== false;
  useStartupScreenStore.getState().setVisible(showWelcome);
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId);
  // Only suppress the automatic save for the exact unmodified object created before mounting.
  // Any ambiguous or edited project continues through the ordinary recovery path.
  if (
    project === bootCreatedProject &&
    project.compositions.length === 1 &&
    composition &&
    isUntouchedBlankTiming(composition)
  ) {
    useStartupScreenStore.getState().setBootCreatedProject(project);
    if (!showWelcome) useStartupScreenStore.getState().setPristineStartupProject(project);
  }
  useTimelineStore
    .getState()
    .resetForProjectLoad(
      composition && !isUntouchedBlankTiming(composition) ? onAirFrame(composition) : 0,
    );
}
