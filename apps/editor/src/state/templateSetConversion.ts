import { migrateProject, type Project } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { runAtomicHistoryStep, runDiscreteHistoryStep } from './historyStore';
import {
  addProjectSetTemplate,
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  resolveProjectSetTemplate,
  validateProjectSetDocument,
} from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { createUiProject, setNewCompositionTiming } from './newTemplateTiming';
import { syncProjectSetPreviewControls } from './projectSetSession';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { useTestDataStore } from './testDataStore';
import { useLayerClipboardStore } from './layerClipboardStore';

/** Convert only after the second template has been chosen and validated. */
export function addSecondTemplateToNewSet(opened: Project, expectedProjectId: string): string {
  const session = useProjectSetStore.getState();
  const current = useProjectStore.getState().project;
  if (session.projectSet || current.id !== expectedProjectId)
    throw new Error('The open document changed. Choose the template again.');
  const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, current);
  const originalName = created.templates[0]!.name.trim().toLocaleLowerCase();
  const base = opened.name.trim() || 'Untitled Template';
  const name = base.toLocaleLowerCase() === originalName ? `${base} 2` : base;
  const updated = addProjectSetTemplate(created, { ...opened, name }, name);
  validateProjectSetDocument(updated);
  runDiscreteHistoryStep(() => {
    session.setProjectSet(updated);
    session.setActiveTemplateId(created.templates[0]!.id);
  }, 'Create template set');
  return name;
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
  validateProjectSetDocument(updated);
  const resolved = migrateProject(resolveProjectSetTemplate(updated, added.id));
  const validation = validateProject(resolved);
  if (!validation.valid)
    throw new Error(`Cannot open this template. ${validation.errors.slice(0, 3).join(' ')}`);
  const oldProject = useProjectStore.getState();
  const restoreFreshSession = oldProject.captureFreshTemplateSession();
  const oldSession = useProjectSetStore.getState();
  const oldSelection = useSelectionStore.getState();
  const oldTimeline = useTimelineStore.getState();
  const oldTestData = useTestDataStore.getState();
  const oldClipboard = useLayerClipboardStore.getState();
  runAtomicHistoryStep(
    () => {
      useProjectStore.getState().loadProject(resolved, { freshUiTemplate: true });
      session.setProjectSet({ ...updated, activeTemplateId: added.id });
      session.setActiveTemplateId(added.id);
      useTestDataStore.getState().resetAll();
      syncProjectSetPreviewControls(updated, added.id, resolved);
      useSelectionStore.getState().select(null);
    },
    () => {
      useProjectSetStore.setState(oldSession, true);
      useProjectStore.setState(oldProject, true);
      useSelectionStore.setState(oldSelection, true);
      useTimelineStore.setState(oldTimeline, true);
      useTestDataStore.setState(oldTestData, true);
      useLayerClipboardStore.setState(oldClipboard, true);
      restoreFreshSession();
      try {
        oldTimeline.controller?.seek(oldTimeline.currentFrame);
        if (oldTimeline.isPlaying) oldTimeline.controller?.play();
      } catch {
        // Keep the original load error and restored document even if a stopped player is unavailable.
      }
    },
    'Create template set',
  );
}
