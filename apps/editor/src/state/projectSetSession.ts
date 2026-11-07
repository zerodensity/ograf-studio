import { resetHistory, runDiscreteHistoryStep } from './historyStore';
import { useProjectSetStore } from './projectSetStore';
import {
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  type ProjectSetDocument,
  type ProjectSetSceneNode,
} from './projectSet';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { migrateProject } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';

export function syncProjectSetPreviewControls(
  set: ProjectSetDocument,
  templateId: string,
  resolvedProject: ReturnType<typeof useProjectStore.getState>['project'],
  previousSet?: ProjectSetDocument,
) {
  const affected = new Set<string>();
  for (const control of [...(previousSet?.controls ?? []), ...set.controls]) {
    for (const binding of control.bindings) {
      if (binding.templateId === templateId) affected.add(binding.fieldId);
    }
  }
  const store = useTestDataStore.getState();
  for (const composition of resolvedProject.compositions) {
    for (const field of composition.dataFields) {
      if (affected.has(field.id))
        store.setValue(field.id, field.defaultValue, composition.layers, composition.dataFields);
    }
  }
}

/** Persists the current child before switching and resets child-specific editor state. */
export function activateProjectSetTemplate(templateId: string, selectedLayerId?: string): boolean {
  const session = useProjectSetStore.getState();
  const { projectSet, activeTemplateId } = session;
  if (!projectSet) return false;
  if (!projectSet.templates.some((template) => template.id === templateId))
    throw new Error(`Template not found: ${templateId}`);
  const projects = useProjectStore.getState();
  const activeTemplate = projectSet.templates.find((template) => template.id === activeTemplateId);
  if (templateId === activeTemplateId && activeTemplate?.project.id === projects.project.id) {
    if (selectedLayerId) useSelectionStore.getState().select(selectedLayerId);
    return true;
  }

  const synced =
    activeTemplate && activeTemplate.project.id === projects.project.id
      ? saveProjectSetTemplateEdits(projectSet, activeTemplate.id, projects.project)
      : projectSet;
  // Validate the requested selection, so a stale previous selection can be recovered.
  const updated = { ...synced, activeTemplateId: templateId };
  const nextProject = migrateProject(resolveProjectSetTemplate(updated, templateId));
  const validation = validateProject(nextProject);
  if (!validation.valid)
    throw new Error(`Cannot open this template. ${validation.errors.slice(0, 3).join(' ')}`);
  // Loading can reject an incoming source. Publish its set selection only after it succeeds.
  projects.loadProject(nextProject, { setNavigationId: projectSet.id, setTemplateId: templateId });
  session.setProjectSet(updated);
  session.setActiveTemplateId(templateId);
  useTestDataStore.getState().resetAll();
  syncProjectSetPreviewControls(updated, templateId, nextProject);
  resetHistory();
  useSelectionStore.getState().select(selectedLayerId ?? null);
  return true;
}

/** Navigate from the current shared selection, including rapid repeated button presses. */
export function activateAdjacentProjectSetTemplate(delta: -1 | 1): boolean {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  if (!projectSet) return false;
  const index = projectSet.templates.findIndex((template) => template.id === activeTemplateId);
  const next = projectSet.templates[index + delta];
  return next ? activateProjectSetTemplate(next.id) : false;
}

/** Applies set-level controls while preserving the active template's latest authored edits. */
export function applyProjectSetChange(
  updated: ProjectSetDocument,
  refreshActiveTemplate: boolean,
  historyLabel = 'Update Template Set',
) {
  return runDiscreteHistoryStep(() => {
    const session = useProjectSetStore.getState();
    const { projectSet, activeTemplateId } = session;
    if (!projectSet || !activeTemplateId) {
      session.setProjectSet(updated);
      return;
    }
    const projects = useProjectStore.getState();
    const synced = saveProjectSetTemplateEdits(projectSet, activeTemplateId, projects.project);
    const source = synced.templates.find((template) => template.id === activeTemplateId);
    const merged: ProjectSetDocument = {
      ...updated,
      templates: updated.templates.map((template) =>
        template.id === activeTemplateId && source
          ? { ...template, project: source.project }
          : template,
      ),
    };
    const resolved = refreshActiveTemplate
      ? resolveProjectSetTemplate(merged, activeTemplateId)
      : null;
    session.setProjectSet(merged);
    if (resolved) {
      const selected = useSelectionStore.getState().selectedLayerIds[0] ?? null;
      const compositionId = projects.activeCompositionId;
      useProjectStore.setState({ project: resolved });
      if (resolved.compositions.some((composition) => composition.id === compositionId))
        useProjectStore.getState().setActiveComposition(compositionId);
      syncProjectSetPreviewControls(merged, activeTemplateId, resolved, projectSet);
      useSelectionStore.getState().select(selected);
    }
  }, historyLabel);
}

