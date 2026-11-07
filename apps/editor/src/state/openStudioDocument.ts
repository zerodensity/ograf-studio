import { createProject } from '@ograf-editor/scene-model';
import type { EditorWindow } from '../layout/EditorWindow';
import { openStudioDocumentFromFile } from './fileIO';
import { resetHistory } from './historyStore';
import { usePaneRequestStore } from './paneRequestStore';
import { resolveProjectSetTemplate } from './projectSet';
import { syncProjectSetPreviewControls } from './projectSetSession';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import type { StudioDocument } from './studioDocument';
import { useTestDataStore } from './testDataStore';
import { rememberOpenedStudioDocument } from './recentDocuments';

/** Shared File/Presenter open path. The caller owns replacement confirmation and status display. */
export function applyOpenedStudioDocument(opened: StudioDocument): string {
  const projects = useProjectStore.getState();
  const session = useProjectSetStore.getState();
  useTestDataStore.getState().resetAll();
  let message: string;
  if (opened.kind === 'template-set') {
    const set = opened.projectSet;
    const selected =
      set.templates.find((template) => template.id === set.activeTemplateId) ?? set.templates[0];
    const resolved = selected
      ? resolveProjectSetTemplate(set, selected.id)
      : createProject({ name: 'No Template' });
    session.setProjectSet(set);
    session.setActiveTemplateId(selected?.id ?? null);
    projects.loadProject(resolved);
    if (selected) syncProjectSetPreviewControls(set, selected.id, resolved);
    usePaneRequestStore.getState().reveal('templates');
    message = `Opened template set "${set.name}"`;
  } else {
    session.clearProjectSet();
    projects.loadProject(opened.project);
    message = `Opened "${opened.project.name}"`;
  }
  resetHistory();
  useSelectionStore.getState().select(null);
  rememberOpenedStudioDocument(opened);
  return message;
}

/** Open an editable single template or complete set using the triggering pane's browser window. */
export async function openStudioDocument(
  ownerWindow: EditorWindow = window,
): Promise<string | null> {
  if (
    !ownerWindow.confirm(
      'Open an OGraf Studio document? Unsaved changes in the current document will be lost.',
    )
  )
    return null;
  const opened = await openStudioDocumentFromFile(ownerWindow);
  return opened ? applyOpenedStudioDocument(opened) : null;
}
