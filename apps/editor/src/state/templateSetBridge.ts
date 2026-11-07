import { getExportProfile, getOfflinePreviewFileName } from '@ograf-editor/codegen';
import { createCertifiedCoordinatedPackage } from './coordinatedExport';
import { exportFailure } from './certifiedArtifactSave';
import type { CoordinatedExportRequest } from '@ograf-editor/agent-tools/template-set-storage';
import {
  hasElementMediaPaint,
  isMediaPaint,
  normalizeCanvasCrop,
  type FieldValue,
  type DesignSystem,
  type DesignToken,
  type TypographyPreset,
  type BackgroundStyle,
  type Paint,
  type TypographyProperty,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import {
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  PROJECT_SET_SCHEMA_VERSION,
  renameProjectSet,
  renameProjectSetTemplate,
  reorderProjectSetTemplate,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  setProjectSetControlValue,
  bindProjectSetControl,
  bindProjectSetAsset,
  setProjectSetAssetSlotSource,
  validateProjectSetDocument,
  type ProjectSetDocument,
} from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import { sharedAssetImpact, sharedSourceReferences } from './sharedAssetImpact';
import { sharedComponentUsage } from './sharedResourceUsage';
import { createProjectSetArchiveTask } from './projectSetArchiveTask';
import {
  MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES,
  type TemplateSetArchiveRequest,
  type TemplateSetArchiveResult,
} from '@ograf-editor/agent-tools/template-set-storage';
import { applyProjectSetChange, activateProjectSetTemplate } from './projectSetSession';
import {
  duplicateTemplate,
  copyTemplate,
  pasteTemplate,
  removeTemplate,
  undoRemoveTemplate,
  newTemplate,
  useTemplateClipboardStore,
} from './templateCommands';
import {
  saveTemplateSetSettings,
  setTemplateSettingsInheritance,
} from './templateSetSettingsStore';
import {
  templateSetSettingsFromProject,
  effectiveTemplateSetSettings,
  TEMPLATE_SET_SETTING_KEYS,
  type TemplateSetSettingKey,
  type TemplateSetSettings,
} from './templateSetSettings';
import {
  replaceSharedBrandKit,
  updateSharedBrandToken,
  removeSharedBrandToken,
} from './templateSetBrandKit';
import { generateBrandKitCss } from './templateSetTheme';
import { applyTransitionLogicDefinition } from './transitionLogicEditing';
import {
  transitionLogicDraftChanged,
  useTransitionLogicDraftStore,
} from './transitionLogicDraftStore';
import {
  updateTypographyPreset,
  updateBackgroundStyle,
  removeTypographyPreset,
  removeBackgroundStyle,
  applyTypographyToLayers,
  resetTypographyProperty,
  setDefaultBackgroundStyle,
  applyBackgroundStyle,
  updateCompositionBackgroundPaint,
  resetCompositionBackground,
} from './brandKitStyles';

const epoch = crypto.randomUUID();
let revision = 0;
const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
  if (state.project !== previous.project) revision += 1;
});
const unsubscribeSet = useProjectSetStore.subscribe((state, previous) => {
  if (
    state.projectSet !== previous.projectSet ||
    state.activeTemplateId !== previous.activeTemplateId
  )
    revision += 1;
});
const unsubscribeClipboard = useTemplateClipboardStore.subscribe((state, previous) => {
  if (state.copied !== previous.copied || state.removed !== previous.removed) revision += 1;
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unsubscribeProject();
    unsubscribeSet();
    unsubscribeClipboard();
  });

