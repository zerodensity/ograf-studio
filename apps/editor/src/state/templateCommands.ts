import { create } from 'zustand';
import {
  appendAuthoringPrompt,
  createProject,
  createId,
  type Project,
} from '@ograf-editor/scene-model';
import {
  addProjectSetTemplate,
  reorderProjectSetTemplate,
  removeProjectSetTemplate,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  type ProjectSetDocument,
  type ProjectSetTemplate,
  type ProjectSetControlBinding,
  type ProjectSetAssetBinding,
} from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { syncProjectSetPreviewControls } from './projectSetSession';
import { resetHistory } from './historyStore';
import { createUiProject, setNewCompositionTiming } from './newTemplateTiming';
import type { TemplateSetSettingKey } from './templateSetSettings';
import {
  assignTemplateProjectIdentity,
  commitTemplateTransfer,
  prepareTemplateTransfer,
  uniqueTemplateName,
  type TemplateTransferReport,
} from './templateTransfer';

export type { TemplateTransferReport } from './templateTransfer';

interface TemplateSnapshot {
  setId: string;
  template: ProjectSetTemplate;
  resolved: Project;
  controls: Array<{ controlId: string; binding: ProjectSetControlBinding }>;
  assets: Array<{ slotId: string; binding: ProjectSetAssetBinding }>;
}

export const useTemplateClipboardStore = create<{
  copied: TemplateSnapshot | null;
  removed: (TemplateSnapshot & { index: number }) | null;
}>()(() => ({ copied: null, removed: null }));

function currentSet() {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  if (!projectSet) throw new Error('Open a template set first.');
  return activeTemplateId
    ? saveProjectSetTemplateEdits(projectSet, activeTemplateId, useProjectStore.getState().project)
    : projectSet;
}

function snapshot(set: ProjectSetDocument, templateId: string): TemplateSnapshot {
  const template = set.templates.find((item) => item.id === templateId);
  if (!template) throw new Error('The template is no longer in this set.');
  return structuredClone({
    setId: set.id,
    template,
    resolved: resolveProjectSetTemplate(set, templateId),
    controls: set.controls.flatMap((control) =>
      control.bindings
        .filter((binding) => binding.templateId === templateId)
        .map((binding) => ({ controlId: control.field.id, binding })),
    ),
    assets: set.assetSlots.flatMap((slot) =>
      slot.bindings
        .filter((binding) => binding.templateId === templateId)
        .map((binding) => ({ slotId: slot.id, binding })),
    ),
  });
}

function apply(set: ProjectSetDocument, activeTemplateId: string | null, freshUiTemplate = false) {
  const session = useProjectSetStore.getState();
  const switchTemplate = session.activeTemplateId !== activeTemplateId;
  session.setProjectSet({ ...set, activeTemplateId: activeTemplateId ?? undefined });
  session.setActiveTemplateId(activeTemplateId);
  if (switchTemplate) {
    const resolved = activeTemplateId
      ? resolveProjectSetTemplate(set, activeTemplateId)
      : createProject({ name: 'No Template' });
    useTestDataStore.getState().resetAll();
    useProjectStore.getState().loadProject(resolved, {
      freshUiTemplate,
      setNavigationId: set.id,
      setTemplateId: activeTemplateId,
      previousTemplateId: session.activeTemplateId,
    });
    if (activeTemplateId) syncProjectSetPreviewControls(set, activeTemplateId, resolved);
    resetHistory();
    useSelectionStore.getState().deselectAll();
  }
}

function position(
  set: ProjectSetDocument,
  id: string,
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
) {
  return targetId ? reorderProjectSetTemplate(set, id, targetId, side) : set;
}

