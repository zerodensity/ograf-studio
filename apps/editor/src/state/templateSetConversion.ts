import type { Project } from '@ograf-editor/scene-model';
import { addProjectSetTemplate, createProjectSet, DEFAULT_PROJECT_SET_NAME } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { createUiProject, setNewCompositionTiming } from './newTemplateTiming';
import {
  commitTemplateSetInsertion,
  commitTemplateTransfer,
  prepareTemplateTransfer,
  validatedTemplateInsertion,
} from './templateTransfer';

/** Convert only after the second template has been chosen and validated. */
export function addSecondTemplateToNewSet(opened: Project, expectedProjectId: string): string {
  return addSecondTemplateToNewSetWithReport(opened, expectedProjectId).name;
}

export function addSecondTemplateToNewSetWithReport(opened: Project, expectedProjectId: string) {
  const session = useProjectSetStore.getState();
  const current = useProjectStore.getState().project;
  if (session.projectSet || current.id !== expectedProjectId)
    throw new Error('The open document changed. Choose the template again.');
  const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, current);
  return commitTemplateTransfer(prepareTemplateTransfer(created, opened, 'resolved-file'), true);
}

/** Promote a standalone document only after the second-template wizard is committed. */
export function createSecondTemplateInNewSet(
  settings: { width: number; height: number; frameRate: number },
  expectedProjectId: string,
): void {
  const session = useProjectSetStore.getState();
  const current = useProjectStore.getState().project;
  if (session.projectSet || current.id !== expectedProjectId)
    throw new Error('The open document changed. Create the template again.');
  const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, current);
  const project = createUiProject();
  Object.assign(project.compositions[0]!, settings);
  setNewCompositionTiming(project.compositions[0]!);
  const base = project.name.trim() || 'Untitled Template';
  const name =
    created.templates[0]!.name.trim().toLocaleLowerCase() === base.toLocaleLowerCase()
      ? `${base} 2`
      : base;
  // Insert the authored values before re-enabling inheritance, so differing wizard settings
  // remain per-template overrides instead of being replaced by the first template's defaults.
  const updated = addProjectSetTemplate(created, { ...project, name }, name, false);
  const added = updated.templates.at(-1)!;
  added.inheritSettings = true;
  if (updated.settings)
    added.settingsOverrides = (['width', 'height', 'frameRate'] as const).filter(
      (key) => settings[key] !== updated.settings![key],
    );
  commitTemplateSetInsertion(
    updated,
    added.id,
    validatedTemplateInsertion(updated, added.id),
    'Create template set',
    true,
  );
}