function currentSet(): ProjectSetDocument | null {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  return projectSet && activeTemplateId
    ? saveProjectSetTemplateEdits(projectSet, activeTemplateId, useProjectStore.getState().project)
    : projectSet;
}
function requireSet() {
  const set = currentSet();
  if (!set) throw new Error('Create or open a template set first.');
  return set;
}
function snapshot(
  includeProjects = false,
  page: {
    templateIds?: string[];
    offset?: number;
    limit?: number;
    resourceUsage?: { slotIds?: string[]; componentIds?: string[] };
  } = {},
): Record<string, unknown> {
  const set = currentSet();
  const clipboard = useTemplateClipboardStore.getState();
  const offset = page.offset ?? 0;
  const limit = page.limit ?? 256;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 256
  )
    throw new Error(
      'Template snapshot offset/limit must be bounded nonnegative integers (limit 1–256).',
    );
  if (
    page.templateIds !== undefined &&
    (!Array.isArray(page.templateIds) ||
      page.templateIds.length > 256 ||
      page.templateIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256))
  )
    throw new Error('Template snapshot templateIds must contain at most 256 valid IDs.');
  for (const id of page.templateIds ?? [])
    if (!set?.templates.some((template) => template.id === id))
      throw new Error(`Template snapshot references missing template ${id}.`);
  const filtered =
    set?.templates.filter(
      (template) => !page.templateIds || page.templateIds.includes(template.id),
    ) ?? [];
  const templates = filtered.slice(offset, offset + limit);
  let resourceUsage: Record<string, unknown> | undefined;
  if (page.resourceUsage !== undefined) {
    if (!set || !page.resourceUsage || typeof page.resourceUsage !== 'object')
      throw new Error('Shared resource usage requires an open template set.');
    const checkedIds = (ids: unknown, name: string): string[] => {
      if (ids === undefined) return [];
      if (
        !Array.isArray(ids) ||
        ids.length > 16 ||
        ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256) ||
        new Set(ids).size !== ids.length
      )
        throw new Error(`${name} must contain at most 16 distinct valid IDs.`);
      return ids;
    };
    const slotIds = checkedIds(page.resourceUsage.slotIds, 'Slot IDs');
    const componentIds = checkedIds(page.resourceUsage.componentIds, 'Component IDs');
    const library = componentLibraryFromTemplates(set);
    resourceUsage = {
      // Template details follow the same page as templateSet.templates. Impact
      // totals cover the whole set; affected IDs are capped to keep reads bounded.
      slots: slotIds.map((id) => {
        const slot = set.assetSlots.find((item) => item.id === id);
        if (!slot) throw new Error(`Shared asset slot not found: ${id}`);
        const affected = sharedAssetImpact(set, id, true);
        const direct = slot.assetId ? sharedSourceReferences(set, slot.assetId) : null;
        return {
          slotId: id,
          sourceAssetId: slot.assetId,
          templates: templates.map((template) => {
            const binding = slot.bindings.find((item) => item.templateId === template.id);
            return {
              templateId: template.id,
              status: !binding
                ? 'not-linked'
                : !binding.inherit
                  ? 'local'
                  : !slot.assetId
                    ? 'local-fallback'
                    : 'inherited',
              ...(binding
                ? {
                    bindingId: binding.id,
                    compositionId: binding.compositionId,
                    assetId: binding.templateAssetId,
                  }
                : {}),
            };
          }),
          replacementImpact: {
            affectedSlotCount: affected.length,
            affectedSlotIds: affected.slice(0, 32).map((item) => item.slot.id),
            affectedSlotIdsTruncated: affected.length > 32,
            inheritedBindings: affected.reduce(
              (sum, item) => sum + item.bindings.filter((binding) => binding.inherit).length,
              0,
            ),
            localBindings: affected.reduce(
              (sum, item) => sum + item.bindings.filter((binding) => !binding.inherit).length,
              0,
            ),
            relatedReferences: direct
              ? {
                  controlCount: direct.controls.length,
                  componentCount: direct.components.length,
                  brandKit: direct.brandKit,
                  settings: direct.settings,
                }
              : null,
          },
        };
      }),
      components: componentIds.map((id) => {
        if (!library.some((item) => item.id === id))
          throw new Error(`Shared component not found: ${id}`);
        return {
          componentId: id,
          templates: templates.map((template) => ({
            templateId: template.id,
            ...sharedComponentUsage(template.project, id),
          })),
        };
      }),
    };
  }
  if (includeProjects && set) {
    let bytes = 0;
    for (const template of templates) {
      bytes += JSON.stringify(template.project).length;
      if (bytes > 32 * 1024 * 1024)
        throw new Error(
          'This set is too large for a full MCP snapshot. Read with templateIds or limit: 1, then follow pagination.nextOffset.',
        );
    }
  }
  const result = {
    revision: `${epoch}:${revision}`,
    activeTemplateId: useProjectSetStore.getState().activeTemplateId,
    clipboardAvailable: !!clipboard.copied,
    canUndoRemove: !!set && clipboard.removed?.setId === set.id,
    pagination: {
      total: filtered.length,
      offset,
      limit,
      returned: templates.length,
      nextOffset: offset + templates.length < filtered.length ? offset + templates.length : null,
    },
    templateSet: set
      ? {
          id: set.id,
          name: set.name,
          storage: {
            defaultArchiveMode: 'compact',
            archiveSchemaVersion: PROJECT_SET_SCHEMA_VERSION,
            compatibleSchemaVersion: 5,
            hydratedProjects: true,
            sharedResources: 'once-per-set',
            sharedComponents: 'once-per-set',
          },
          settings: set.settings,
          brandKit: set.brandKit,
          brandKitCss: set.brandKit ? generateBrandKitCss(set.brandKit) : undefined,
          templates: templates.map((template) => {
            const project = includeProjects
              ? resolveProjectSetTemplate(set, template.id)
              : template.project;
            const main = project.compositions.find(
              (composition) => composition.id === project.mainCompositionId,
            )!;
            const defaults =
              template.inheritSettings !== false
                ? effectiveTemplateSetSettings(
                    template.project,
                    set.settings,
                    template.settingsOverrides,
                  )
                : undefined;
            const width = defaults?.width ?? main.width,
              height = defaults?.height ?? main.height;
            const media = project.compositions.some(
              (composition) =>
                composition.mediaCues.length > 0 ||
                isMediaPaint(composition.backgroundPaint) ||
                composition.layers.some(
                  (layer) => layer.element.type === 'audio' || hasElementMediaPaint(layer.element),
                ),
            );
            return {
              id: template.id,
              name: template.name,
              projectId: project.id,
              inheritSettings: template.inheritSettings !== false,
              settingsOverrides: template.settingsOverrides ?? [],
              brandKitOverrides: template.brandKitOverrides ?? [],
              typographyOverrides: template.typographyOverrides ?? [],
              backgroundOverrides: template.backgroundOverrides ?? [],
              backgroundOverridden: template.backgroundOverridden ?? false,
              settingsOrigins: Object.fromEntries(
                TEMPLATE_SET_SETTING_KEYS.map((key) => [
                  key,
                  !set.settings || template.inheritSettings === false
                    ? 'local'
                    : template.settingsOverrides?.includes(key)
                      ? 'overridden'
                      : 'inherited',
                ]),
              ),
              compositionId: main.id,
              width,
              height,
              frameRate: defaults?.frameRate ?? main.frameRate,
              crop: main.crop ? normalizeCanvasCrop(main.crop, width, height) : undefined,
              backgroundStyleId: main.backgroundStyleId,
              backgroundPaintType:
                typeof main.backgroundPaint === 'string' ? 'solid' : main.backgroundPaint?.type,
              layerCount: main.layers.length,
              supportsRealTime: media || (defaults?.supportsRealTime ?? project.supportsRealTime),
              supportsNonRealTime:
                !media && (defaults?.supportsNonRealTime ?? project.supportsNonRealTime),
              ...(includeProjects ? { project } : {}),
            };
          }),
          controls: set.controls,
          transitionLogic: set.transitionLogic ?? null,
          assetSlots: set.assetSlots,
          assets: set.assets.map(({ dataUri: _data, ...asset }) => asset),
          ...(resourceUsage ? { resourceUsage } : {}),
        }
      : null,
  };
  if (includeProjects && JSON.stringify(result).length > 32 * 1024 * 1024)
    throw new Error(
      'This page is too large for a full MCP snapshot. Use templateIds or limit: 1, or read the active template with get_project.',
    );
  return result;
}