function insertSnapshot(
  set: ProjectSetDocument,
  source: TemplateSnapshot,
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
  duplicate = false,
  originalPrompt?: string,
) {
  if (set.templates.length >= 256)
    throw new Error('A template set can contain at most 256 templates.');
  const keepInheritance =
    source.controls.every((item) =>
      set.controls.some((control) => control.field.id === item.controlId),
    ) && source.assets.every((item) => set.assetSlots.some((slot) => slot.id === item.slotId));
  const project = structuredClone(keepInheritance ? source.template.project : source.resolved);
  if (originalPrompt !== undefined)
    appendAuthoringPrompt(project, { id: createId('prompt'), text: originalPrompt });
  const compositionIds = assignTemplateProjectIdentity(project);
  project.name = uniqueTemplateName(
    set,
    duplicate ? `${source.template.name} Copy` : source.template.name,
  );
  let updated = addProjectSetTemplate(
    set,
    project,
    project.name,
    source.template.inheritSettings !== false,
    { inheritBrandKit: source.template.inheritBrandKit },
  );
  const added = updated.templates.at(-1)!;
  if (keepInheritance) {
    added.settingsOverrides = [...(source.template.settingsOverrides ?? [])];
    added.brandKitOverrides = [...(source.template.brandKitOverrides ?? [])];
    added.typographyOverrides = [...(source.template.typographyOverrides ?? [])];
    added.backgroundOverrides = [...(source.template.backgroundOverrides ?? [])];
    added.backgroundOverridden = source.template.backgroundOverridden;
    added.project = structuredClone(project);
  }
  if (keepInheritance)
    updated = {
      ...updated,
      controls: updated.controls.map((control) => ({
        ...control,
        bindings: [
          ...control.bindings,
          ...source.controls
            .filter((item) => item.controlId === control.field.id)
            .map(({ binding }) => ({
              ...binding,
              templateId: added.id,
              compositionId: compositionIds.get(binding.compositionId)!,
            })),
        ],
      })),
      assetSlots: updated.assetSlots.map((slot) => ({
        ...slot,
        bindings: [
          ...slot.bindings,
          ...source.assets
            .filter((item) => item.slotId === slot.id)
            .map(({ binding }) => ({
              ...binding,
              id: createId('assetinstance'),
              templateId: added.id,
              compositionId: compositionIds.get(binding.compositionId)!,
            })),
        ],
      })),
    };
  updated = position(updated, added.id, targetId, side);
  apply(updated, added.id);
  return added.name;
}

export function copyTemplate(templateId: string) {
  const copied = snapshot(currentSet(), templateId);
  useTemplateClipboardStore.setState({ copied });
  return copied.template.name;
}

export function duplicateTemplate(templateId: string, originalPrompt?: string) {
  const set = currentSet();
  return insertSnapshot(set, snapshot(set, templateId), templateId, 'after', true, originalPrompt);
}

export function pasteTemplate(
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
  originalPrompt?: string,
) {
  return pasteTemplateWithReport(targetId, side, originalPrompt).name;
}

export function pasteTemplateWithReport(
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
  originalPrompt?: string,
): { name: string; transfer?: TemplateTransferReport } {
  const copied = useTemplateClipboardStore.getState().copied;
  if (!copied) throw new Error('Copy a template first.');
  const set = currentSet();
  if (copied.setId === set.id)
    return { name: insertSnapshot(set, copied, targetId, side, false, originalPrompt) };
  return commitTemplateTransfer(
    prepareTemplateTransfer(set, { ...copied.resolved, name: copied.template.name }, 'clipboard', {
      targetId,
      side,
      originalPrompt,
    }),
  );
}

export function insertTemplateProject(
  project: Project,
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
) {
  return insertTemplateProjectWithReport(project, targetId, side).name;
}

export function insertTemplateProjectWithReport(
  project: Project,
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
) {
  return commitTemplateTransfer(
    prepareTemplateTransfer(currentSet(), project, 'resolved-file', { targetId, side }),
  );
}

