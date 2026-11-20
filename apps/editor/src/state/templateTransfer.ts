import {
  appendAuthoringPrompt,
  createId,
  getCompositionOutputRect,
  migrateProject,
  type Asset,
  type Project,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import type { TemplateTransferOptions } from '@ograf-editor/agent-tools/template-transfer-review';
import { runAtomicHistoryStep } from './historyStore';
import { useLayerClipboardStore } from './layerClipboardStore';
import {
  addProjectSetTemplate,
  reorderProjectSetTemplate,
  resolveProjectSetTemplate,
  type ProjectSetBrandKitLinks,
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
import {
  applyTemplateTransferBranding,
  type TemplateTransferMappingRow,
  type TemplateTransferSourceBrandKit,
} from './templateTransferBranding';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';

export type TemplateTransferSourceKind = 'clipboard' | 'resolved-file' | 'template-set-file';
type SettingValue = string | number | boolean;

export interface TemplateTransferReport {
  policy: TemplateTransferOptions['policy'];
  sourceKind: TemplateTransferSourceKind;
  templateId: string;
  projectId: string;
  compositionId: string;
  inheritSettings: boolean;
  inheritBrandKit: false;
  brandKitLinks?: ProjectSetBrandKitLinks;
  mappings: TemplateTransferMappingRow[];
  dependencies?: {
    assets: { id: string; name: string; kind: Asset['kind']; compositionId: string }[];
    components: { id: string; name: string; compositionId: string }[];
  };
  brandingSummary?: { linked: number; preserved: number; overrides: number; unresolved: number };
  settingsDifferences: {
    key: TemplateSetSettingKey;
    source: SettingValue;
    destination: SettingValue;
  }[];
  warnings: string[];
}

export interface PreparedTemplateTransfer {
  set: ProjectSetDocument;
  resolved: Project;
  beforeProject?: Project;
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

function transferDependencies(
  project: Project,
): NonNullable<TemplateTransferReport['dependencies']> {
  return {
    assets: project.compositions.flatMap((composition) => {
      const assets = new Map(composition.assets.map((asset) => [asset.id, asset]));
      for (const component of composition.components)
        for (const asset of component.resources ?? []) assets.set(asset.id, asset);
      return [...assets.values()].map(({ id, name, kind }) => ({
        id,
        name,
        kind,
        compositionId: composition.id,
      }));
    }),
    components: project.compositions.flatMap((composition) =>
      composition.components.map(({ id, name }) => ({ id, name, compositionId: composition.id })),
    ),
  };
}

function transferBrandingSummary(
  rows: TemplateTransferMappingRow[],
  options: TemplateTransferOptions,
): NonNullable<TemplateTransferReport['brandingSummary']> {
  const reset = new Set(
    (options.mappings ?? [])
      .filter(({ resetOverrides }) => resetOverrides)
      .map(({ kind, sourceId }) => `${kind}:${sourceId}`),
  );
  const totals = { linked: 0, preserved: 0, overrides: 0, unresolved: 0 };
  for (const row of rows) {
    const kept = row.action === 'keep-local';
    const overrides = kept || !reset.has(`${row.kind}:${row.sourceId}`) ? row.overridesCount : 0;
    totals.overrides += overrides;
    totals.preserved += kept ? row.affectedCount : overrides;
    totals.linked += kept ? 0 : row.affectedCount - overrides;
    if (row.conflicts.length) totals.unresolved += 1;
  }
  return totals;
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
  sourceKind: TemplateTransferSourceKind,
  options: {
    targetId?: string | null;
    side?: 'before' | 'after';
    originalPrompt?: string;
    sourceBrandKit?: TemplateTransferSourceBrandKit;
    review?: TemplateTransferOptions;
  } = {},
): PreparedTemplateTransfer {
  const assertCurrentDestination = captureTemplateTransferDestination();
  if (destination.templates.length >= 256)
    throw new Error('A template set can contain at most 256 templates.');
  const hydratedSource = sourceKind === 'clipboard' ? source : migrateProject(source);
  const kept = preparePreservedTransferProject(hydratedSource, destination);
  const beforeProject = options.review ? structuredClone(kept) : undefined;
  const branding: ReturnType<typeof applyTemplateTransferBranding> = options.review
    ? applyTemplateTransferBranding(kept, destination, options.sourceBrandKit, options.review)
    : { project: kept, destination, mappings: [], warnings: [] };
  const { project, brandKitLinks } = branding;
  const inheritSettings = options.review?.inheritSettings === true && !!destination.settings;
  if (sourceKind === 'clipboard') assignTemplateProjectIdentity(project);
  if (options.originalPrompt !== undefined)
    appendAuthoringPrompt(project, { id: createId('prompt'), text: options.originalPrompt });
  const name = uniqueTemplateName(destination, project.name);
  project.name = name;
  const added = addProjectSetTemplate(branding.destination, project, name, inheritSettings, {
    inheritBrandKit: false,
    ...(brandKitLinks ? { brandKitLinks } : {}),
  });
  const member = added.templates.at(-1)!;
  const { id: templateId } = member;
  if (branding.brandKitOverrides) member.brandKitOverrides = branding.brandKitOverrides;
  if (branding.typographyOverrides) member.typographyOverrides = branding.typographyOverrides;
  if (branding.backgroundOverrides) member.backgroundOverrides = branding.backgroundOverrides;
  if (branding.backgroundOverridden !== undefined)
    member.backgroundOverridden = branding.backgroundOverridden;
  const set = options.targetId
    ? reorderProjectSetTemplate(added, templateId, options.targetId, options.side ?? 'after')
    : added;
  const resolved = validatedTemplateInsertion(set, templateId);
  if (brandKitLinks) member.project = structuredClone(resolved);
  const sourceSettings = templateSetSettingsFromProject(hydratedSource);
  const differences: TemplateTransferReport['settingsDifferences'] = [];
  if (destination.settings) {
    for (const key of TEMPLATE_SET_SETTING_KEYS) {
      const source = settingValue(sourceSettings, key);
      const target = settingValue(destination.settings, key);
      if (!Object.is(source, target)) differences.push({ key, source, destination: target });
    }
  }
  const warnings = [...branding.warnings];
  if (sourceKind === 'resolved-file' && !options.sourceBrandKit)
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
        `Template output is ${sourceOutput}. Coordinated export requires the same output size and frame rate across templates (${targetOutput}).`,
      );
  }
  return {
    set,
    resolved,
    beforeProject,
    assertCurrentDestination,
    result: {
      name,
      transfer: {
        policy: options.review?.policy ?? 'keep-appearance',
        sourceKind,
        templateId,
        projectId: resolved.id,
        compositionId: resolved.mainCompositionId,
        inheritSettings,
        inheritBrandKit: false,
        ...(brandKitLinks ? { brandKitLinks } : {}),
        mappings: branding.mappings,
        ...(beforeProject && options.review
          ? {
              dependencies: transferDependencies(beforeProject),
              brandingSummary: transferBrandingSummary(branding.mappings, options.review),
            }
          : {}),
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
  const details = settings.length
    ? ` ${transfer.inheritSettings ? 'Compared' : 'Kept'} ${settings.join(', ')}.`
    : '';
  const warnings = transfer.warnings.length ? ` ${transfer.warnings.join(' ')}` : '';
  const branding =
    transfer.policy === 'adopt-destination'
      ? 'reviewed destination branding'
      : transfer.policy === 'bring-source-branding'
        ? 'imported source branding'
        : 'source branding';
  const settingsOrigin = transfer.inheritSettings ? 'destination settings' : 'source settings';
  return `${verb} “${name}” with ${branding} and ${settingsOrigin}.${details}${warnings}`;
}
