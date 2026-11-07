import { useEffect } from 'react';
import { useProjectStore } from './projectStore';
import { clearProjectSetAutosave, saveAutosave, saveProjectSetAutosave } from './fileIO';
import { useProjectSetStore } from './projectSetStore';
import { saveProjectSetTemplateEdits } from './projectSet';
import { shouldSuspendAutosave, useStartupScreenStore } from './startupScreenStore';

/** Start the same recovery subscription used by the editor, including its initial save. */
export function startAutosave(delayMs = 500): () => void {
  let timeout: number | undefined;
  const schedule = () => {
    window.clearTimeout(timeout);
    const startup = useStartupScreenStore.getState();
    if (
      shouldSuspendAutosave(
        startup.request,
        startup.pristineStartupProject,
        useProjectStore.getState().project,
        Boolean(useProjectSetStore.getState().projectSet),
      )
    )
      return;
    timeout = window.setTimeout(
      () =>
        void (async () => {
          const project = useProjectStore.getState().project;
          saveAutosave(project);
          const { projectSet, activeTemplateId } = useProjectSetStore.getState();
          if (projectSet) {
            try {
              const snapshot = activeTemplateId
                ? saveProjectSetTemplateEdits(projectSet, activeTemplateId, project)
                : projectSet;
              if (!(await saveProjectSetAutosave({ projectSet: snapshot, activeTemplateId }))) {
                await clearProjectSetAutosave();
              }
            } catch {
              await clearProjectSetAutosave();
            }
          } else {
            await clearProjectSetAutosave();
          }
        })(),
      delayMs,
    );
  };
  const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
    if (state.project !== previous.project)
      useStartupScreenStore.getState().setPristineStartupProject(null);
    schedule();
  });
  const unsubscribeProjectSet = useProjectSetStore.subscribe((state, previous) => {
    if (state.projectSet !== previous.projectSet)
      useStartupScreenStore.getState().setPristineStartupProject(null);
    schedule();
  });
  const unsubscribeStartup = useStartupScreenStore.subscribe(schedule);
  schedule();
  return () => {
    window.clearTimeout(timeout);
    unsubscribeProject();
    unsubscribeProjectSet();
    unsubscribeStartup();
  };
}

export function useAutosave(delayMs = 500): void {
  useEffect(() => startAutosave(delayMs), [delayMs]);
}
