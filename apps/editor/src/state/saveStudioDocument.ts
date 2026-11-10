import { saveProjectSetToFile, saveProjectSourceToFile } from './fileIO';
import { renameProjectSet, type ProjectSetArchiveProgress } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { transitionLogicEditorSetSnapshot } from './transitionLogicEditing';

function currentDocumentKey(): string {
  const { documentLoadRevision, project } = useProjectStore.getState();
  const { projectSet } = useProjectSetStore.getState();
  return projectSet
    ? `${documentLoadRevision}:set:${projectSet.id}`
    : `${documentLoadRevision}:template:${project.id}`;
}

let destination: { key: string; handle: FileSystemFileHandle } | undefined;
let saving = false;

/** The destination belongs to the current editor session, separate from serialized content. */
export function attachStudioDocumentFile(handle: FileSystemFileHandle | undefined): void {
  // Keep legacy and imported sources intact. Their first Save writes an .ogs document.
  destination =
    handle && /\.ogs$/i.test(handle.name) ? { key: currentDocumentKey(), handle } : undefined;
}

type StudioSaveResult =
  { status: 'cancelled' } | { status: 'saved' | 'downloaded'; fileName: string };

export async function saveStudioDocument(
  mode: 'save' | 'save-as',
  ownerWindow: Window,
  onProgress?: (progress: ProjectSetArchiveProgress) => void,
): Promise<StudioSaveResult> {
  if (saving) throw new Error('A document save is already in progress.');
  const key = currentDocumentKey();
  const handle = mode === 'save' && destination?.key === key ? destination.handle : undefined;
  const { project } = useProjectStore.getState();
  const { projectSet } = useProjectSetStore.getState();
  saving = true;
  try {
    const result = projectSet
      ? await saveProjectSetToFile(transitionLogicEditorSetSnapshot(projectSet, project), {
          ownerWindow,
          handle,
          archiveMode: 'compact',
          onProgress,
        })
      : await saveProjectSourceToFile(project, { ownerWindow, handle });
    if (result.status === 'saved' && key === currentDocumentKey()) {
      attachStudioDocumentFile(result.handle);
      // A save can finish after further editing. Apply only the filename change and respect a
      // name edit made while the picker or write was pending.
      if ('projectSet' in result) {
        const latest = useProjectSetStore.getState().projectSet;
        if (latest && latest.name === projectSet?.name && latest.name !== result.projectSet.name) {
          useProjectSetStore
            .getState()
            .setProjectSet(renameProjectSet(latest, result.projectSet.name));
        }
      } else {
        const latest = useProjectStore.getState();
        if (latest.project.name === project.name && latest.project.name !== result.project.name)
          latest.setProjectMeta({ name: result.project.name });
      }
    }
    if (result.status === 'cancelled') return result;
    return { status: result.status, fileName: result.fileName };
  } finally {
    saving = false;
  }
}