export function handleTemplateSetRequest(request: {
  action: 'read' | 'command';
  expectedRevision?: string;
  includeProjects?: boolean;
  resourceUsage?: { slotIds?: string[]; componentIds?: string[] };
  templateIds?: string[];
  offset?: number;
  limit?: number;
  operation?: Record<string, unknown>;
  confirm?: boolean;
}): Record<string, unknown> {
  if (request.action === 'read') return snapshot(request.includeProjects, request);
  if (request.expectedRevision !== `${epoch}:${revision}`)
    throw new Error(
      'Template-set revision conflict. Re-read ograf_get_template_set and retry intentionally.',
    );
  const operation = request.operation;
  if (!operation || typeof operation.type !== 'string')
    throw new Error('A template-set operation is required.');
  const templateId = String(operation.templateId ?? '');
  const target = typeof operation.targetTemplateId === 'string' ? operation.targetTemplateId : null;
  const side = operation.side === 'before' ? 'before' : 'after';
  const change = (updated: ProjectSetDocument, refresh = false) => {
    validateProjectSetDocument(updated);
    applyProjectSetChange(updated, refresh);
  };
  switch (operation.type) {
    case 'set_transition_logic': {
      const set = requireSet();
      const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
      if (draft && transitionLogicDraftChanged(draft))
        throw new Error(
          'Playout transitions have unapplied edits. Apply or Revert the draft before updating it through MCP.',
        );
      const definition = operation.definition;
      if (
        definition !== null &&
        (!definition || typeof definition !== 'object' || Array.isArray(definition))
      )
        throw new Error('Transition Logic must be a complete definition object or null.');
      if (
        set.transitionLogic &&
        (definition === null ||
          (definition as Record<string, unknown>).id !== set.transitionLogic.id) &&
        !request.confirm
      )
        throw new Error('Removing or replacing Transition Logic requires confirm:true.');
      applyTransitionLogicDefinition(definition as TransitionLogicDefinition | null);
      useTransitionLogicDraftStore
        .getState()
        .sync(set.id, definition as TransitionLogicDefinition | null);
      break;
    }
    case 'upsert_brand_style': {
      const set = requireSet();
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      if (operation.kind === 'typography') {
        const style = operation.style as TypographyPreset;
        if (set.brandKit.typography?.some((item) => item.id === style.id))
          updateTypographyPreset('set', style.id, style);
        else
          replaceSharedBrandKit({
            ...set.brandKit,
            typography: [...(set.brandKit.typography ?? []), style],
          });
      } else {
        const style = operation.style as BackgroundStyle;
        if (set.brandKit.backgrounds?.some((item) => item.id === style.id))
          updateBackgroundStyle('set', style.id, style);
        else
          replaceSharedBrandKit({
            ...set.brandKit,
            backgrounds: [...(set.brandKit.backgrounds ?? []), style],
          });
      }
      break;
    }
    case 'remove_brand_style':
      if (operation.kind === 'typography') removeTypographyPreset('set', String(operation.styleId));
      else removeBackgroundStyle('set', String(operation.styleId));
      break;
    case 'set_brand_style_override': {
      const set = requireSet(),
        id = String(operation.styleId),
        kind = operation.kind === 'typography' ? 'typography' : 'backgrounds',
        key = kind === 'typography' ? 'typographyOverrides' : 'backgroundOverrides';
      if (!set.brandKit?.[kind]?.some((style) => style.id === id))
        throw new Error('Shared style not found.');
      if (!set.templates.some((template) => template.id === templateId))
        throw new Error('Template not found.');
      change(
        {
          ...set,
          templates: set.templates.map((template) =>
            template.id === templateId
              ? {
                  ...template,
                  [key]: operation.override
                    ? [...new Set([...(template[key] ?? []), id])]
                    : (template[key] ?? []).filter((value) => value !== id),
                }
              : template,
          ),
        },
        true,
      );
      break;
    }
    case 'apply_typography':
      applyTypographyToLayers(operation.layerIds as string[], operation.presetId as string | null);
      break;
    case 'reset_typography_property':
      resetTypographyProperty(String(operation.layerId), operation.property as TypographyProperty);
      break;
    case 'set_background_style':
      if (operation.asDefault) setDefaultBackgroundStyle(operation.styleId as string | null);
      else applyBackgroundStyle(operation.styleId as string | null);
      break;
    case 'set_background_paint':
      updateCompositionBackgroundPaint(
        operation.paint === null ? undefined : (operation.paint as Paint),
      );
      break;
    case 'reset_background':
      resetCompositionBackground();
      break;
    case 'set_setting_override': {
      const set = requireSet();
      const key = operation.key as TemplateSetSettingKey;
      if (!TEMPLATE_SET_SETTING_KEYS.includes(key)) throw new Error('Unknown inherited setting.');
      if (!set.templates.some((template) => template.id === templateId))
        throw new Error('Template not found.');
      change(
        {
          ...set,
          templates: set.templates.map((template) =>
            template.id === templateId
              ? {
                  ...template,
                  settingsOverrides: operation.override
                    ? [...new Set([...(template.settingsOverrides ?? []), key])]
                    : (template.settingsOverrides ?? []).filter((item) => item !== key),
                }
              : template,
          ),
        },
        true,
      );
      break;
    }
    case 'set_brand_kit':
      replaceSharedBrandKit(operation.brandKit as DesignSystem);
      break;
    case 'upsert_brand_token': {
      const set = requireSet();
      if (!set.brandKit) throw new Error('Create the master Brand Kit first.');
      const token = operation.token as DesignToken;
      if (set.brandKit.tokens.some((item) => item.id === token.id))
        updateSharedBrandToken(token.id, token);
      else replaceSharedBrandKit({ ...set.brandKit, tokens: [...set.brandKit.tokens, token] });
      break;
    }
    case 'remove_brand_token':
      removeSharedBrandToken(String(operation.tokenId));
      break;
    case 'set_brand_token_override': {
      const set = requireSet();
      const tokenId = String(operation.tokenId);
      if (!set.brandKit?.tokens.some((token) => token.id === tokenId))
        throw new Error('Shared token not found.');
      if (!set.templates.some((template) => template.id === templateId))
        throw new Error('Template not found.');
      change(
        {
          ...set,
          templates: set.templates.map((template) =>
            template.id === templateId
              ? {
                  ...template,
                  brandKitOverrides: operation.override
                    ? [...new Set([...(template.brandKitOverrides ?? []), tokenId])]
                    : (template.brandKitOverrides ?? []).filter((item) => item !== tokenId),
                }
              : template,
          ),
        },
        true,
      );
      break;
    }
    case 'create': {
      if (useProjectSetStore.getState().projectSet && !request.confirm)
        throw new Error('Replacing the open template set requires confirm:true.');
      const set = createProjectSet(
        String(operation.name ?? DEFAULT_PROJECT_SET_NAME),
        useProjectStore.getState().project,
      );
      useProjectSetStore.getState().setProjectSet(set);
      useProjectSetStore.getState().setActiveTemplateId(set.templates[0]!.id);
      break;
    }
    case 'new_template':
      newTemplate(target, side);
      break;
    case 'duplicate_template':
      duplicateTemplate(templateId);
      break;
    case 'copy_template':
      copyTemplate(templateId);
      break;
    case 'paste_template':
      pasteTemplate(target, side);
      break;
    case 'remove_template':
      if (!request.confirm) throw new Error('Template removal requires confirm:true.');
      removeTemplate(templateId);
      break;
    case 'undo_remove':
      undoRemoveTemplate();
      break;
    case 'activate_template':
      if (!activateProjectSetTemplate(templateId))
        throw new Error('The template set is no longer open.');
      break;
    case 'rename_set':
      change(renameProjectSet(requireSet(), String(operation.name)));
      break;
    case 'rename_template': {
      const renamed = renameProjectSetTemplate(requireSet(), templateId, String(operation.name));
      if (templateId === useProjectSetStore.getState().activeTemplateId)
        useProjectStore.getState().setProjectMeta({
          name: renamed.templates.find((template) => template.id === templateId)!.name,
        });
      useProjectSetStore.getState().setProjectSet(renamed);
      break;
    }
    case 'reorder_template':
      change(reorderProjectSetTemplate(requireSet(), templateId, target!, side));
      break;
    case 'set_inheritance':
      setTemplateSettingsInheritance(templateId, operation.inherit === true);
      break;
    case 'set_defaults': {
      const set = requireSet();
      const base =
        set.settings ?? templateSetSettingsFromProject(useProjectStore.getState().project);
      const patch = operation.patch as Partial<TemplateSetSettings>;
      if (!patch || typeof patch !== 'object') throw new Error('A settings patch is required.');
      const allowed = new Set(Object.keys(base));
      if (Object.keys(patch).some((key) => !allowed.has(key)))
        throw new Error('Unknown template-set default setting.');
      saveTemplateSetSettings(
        { ...base, ...patch, layout: { ...base.layout, ...patch.layout } },
        (operation.inheritance as Record<string, boolean>) ?? {},
      );
      break;
    }
    case 'set_control_value':
      change(
        setProjectSetControlValue(
          requireSet(),
          String(operation.controlId),
          operation.value as FieldValue,
        ),
        true,
      );
      break;
    case 'bind_control':
      change(
        bindProjectSetControl(
          requireSet(),
          String(operation.controlId),
          templateId,
          String(operation.compositionId),
          operation.fieldId as string | null,
        ),
        true,
      );
      break;
    case 'bind_asset':
      change(
        bindProjectSetAsset(
          requireSet(),
          String(operation.slotId),
          templateId,
          String(operation.compositionId),
          operation.templateAssetId as string | null,
        ),
        true,
      );
      break;
    case 'set_asset_slot_source':
      change(
        setProjectSetAssetSlotSource(
          requireSet(),
          String(operation.slotId),
          operation.assetId as string | null,
        ),
        true,
      );
      break;
    default:
      throw new Error(`Unknown template-set operation: ${operation.type}`);
  }
  return snapshot();
}

