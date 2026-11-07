import { normalizeCanvasCrop } from '@ograf-editor/scene-model';
import { createProjectSet, DEFAULT_PROJECT_SET_NAME } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { resizeConstrainedLayers, useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { resetHistory } from './historyStore';
import { usePaneRequestStore } from './paneRequestStore';
import { revealPaneOnFirstUse } from './firstUsePanes';
import { isUntouchedBlankTiming, setNewCompositionTiming } from './newTemplateTiming';
import { newTemplate } from './templateCommands';
import { createSecondTemplateInNewSet } from './templateSetConversion';
import {
  useStartupScreenStore,
  type StartupRequest,
  type StartupRequestKind,
} from './startupScreenStore';

export interface StartupSettings {
  width: number;
  height: number;
  frameRate: number;
}

const DEFAULT_SETTINGS: StartupSettings = { width: 1920, height: 1080, frameRate: 50 };

/** Open a draft without replacing the current document or changing its autosave. */
export function requestStartupCreation(
  kind: Exclude<StartupRequestKind, 'startup'>,
  targetId?: string | null,
  side: 'before' | 'after' = 'after',
): void {
  const project = useProjectStore.getState();
  const set = useProjectSetStore.getState();
  if (kind === 'set-template' && !set.projectSet) throw new Error('Open a template set first.');
  if (kind === 'second-template' && set.projectSet)
    throw new Error('The template set is already open.');
  useStartupScreenStore.getState().open({
    kind,
    projectId: project.project.id,
    compositionId: project.activeCompositionId,
    setId: set.projectSet?.id ?? null,
    activeTemplateId: set.activeTemplateId,
    ...(kind === 'set-template' ? { targetId: targetId ?? null, side } : {}),
  });
}

/** Start a set from the current template; new children start with their set defaults. */
export function initialStartupSettings(request: StartupRequest | null): StartupSettings {
  if (!request || request.kind === 'startup' || request.kind === 'new-template')
    return { ...DEFAULT_SETTINGS };
  const session = useProjectSetStore.getState();
  if (request.kind === 'set-template' && session.projectSet?.settings) {
    const { width, height, frameRate } = session.projectSet.settings;
    return { width, height, frameRate };
  }
  const current = useProjectStore.getState();
  const composition = current.project.compositions.find(
    (item) => item.id === current.activeCompositionId,
  );
  return composition
    ? { width: composition.width, height: composition.height, frameRate: composition.frameRate }
    : { ...DEFAULT_SETTINGS };
}

function assertCurrentRequest(request: StartupRequest): void {
  if (request.kind === 'startup') return;
  const current = useProjectStore.getState();
  const set = useProjectSetStore.getState();
  if (
    current.project.id !== request.projectId ||
    current.activeCompositionId !== request.compositionId ||
    (set.projectSet?.id ?? null) !== request.setId ||
    set.activeTemplateId !== request.activeTemplateId
  )
    throw new Error(
      'The active template or template set changed. Close this window and try again.',
    );
  if (
    request.kind === 'set-template' &&
    request.targetId &&
    !set.projectSet?.templates.some((template) => template.id === request.targetId)
  )
    throw new Error(
      'The target template is no longer in this set. Close this window and try again.',
    );
}

/** Complete the requested operation only after validating settings and the current document. */
export function commitStartupCreation(
  settings: StartupSettings,
  confirmReplace: (message: string) => boolean,
): boolean {
  if (
    !Number.isSafeInteger(settings.width) ||
    settings.width < 1 ||
    !Number.isSafeInteger(settings.height) ||
    settings.height < 1 ||
    !Number.isFinite(settings.frameRate) ||
    settings.frameRate <= 0
  )
    throw new Error(
      'Enter a positive whole-number canvas width and height, and a positive frame rate.',
    );
  const request = useStartupScreenStore.getState().request;
  if (!request) throw new Error('The creation window is no longer open.');
  assertCurrentRequest(request);

  if (request.kind === 'startup') {
    useProjectStore.getState().updateCompositionSettings(settings);
    return true;
  }
  if (request.kind === 'new-template') {
    const description = request.setId ? 'template set' : 'template';
    if (
      !confirmReplace(
        `Start a new template? Unsaved changes in the current ${description} will be lost.`,
      )
    )
      return false;
    assertCurrentRequest(request);
    useProjectStore.getState().newProject();
    useProjectSetStore.getState().clearProjectSet();
    resetHistory();
    useSelectionStore.getState().select(null);
    useProjectStore.getState().updateCompositionSettings(settings);
    return true;
  }
  if (request.kind === 'second-template') {
    createSecondTemplateInNewSet(settings, request.projectId!);
    usePaneRequestStore.getState().reveal('templates');
    setTimeout(() => revealPaneOnFirstUse('transitions'), 100);
    return true;
  }
  if (request.kind === 'set-template') {
    newTemplate(request.targetId, request.side, settings);
    return true;
  }

  // Create the new set from a detached clone of the latest active project. In particular,
  // resizing constraints and crop must never mutate the outgoing set if confirmation fails.
  if (
    request.setId &&
    !confirmReplace('Create a new template set from this project? The current set will be closed.')
  )
    return false;
  assertCurrentRequest(request);
  const current = useProjectStore.getState();
  const draft = structuredClone(current.project);
  const composition = draft.compositions.find((item) => item.id === current.activeCompositionId);
  if (!composition) throw new Error('The active composition is no longer available.');
  const changed =
    composition.width !== settings.width ||
    composition.height !== settings.height ||
    composition.frameRate !== settings.frameRate;
  const retimeBlank =
    composition.frameRate !== settings.frameRate && isUntouchedBlankTiming(composition);
  resizeConstrainedLayers(
    composition,
    { width: composition.width, height: composition.height },
    settings,
  );
  Object.assign(composition, settings);
  if (retimeBlank) setNewCompositionTiming(composition);
  if (changed && composition.crop)
    composition.crop = normalizeCanvasCrop(composition.crop, settings.width, settings.height);
  const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, draft);
  // Set defaults are chosen from the active composition, which need not be the main
  // composition. Preserve a differing authored main composition as local overrides.
  const main = draft.compositions.find((item) => item.id === draft.mainCompositionId);
  if (!main || !created.settings)
    throw new Error('The current template cannot supply valid template-set settings.');
  Object.assign(created.settings, settings);
  const overrides = (['width', 'height', 'frameRate'] as const).filter(
    (key) => main[key] !== settings[key],
  );
  if (overrides.length) created.templates[0]!.settingsOverrides = overrides;
  if (changed) {
    current.loadProject(draft, { preserveFreshUiIdentity: true });
    if (current.activeCompositionId !== draft.mainCompositionId)
      useProjectStore.getState().setActiveComposition(current.activeCompositionId);
  }
  useProjectSetStore.getState().setProjectSet(created);
  useProjectSetStore.getState().setActiveTemplateId(created.templates[0]!.id);
  usePaneRequestStore.getState().reveal('templates');
  setTimeout(() => revealPaneOnFirstUse('transitions'), 100);
  return true;
}
