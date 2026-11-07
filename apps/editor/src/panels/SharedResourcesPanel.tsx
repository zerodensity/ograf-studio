import { useMemo, useState } from 'react';
import type { ComponentDefinition } from '@ograf-editor/scene-model';
import { componentLibraryFromTemplates } from '../state/componentSetLibrary';
import { activateProjectSetTemplate, applyProjectSetChange } from '../state/projectSetSession';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { sharedComponentUsage } from '../state/sharedResourceUsage';
import { openComponentEditor } from './ComponentEditorDialog';
import { ProjectSetControlsPanel } from './ProjectSetControlsPanel';
import { ResourceTreeBranch, ResourceTreeItem } from './ResourceTreeComponents';
import './ProjectSetControlsPanel.css';

export function SharedResourcesPanel() {
  const set = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const activeProject = useProjectStore((state) => state.project);
  const activeCompositionId = useProjectStore((state) => state.activeCompositionId);
  const [error, setError] = useState('');
  const components = useMemo(() => {
    if (!set) return [];
    const library = new Map<string, ComponentDefinition>();
    for (const definition of componentLibraryFromTemplates(set))
      library.set(definition.id, definition);
    // The active editor can contain changes not yet folded into the set snapshot.
    for (const composition of activeProject.compositions)
      for (const definition of composition.components)
        if (definition.scope === 'set') library.set(definition.id, definition);
    return [...library.values()];
  }, [set, activeProject]);
  if (!set) return null;
  const slotAssetIds = new Set(set.assetSlots.map((slot) => slot.assetId).filter(Boolean));
  const otherAssets = set.assets.filter((asset) => !slotAssetIds.has(asset.id));
  const activeComposition = activeProject.compositions.find(
    (item) => item.id === activeCompositionId,
  );
  return (
    <div className="shared-resources-panel">
      <p className="inspector-hint">
        Shared sources belong to this template set. Local overrides stay independent.
      </p>
      <div className="resources-tree" role="tree" aria-label="Template set resources">
        <ResourceTreeBranch label="Shared components" count={components.length}>
          {components.length === 0 ? (
            <p className="panel-placeholder">No shared components in this set.</p>
          ) : (
            <div className="resources-tree-items" role="group">
              {components.map((component) => {
                const uses = set.templates.map((template) => ({
                  template,
                  usage: sharedComponentUsage(
                    template.id === activeTemplateId ? activeProject : template.project,
                    component.id,
                  ),
                }));
                const count = uses.reduce((sum, item) => sum + item.usage.count, 0);
                const overrides = uses.reduce((sum, item) => sum + item.usage.overridden, 0);
                const canEdit = activeComposition?.components.some(
                  (item) => item.id === component.id,
                );
                return (
                  <ResourceTreeItem
                    key={component.id}
                    label={component.name}
                    meta={`${count} instances · ${overrides} with overrides · Template Set`}
                    preview={<span className="resources-tree-item-icon">C</span>}
                  >
                    <div className="shared-resource-usage">
                      {uses.map(({ template, usage }) => (
                        <div className="shared-resource-usage-row" key={template.id}>
                          <span>{template.name}</span>
                          <span>
                            {usage.count
                              ? `${usage.count} instances · ${usage.overridden ? `${usage.overridden} with overrides` : 'Inherited'}`
                              : 'Not used'}
                          </span>
                          {usage.count > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  activateProjectSetTemplate(template.id);
                                  if (usage.firstCompositionId)
                                    useProjectStore
                                      .getState()
                                      .setActiveComposition(usage.firstCompositionId);
                                  useSelectionStore.getState().select(usage.firstLayerId ?? null);
                                  setError('');
                                } catch (cause) {
                                  setError(
                                    cause instanceof Error
                                      ? cause.message
                                      : 'Could not open template.',
                                  );
                                }
                              }}
                            >
                              Show
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={(event) => {
                          if (activeComposition)
                            openComponentEditor(
                              { compositionId: activeComposition.id, componentId: component.id },
                              event.currentTarget.ownerDocument,
                            );
                        }}
                      >
                        Edit Component
                      </button>
                    </div>
                  </ResourceTreeItem>
                );
              })}
            </div>
          )}
        </ResourceTreeBranch>
        <ResourceTreeBranch label="Other set assets" count={otherAssets.length}>
          <p className="inspector-hint">
            Set assets not currently selected as a slot source may be used by other set features.
          </p>
          {otherAssets.length === 0 ? (
            <p className="panel-placeholder">No other set assets.</p>
          ) : (
            <div className="resources-tree-items" role="group">
              {otherAssets.map((asset) => (
                <ResourceTreeItem
                  key={asset.id}
                  label={asset.name}
                  meta={`${asset.kind} · Template Set`}
                  preview={
                    asset.kind === 'image' ? (
                      <img src={asset.dataUri} alt="" className="resources-asset-thumb" />
                    ) : undefined
                  }
                >
                  <span>{asset.originalFileName || asset.name}</span>
                </ResourceTreeItem>
              ))}
            </div>
          )}
        </ResourceTreeBranch>
      </div>
      {error && (
        <p className="resources-component-error" role="alert">
          {error}
        </p>
      )}
      <ProjectSetControlsPanel
        set={set}
        activeTemplateId={activeTemplateId ?? set.templates[0]?.id ?? ''}
        activeProject={activeProject}
        assetsOnly
        onChange={(updated, refresh) => {
          try {
            applyProjectSetChange(updated, refresh);
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not update template set.');
          }
        }}
      />
    </div>
  );
}