/** Build a frozen source copy in the archive worker; file writes remain on the MCP host. */
export async function archiveTemplateSetForBridge(
  request: TemplateSetArchiveRequest,
  options: { expiresAt?: number; onProgress?: (message: string) => void } = {},
): Promise<TemplateSetArchiveResult> {
  const expected = `${epoch}:${revision}`;
  const check = () => {
    if (
      request.expectedRevision !== `${epoch}:${revision}` ||
      request.expectedRevision !== expected
    )
      throw new Error(
        'Template-set revision conflict during save. Re-read ograf_get_template_set and retry intentionally.',
      );
    if (options.expiresAt !== undefined && Date.now() >= options.expiresAt)
      throw new Error('Template-set save expired; no file was written.');
  };
  check();
  const archiveMode = request.archiveMode ?? 'compact';
  if (archiveMode !== 'compact' && archiveMode !== 'compatible')
    throw new Error('Template-set archiveMode must be compact or compatible.');
  const set = structuredClone(requireSet());
  const blob = await createProjectSetArchiveTask(set, {
    archiveMode,
    onProgress: (progress) =>
      options.onProgress?.(`${Math.floor(progress.percent)}% · ${progress.message}`),
  });
  check();
  if (blob.size > MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES)
    throw new Error(
      'The prepared set exceeds the 64 MiB MCP save limit. Save it through Studio instead.',
    );
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x6000)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 0x6000))));
  check();
  return {
    revision: expected,
    name: set.name,
    archiveMode,
    schemaVersion: archiveMode === 'compatible' ? 5 : PROJECT_SET_SCHEMA_VERSION,
    archiveBase64: chunks.join(''),
    archiveBytes: bytes.byteLength,
    templateCount: set.templates.length,
    sha256,
  };
}