function insertNewTemplateProject(
  project: Project,
  targetId: string | null | undefined,
  side: 'before' | 'after',
  settingsOverrides: TemplateSetSettingKey[],
) {
  const set = currentSet();
  if (set.templates.length >= 256)
    throw new Error('A template set can contain at most 256 templates.');
  const name = uniqueTemplateName(set, project.name);
  const updated = addProjectSetTemplate(set, { ...project, name }, name);
  const added = updated.templates.at(-1)!;
  if (set.settings && settingsOverrides.length) {
    // Keep only the explicitly selected local settings; the rest still inherit from the set.
    const source = project.compositions.find((item) => item.id === project.mainCompositionId)!;
    const destination = added.project.compositions.find(
      (item) => item.id === added.project.mainCompositionId,
    )!;
    for (const key of settingsOverrides) {
      if (key === 'width' || key === 'height' || key === 'frameRate')
        destination[key] = source[key];
    }
    added.settingsOverrides = [...settingsOverrides];
  }
  apply(position(updated, added.id, targetId, side), added.id, true);
  return name;
}

export function newTemplate(
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
  settings?: { width: number; height: number; frameRate: number },
  originalPrompt?: string,
) {
  const project = createUiProject();
  if (originalPrompt !== undefined)
    appendAuthoringPrompt(project, { id: createId('prompt'), text: originalPrompt });
  const set = currentSet();
  const source = useProjectStore
    .getState()
    .project.compositions.find(
      (composition) => composition.id === useProjectStore.getState().activeCompositionId,
    );
  if (source) {
    project.compositions[0]!.width = source.width;
    project.compositions[0]!.height = source.height;
    project.compositions[0]!.frameRate = source.frameRate;
  }
  const composition = project.compositions[0]!;
  if (settings) Object.assign(composition, settings);
  else if (set.settings) {
    composition.width = set.settings.width;
    composition.height = set.settings.height;
    composition.frameRate = set.settings.frameRate;
  }
  setNewCompositionTiming(composition);
  const overrides: TemplateSetSettingKey[] = set.settings
    ? (['width', 'height', 'frameRate'] as const).filter(
        (key) => composition[key] !== set.settings![key],
      )
    : [];
  return insertNewTemplateProject(project, targetId, side, overrides);
}

export function removeTemplate(templateId: string) {
  const set = currentSet();
  const index = set.templates.findIndex((item) => item.id === templateId);
  const removed = snapshot(set, templateId);
  const updated = removeProjectSetTemplate(set, templateId);
  useTemplateClipboardStore.setState({ removed: { ...removed, index } });
  const activeId = useProjectSetStore.getState().activeTemplateId;
  apply(
    updated,
    activeId === templateId
      ? (updated.templates[Math.min(index, updated.templates.length - 1)]?.id ?? null)
      : activeId,
  );
  return removed.template.name;
}

export function undoRemoveTemplate() {
  const removed = useTemplateClipboardStore.getState().removed;
  const set = currentSet();
  if (!removed || removed.setId !== set.id)
    throw new Error('There is no removed template to restore in this set.');
  if (set.templates.length >= 256) throw new Error('The template set is full.');
  if (set.templates.some((item) => item.id === removed.template.id))
    throw new Error('The template was already restored.');
  const name = uniqueTemplateName(set, removed.template.name);
  const template = {
    ...structuredClone(removed.template),
    name,
    project: { ...structuredClone(removed.template.project), name },
  };
  const templates = [...set.templates];
  templates.splice(Math.min(removed.index, templates.length), 0, template);
  const updated = {
    ...set,
    templates,
    controls: set.controls.map((control) => ({
      ...control,
      bindings: [
        ...control.bindings,
        ...removed.controls
          .filter((item) => item.controlId === control.field.id)
          .map((item) => structuredClone(item.binding)),
      ],
    })),
    assetSlots: set.assetSlots.map((slot) => ({
      ...slot,
      bindings: [
        ...slot.bindings,
        ...removed.assets
          .filter((item) => item.slotId === slot.id)
          .map((item) => structuredClone(item.binding)),
      ],
    })),
  };
  apply(updated, template.id);
  useTemplateClipboardStore.setState({ removed: null });
  return name;
}
