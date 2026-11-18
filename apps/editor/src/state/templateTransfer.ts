import {
  appendAuthoringPrompt,
  createId,
  getCompositionOutputRect,
  migrateProject,
  type Project,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { runAtomicHistoryStep } from './historyStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import {
  addProjectSetTemplate,
  reorderProjectSetTemplate,
  resolveProjectSetTemplate,
  type ProjectSetDocument,
} from './projectSet';
import { syncProjectSetPreviewControls } from './projectSetSession';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import {
  TEMPLATE_SET_SETTING_KEYS,
  templateSetSettingsFromProject,
  type TemplateSetSettingKey,
  type TemplateSetSettings,
} from './templateSetSettings';
import { preparePreservedTransferProject } from './templateTransferDependencies';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';

type TransferSource = 'clipboard' | 'resolved-file';
type SettingValue = string | number | boolean;

export interface TemplateTransferReport {
  policy: 'keep-appearance';
  sourceKind: TransferSource;
  templateId: string;
  projectId: string;
  compositionId: string;
  inheritSettings: false;
  inheritBrandKit: false;
  settingsDifferences: {
    key: TemplateSetSettingKey;
    source: SettingValue;
    destination: SettingValue;
  }[];
  warnings: string[];
}

interface PreparedTemplateTransfer {
  set: ProjectSetDocument;
  resolved: Project;
  result: { name: string; transfer: TemplateTransferReport };
  assertCurrentDestination: () => void;
}

/** Retain the editor's exact authored destination across an asynchronous source picker. */
export function captureTemplateTransferDestination(): () => void {
  const before = useProjectSetStore.getState();
  const project = useProjectStore.getState().project;
  return () => {
    const after = useProjectSetStore.getState();
    if (
      before.projectSet !== after.projectSet ||
      before.activeTemplateId !== after.activeTemplateId ||
      project !== useProjectStore.getState().project
    ) {
      throw new Error('The destination document changed. Choose the template again.');
    }
  };
}

export function uniqueTemplateName(set: ProjectSetDocument, name: string): string {
  const names = new Set(
    set.templates.map((item) => item.name.trim().normalize('NFC').toLowerCase()),
  );
  const base = name.trim().normalize('NFC') || 'Untitled Template';
  let next = base;
  let suffix = 2;
  while (names.has(next.toLowerCase())) next = `${base} ${suffix++}`;
  return next;
}

/** Assign new document IDs to a cloned project before inserting it as another template. */
export function assignTemplateProjectIdentity(project: Project): Map<string, string> {
  const compositionIds = new Map(
    project.compositions.map((composition) => [composition.id, createId('composition')]),
  );
  const originalProjectId = project.id;
  project.id = createId('project');
  if (project.presenter)
    project.presenter.entries = project.presenter.entries.map((entry) => ({
      ...entry,
      templateId: entry.templateId === originalProjectId ? project.id : entry.templateId,
    }));
  project.mainCompositionId = compositionIds.get(project.mainCompositionId)!;
  for (const composition of project.compositions)
    composition.id = compositionIds.get(composition.id)!;
  return compositionIds;
}

function settingValue(settings: TemplateSetSettings, key: TemplateSetSettingKey): SettingValue {
  return key.startsWith('layout.')
    ? settings.layout[key.slice('layout.'.length) as keyof TemplateSetSettings['layout']]
    : settings[key as Exclude<keyof TemplateSetSettings, 'layout'>];
}

function outputFormat(project: Project) {
  const composition = project.compositions.find((item) => item.id === project.mainCompositionId)!;
  const { width, height } = getCompositionOutputRect(composition);
  return `${width} × ${height} at ${composition.frameRate} fps`;
}

export function validatedTemplateInsertion(set: ProjectSetDocument, templateId: string): Project {
  const resolved = migrateProject(resolveProjectSetTemplate(set, templateId));
  const validation = validateProject(resolved);
  if (!validation.valid)
    throw new Error(`Cannot open this template. ${validation.errors.slice(0, 3).join(' ')}`);
  return resolved;
}