/** Frozen applied graph plus current unsaved artwork; never mutates or applies editor drafts. */
export async function exportCoordinatedSetForBridge(
  request: CoordinatedExportRequest,
  options: { expiresAt?: number; onProgress?: (message: string) => void } = {},
): Promise<Record<string, unknown>> {
  let stage = 'snapshot';
  const progress: string[] = [stage];
  try {
    const check = () => {
      if (request.expectedRevision !== `${epoch}:${revision}`)
        throw new Error(
          'Template-set revision conflict. Re-read ograf_get_template_set and retry intentionally.',
        );
      if (options.expiresAt !== undefined && Date.now() >= options.expiresAt)
        throw new Error('Coordinated export request expired; no file was written.');
      const current = useProjectSetStore.getState().projectSet;
      const currentDraft = current && useTransitionLogicDraftStore.getState().drafts[current.id];
      if (currentDraft && transitionLogicDraftChanged(currentDraft))
        throw new Error('Playout transitions have unapplied edits. Apply or Revert before export.');
    };
    check();
    const set = structuredClone(requireSet());
    const draft = useTransitionLogicDraftStore.getState().drafts[set.id];
    if (draft && transitionLogicDraftChanged(draft))
      throw new Error('Playout transitions have unapplied edits. Apply or Revert before export.');
    if (!['realtime', 'non-realtime', 'dual'].includes(request.profile))
      throw new Error('Invalid export profile.');
    options.onProgress?.('Compiling and certifying frozen coordinated snapshot');
    stage = 'certification';
    const { blob, artifacts, compatibility } = await createCertifiedCoordinatedPackage(
      set,
      getExportProfile(request.profile),
      {
        onProgress: (next) => {
          stage = next;
          progress.push(next);
          options.onProgress?.(`Coordinated export: ${next}`);
        },
      },
    );
    stage = 'snapshot';
    check();
    stage = 'verification';
    if (blob.size > MAX_TEMPLATE_SET_MCP_ARCHIVE_BYTES)
      throw new Error('Coordinated package exceeds the 64 MiB MCP transfer limit.');
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x6000)
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 0x6000))));
    const includedTemplateIds = artifacts.transitionDescriptor!.templates.map(
      (template) => template.id,
    );
    check();
    return {
      outcome: 'certified',
      stage: 'certification',
      progress: [...progress, 'verification'],
      revision: request.expectedRevision,
      snapshotPolicy: 'frozen-unsaved-artwork-applied-graph-reject-changes',
      profile: request.profile,
      includedTemplateIds,
      includedStateIds: set.transitionLogic!.states.map((state) => state.id),
      unreferencedTemplates: set.templates
        .filter((template) => !includedTemplateIds.includes(template.id))
        .map(({ id, name }) => ({ id, name })),
      certification: compatibility,
      previewFileName: getOfflinePreviewFileName(artifacts),
      archiveBase64: chunks.join(''),
      archiveBytes: bytes.length,
      sha256,
    };
  } catch (error) {
    const failure = exportFailure(error, stage);
    return { outcome: failure.outcome, stage: failure.stage, progress, message: failure.message };
  }
}