/** Reveals the actual composition and layer owned by a template or asset-instance tree node. */
export function activateSceneTreeNode(node: ProjectSetSceneNode) {
  if (node.templateId && useProjectSetStore.getState().projectSet)
    activateProjectSetTemplate(node.templateId);
  const projects = useProjectStore.getState();
  if (node.compositionId && node.compositionId !== projects.activeCompositionId) {
    projects.setActiveComposition(node.compositionId);
    useSelectionStore.getState().select(null);
  }
  if ((node.targetKind === 'layer' || node.targetKind === 'font-use') && node.targetId)
    useSelectionStore.getState().select(node.targetId);
}

/** Changes the eye state without selecting the row or opening the component source editor. */
export function toggleSceneTreeNodeVisibility(node: ProjectSetSceneNode): void {
  if (
    node.kind !== 'layer' &&
    node.kind !== 'component-source-layer' &&
    node.kind !== 'component-instance'
  )
    throw new Error('This Scene Outliner item does not have a visibility control.');

  const resolveTarget = (project: ReturnType<typeof useProjectStore.getState>['project']) => {
    const composition = project.compositions.find((item) => item.id === node.compositionId);
    if (!composition) throw new Error('The owning composition no longer exists.');
    if (node.kind === 'component-source-layer') {
      const component = composition.components.find((item) => item.id === node.componentId);
      const source = component?.layers.find((item) => item.id === node.sourceLayerId);
      if (!component || !source) throw new Error('The component source no longer exists.');
      return { kind: 'source' as const, component, source, composition };
    }
    const layers =
      node.kind === 'component-instance'
        ? composition.layers.filter(
            (layer) =>
              node.componentId &&
              node.instanceId &&
              layer.componentLink?.componentId === node.componentId &&
              layer.componentLink.instanceId === node.instanceId,
          )
        : composition.layers.filter((layer) => layer.id === node.targetId);
    if (!layers.length)
      throw new Error(
        node.kind === 'component-instance'
          ? 'The component instance no longer exists.'
          : 'The scene object no longer exists.',
      );
    return { kind: 'layers' as const, layers, composition };
  };

  const session = useProjectSetStore.getState();
  const current = useProjectStore.getState();
  let ownerProject = current.project;
  if (session.projectSet) {
    const template = session.projectSet.templates.find((item) => item.id === node.templateId);
    if (!template) throw new Error('The owning template no longer exists.');
    if (session.activeTemplateId !== template.id || template.project.id !== current.project.id) {
      const active = session.projectSet.templates.find(
        (item) => item.id === session.activeTemplateId,
      );
      const synced =
        active?.project.id === current.project.id
          ? saveProjectSetTemplateEdits(session.projectSet, active.id, current.project)
          : session.projectSet;
      ownerProject = resolveProjectSetTemplate(synced, template.id);
    }
  } else if (node.templateId && node.templateId !== `standalone-${current.project.id}`) {
    throw new Error('The owning template is no longer open.');
  }
  // Reject stale rows before navigation can disturb the current composition or selection.
  resolveTarget(ownerProject);
  if (session.projectSet && node.templateId) activateProjectSetTemplate(node.templateId);
  const target = resolveTarget(useProjectStore.getState().project);
  if (target.composition.id !== useProjectStore.getState().activeCompositionId) {
    useProjectStore.getState().setActiveComposition(target.composition.id);
    useSelectionStore.getState().select(null);
  }
  const visible =
    target.kind === 'source'
      ? !target.source.isVisible
      : !target.layers.some((layer) => layer.isVisible);
  runDiscreteHistoryStep(
    () => {
      if (target.kind === 'source') {
        useProjectStore
          .getState()
          .updateComponentLayer(target.component.id, target.source.id, { isVisible: visible });
        return;
      }
      for (const layer of target.layers) {
        const latest = useProjectStore
          .getState()
          .project.compositions.find((item) => item.id === target.composition.id)
          ?.layers.find((item) => item.id === layer.id);
        if (latest && latest.isVisible !== visible)
          useProjectStore.getState().toggleLayerVisibility(layer.id);
      }
    },
    `${visible ? 'Show' : 'Hide'} ${node.label}`,
  );
}