/** Build the complete destination without publishing it or switching the active project. */
export function prepareTemplateTransfer(
  destination: ProjectSetDocument,
  source: Project,
  sourceKind: TransferSource,
  options: { targetId?: string | null; side?: 'before' | 'after'; originalPrompt?: string } = {},
): PreparedTemplateTransfer {
  const assertCurrentDestination = captureTemplateTransferDestination();
  if (destination.templates.length >= 256)
    throw new Error('A template set can contain at most 256 templates.');
  const hydratedSource = sourceKind === 'resolved-file' ? migrateProject(source) : source;
  const project = preparePreservedTransferProject(hydratedSource, destination);
  if (sourceKind === 'clipboard') assignTemplateProjectIdentity(project);
  if (options.originalPrompt !== undefined)
    appendAuthoringPrompt(project, { id: createId('prompt'), text: options.originalPrompt });
  const name = uniqueTemplateName(destination, project.name);
  project.name = name;
  const added = addProjectSetTemplate(destination, project, name, false, {
    inheritBrandKit: false,
  });
  const { id: templateId } = added.templates.at(-1)!;
  const set = options.targetId
    ? reorderProjectSetTemplate(added, templateId, options.targetId, options.side ?? 'after')
    : added;
  const resolved = validatedTemplateInsertion(set, templateId);
  const sourceSettings = templateSetSettingsFromProject(resolved);
  const differences: TemplateTransferReport['settingsDifferences'] = [];
  if (destination.settings) {
    for (const key of TEMPLATE_SET_SETTING_KEYS) {
      const source = settingValue(sourceSettings, key);
      const target = settingValue(destination.settings, key);
      if (!Object.is(source, target)) differences.push({ key, source, destination: target });
    }
  }
  const warnings: string[] = [];
  if (sourceKind === 'resolved-file')
    warnings.push(
      'This transfer uses the file’s resolved branding. Source kit links are unavailable.',
    );
  const coordinatedIds = new Set(
    destination.transitionLogic?.states.map(({ templateId }) => templateId),
  );
  const first = destination.templates.find(({ id }) => coordinatedIds.has(id));
  if (first) {
    const sourceOutput = outputFormat(resolved);
    const targetOutput = outputFormat(resolveProjectSetTemplate(destination, first.id));
    if (sourceOutput !== targetOutput)
      warnings.push(
        `Kept the template output at ${sourceOutput}. Coordinated export requires the same output size and frame rate across templates (${targetOutput}).`,
      );
  }
  return {
    set,
    resolved,
    assertCurrentDestination,
    result: {
      name,
      transfer: {
        policy: 'keep-appearance',
        sourceKind,
        templateId,
        projectId: resolved.id,
        compositionId: resolved.mainCompositionId,
        inheritSettings: false,
        inheritBrandKit: false,
        settingsDifferences: differences,
        warnings,
      },
    },
  };
}

/** Publish a validated insertion as one undo step, including a change of active template. */
export function commitTemplateSetInsertion(
  set: ProjectSetDocument,
  activeTemplateId: string,
  resolved: Project | null,
  historyLabel: string,
  freshUiTemplate = false,
): void {
  const beforeProject = useProjectStore.getState();
  const beforeSet = useProjectSetStore.getState();
  const beforeSelection = useSelectionStore.getState();
  const beforeTimeline = useTimelineStore.getState();
  const beforeTestData = useTestDataStore.getState();
  const beforeClipboard = useLayerClipboardStore.getState();
  const restoreFreshSession = beforeProject.captureFreshTemplateSession();
  runAtomicHistoryStep(
    () => {
      if (resolved)
        beforeProject.loadProject(resolved, {
          freshUiTemplate,
          setNavigationId: set.id,
          setTemplateId: activeTemplateId,
          previousTemplateId: beforeSet.activeTemplateId,
        });
      useProjectSetStore.setState({
        projectSet: { ...set, activeTemplateId },
        activeTemplateId,
      });
      if (resolved) {
        useTestDataStore.getState().resetAll();
        syncProjectSetPreviewControls(set, activeTemplateId, useProjectStore.getState().project);
        useSelectionStore.getState().select(null);
      }
    },
    () => {
      useProjectSetStore.setState(beforeSet, true);
      useProjectStore.setState(beforeProject, true);
      useSelectionStore.setState(beforeSelection, true);
      useTimelineStore.setState(beforeTimeline, true);
      useTestDataStore.setState(beforeTestData, true);
      useLayerClipboardStore.setState(beforeClipboard, true);
      restoreFreshSession();
      try {
        beforeTimeline.controller?.seek(beforeTimeline.currentFrame);
        if (beforeTimeline.isPlaying) beforeTimeline.controller?.play();
      } catch {
        // Keep the original exception and restored document if the old player is unavailable.
      }
    },
    historyLabel,
  );
}

export function commitTemplateTransfer(
  prepared: PreparedTemplateTransfer,
  keepActiveTemplate = false,
) {
  prepared.assertCurrentDestination();
  commitTemplateSetInsertion(
    prepared.set,
    keepActiveTemplate ? prepared.set.activeTemplateId! : prepared.result.transfer.templateId,
    keepActiveTemplate ? null : prepared.resolved,
    keepActiveTemplate ? 'Create template set' : 'Transfer template',
  );
  return prepared.result;
}

export function templateTransferStatus(
  verb: string,
  { name, transfer }: { name: string; transfer?: TemplateTransferReport },
): string {
  if (!transfer) return `${verb} “${name}”`;
  const labels: Partial<Record<TemplateSetSettingKey, string>> = {
    width: 'canvas width',
    height: 'canvas height',
    frameRate: 'frame rate',
    backgroundColor: 'canvas color',
  };
  const settings = transfer.settingsDifferences.flatMap(({ key, source, destination }) => {
    const label = labels[key];
    return label ? [`${label} ${source} (set default ${destination})`] : [];
  });
  const details = settings.length ? ` Kept ${settings.join(', ')}.` : '';
  const warnings = transfer.warnings.length ? ` ${transfer.warnings.join(' ')}` : '';
  return `${verb} “${name}” with source branding and settings.${details}${warnings}`;
}
