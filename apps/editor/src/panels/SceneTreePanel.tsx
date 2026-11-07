import { useMemo, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { useSelectionStore } from '../state/selectionStore';
import { activateSceneTreeNode, applyProjectSetChange } from '../state/projectSetSession';
import { SceneTreeExplorer } from './SceneTreeExplorer';
import { renameProjectSet, type ProjectSetDocument } from '../state/projectSet';

export function SceneTreePanel() {
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const sessionActiveId = useProjectSetStore((state) => state.activeTemplateId);
  const project = useProjectStore((state) => state.project);
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const [error, setError] = useState('');
  const set = useMemo<ProjectSetDocument>(
    () =>
      projectSet ?? {
        id: `standalone-${project.id}`,
        name: project.name,
        templates: [{ id: `standalone-${project.id}`, name: project.name, project }],
        controls: [],
        assetSlots: [],
        assets: [],
      },
    [projectSet, project],
  );
  return (
    <SceneTreeExplorer
      set={set}
      activeTemplateId={sessionActiveId ?? set.templates[0]?.id ?? ''}
      activeProject={project}
      selectedLayerId={selectedLayerId}
      standalone={!projectSet}
      error={error}
      onRenameSet={(name) => {
        const currentSet = useProjectSetStore.getState().projectSet;
        if (!currentSet) throw new Error('Create or open a template set first.');
        applyProjectSetChange(renameProjectSet(currentSet, name), false);
        setError('');
      }}
      onActivate={(node) => {
        try {
          activateSceneTreeNode(node);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not navigate to scene.');
        }
      }}
      onChange={(updated, refresh) => {
        try {
          applyProjectSetChange(updated, refresh);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not update template set.');
        }
      }}
    />
  );
}
