import JSZip from 'jszip';
import {
  SetResourcePool,
  assertCompleteCompactProject,
  assertCompactResourcePlaceholdersResolved,
  extractSetComponents,
  extractSetResources,
  hydrateSetComponents,
  hydrateSetResources,
  setResourcePath,
  type SetResourceRecord,
  type SetResourceReference,
  type SetComponentReference,
  type SharedComponentRecord,
} from './compactSetStorage';
import {
  applySetComponentLibrary,
  componentLibraryFromTemplates,
  synchronizeSetComponentLibrary,
} from './componentSetLibrary';
import {
  isMediaPaint,
  mediaPaintAssetReferences,
  transitionLogicErrors,
  compositionPlayoutActionErrors,
  validatePresenterDefinition,
  validateAuthoringPrompts,
} from '@ograf-editor/scene-model';
import type {
  Asset,
  DesignSystem,
  FieldDefinition,
  FieldValue,
  Project,
  ComponentDefinition,
  TransitionLogicDefinition,
  PresenterDefinition,
} from '@ograf-editor/scene-model';
import { parseProjectSource } from './studioDocument';
import { applyFieldExposureOverrides, preserveFieldExposureEdits } from './fieldExposure';
import {
  applyTemplateSetSettings,
  templateSetSettingsErrors,
  templateSetSettingsFromProject,
  effectiveTemplateSetSettings,
  changedTemplateSetSettingKeys,
  TEMPLATE_SET_SETTING_KEYS,
  type TemplateSetSettingKey,
  type TemplateSetSettings,
} from './templateSetSettings';
import {
  resolveTemplateSetBrandKit,
  changedSharedBrandTokenIds,
  changedSharedStyleIds,
  enforceBackgroundMediaProfile,
  validateTemplateSetBrandKit,
} from './templateSetTheme';

export const PROJECT_SET_FORMAT = 'ograf-template-set';
export const PROJECT_SET_SCHEMA_VERSION = 6;
export const DEFAULT_PROJECT_SET_NAME = 'Untitled Template Set';
const MANIFEST_PATH = 'manifest.json';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_SET_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_TEMPLATE_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SET_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_PROJECT_SET_CONTENT_BYTES = 512 * 1024 * 1024;
const MAX_PROJECT_SET_TEMPLATES = 256;

export interface ProjectSetTemplate {
  id: string;
  name: string;
  project: Project;
  inheritSettings?: boolean;
  settingsOverrides?: TemplateSetSettingKey[];
  brandKitOverrides?: string[];
  typographyOverrides?: string[];
  backgroundOverrides?: string[];
  backgroundOverridden?: boolean;
}

export interface ProjectSetControlBinding {
  templateId: string;
  compositionId: string;
  fieldId: string;
  inherit: boolean;
}

/** One set-wide GDD control mapped onto compatible fields in one or more templates. */
export interface ProjectSetControl {
  field: FieldDefinition;
  value: FieldValue;
  bindings: ProjectSetControlBinding[];
}

export interface ProjectSetAssetBinding {
  id: string;
  templateId: string;
  compositionId: string;
  /** The child asset ID remains stable so all of its existing uses resolve normally. */
  templateAssetId: string;
  inherit: boolean;
}

/** A set-level asset slot can supply one shared asset to several template-local assets. */
export interface ProjectSetAssetSlot {
  id: string;
  key: string;
  label: string;
  kind: Asset['kind'];
  required: boolean;
  assetId: string | null;
  bindings: ProjectSetAssetBinding[];
}

export interface ProjectSetDocument {
  id: string;
  name: string;
  nameOrigin?: 'default' | 'custom';
  activeTemplateId?: string;
  templates: ProjectSetTemplate[];
  controls: ProjectSetControl[];
  assetSlots: ProjectSetAssetSlot[];
  assets: Asset[];
  /** Shared sources are stored once in compact archives and hydrated into ordinary child projects. */
  componentAssets?: ComponentDefinition[];
  settings?: TemplateSetSettings;
  brandKit?: DesignSystem;
  /** Optional coordinated playout definitions; omitted sets retain independent templates. */
  transitionLogic?: TransitionLogicDefinition;
  /** Optional editorial sequence; does not change the order of authored templates. */
  presenter?: PresenterDefinition;
}

export type ProjectSetSceneNodeKind =
  | 'set'
  | 'template'
  | 'composition'
  | 'layers'
  | 'layer'
  | 'component-assets'
  | 'component-asset'
  | 'component-source-layer'
  | 'component-instances'
  | 'component-instance'
  | 'assets'
  | 'asset'
  | 'asset-instance'
  | 'shared-assets'
  | 'asset-slot'
  | 'controls'
  | 'control'
  | 'data'
  | 'field'
  | 'media'
  | 'media-cue';

export interface ProjectSetSceneNode {
  id: string;
  kind: ProjectSetSceneNodeKind;
  label: string;
  templateId?: string;
  compositionId?: string;
  assetId?: string;
  componentId?: string;
  sourceLayerId?: string;
  /** Stable identity shared by the asset-owned instance and its scene/data cross-link. */
  instanceId?: string;
  /** Owning canvas/data/media item for an asset instance; used for selection and reveal. */
  targetId?: string;
  targetKind?: 'layer' | 'field' | 'media-cue' | 'font-use' | 'asset-binding' | 'component-layer';
  referencePath?: string;
  groupId?: string;
  inherited?: boolean;
  /** One-based position in the owning composition or source layer stack; higher is in front. */
  zOrder?: number;
  /** Authored visibility, or whether any layer in a component instance is visible. */
  isVisible?: boolean;
  children: ProjectSetSceneNode[];
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createProjectSet(name: string, project: Project): ProjectSetDocument {
  const template = { id: newId('template'), name: project.name, project: structuredClone(project) };
  const defaults = templateSetSettingsFromProject(project);
  return {
    id: newId('set'),
    name: name.trim() || DEFAULT_PROJECT_SET_NAME,
    nameOrigin: !name.trim() || name.trim() === DEFAULT_PROJECT_SET_NAME ? 'default' : 'custom',
    activeTemplateId: template.id,
    ...(project.presenter
      ? {
          presenter: {
            ...structuredClone(project.presenter),
            entries: project.presenter.entries.map((entry) => ({
              ...entry,
              templateId: entry.templateId === project.id ? template.id : entry.templateId,
            })),
          },
        }
      : {}),
    ...(templateSetSettingsErrors(defaults).length ? {} : { settings: defaults }),
    templates: [template],
    controls: [],
    assetSlots: [],
    assets: [],
  };
}

/** Upgrades older autosaves and set archives to the current in-memory contract. */
export function migrateProjectSetDocument(set: ProjectSetDocument): ProjectSetDocument {
  if (set.presenter !== undefined) validatePresenterDefinition(set.presenter);
  const templates = Array.isArray(set.templates) ? set.templates : [];
  const defaultName =
    set.nameOrigin === 'default' ||
    (set.nameOrigin === undefined &&
      (set.name === 'Untitled Template' || set.name === DEFAULT_PROJECT_SET_NAME));
  const activeTemplateId = templates.some((template) => template.id === set.activeTemplateId)
    ? set.activeTemplateId
    : templates[0]?.id;
  const library = componentLibraryFromTemplates({ ...set, templates });
  return {
    ...set,
    name: defaultName && set.name === 'Untitled Template' ? DEFAULT_PROJECT_SET_NAME : set.name,
    nameOrigin: set.nameOrigin ?? (defaultName ? 'default' : 'custom'),
    activeTemplateId,
    controls: (Array.isArray(set.controls) ? set.controls : []).map((control) => ({
      ...control,
      bindings: (Array.isArray(control.bindings) ? control.bindings : []).map((binding) => ({
        ...binding,
        inherit: typeof binding.inherit === 'boolean' ? binding.inherit : true,
      })),
    })),
    assetSlots: (Array.isArray(set.assetSlots) ? set.assetSlots : []).map((slot) => ({
      ...slot,
      required: slot.required ?? false,
      bindings: (Array.isArray(slot.bindings) ? slot.bindings : []).map((binding) => ({
        ...binding,
        id: binding.id || newId('assetinstance'),
        inherit: typeof binding.inherit === 'boolean' ? binding.inherit : true,
      })),
    })),
    assets: Array.isArray(set.assets) ? set.assets : [],
    ...(library.length ? { componentAssets: library } : {}),
  };
}

/** Set names belong to the container and do not rename any of its child templates. */
export function renameProjectSet(set: ProjectSetDocument, name: string): ProjectSetDocument {
  const nextName = name.trim().normalize('NFC');
  if (!nextName) throw new Error('Enter a template set name.');
  return nextName === set.name && set.nameOrigin === 'custom'
    ? set
    : { ...set, name: nextName, nameOrigin: 'custom' };
}

export function addProjectSetTemplate(
  set: ProjectSetDocument,
  project: Project,
  name = project.name,
  inheritSettings = true,
): ProjectSetDocument {
  return {
    ...set,
    templates: [
      ...set.templates,
      {
        id: newId('template'),
        name,
        inheritSettings,
        project: set.brandKit
          ? resolveTemplateSetBrandKit(
              set.settings && inheritSettings
                ? applyTemplateSetSettings(project, set.settings)
                : project,
              set.brandKit,
            )
          : set.settings && inheritSettings
            ? applyTemplateSetSettings(project, set.settings)
            : structuredClone(project),
      },
    ],
  };
}

/** Moves a template in the deck order without changing its stable identity or bindings. */
export function moveProjectSetTemplate(
  set: ProjectSetDocument,
  templateId: string,
  offset: -1 | 1,
): ProjectSetDocument {
  const index = set.templates.findIndex((template) => template.id === templateId);
  if (index < 0) throw new Error(`Template not found: ${templateId}`);
  const target = index + offset;
  if (target < 0 || target >= set.templates.length) return set;
  const templates = [...set.templates];
  [templates[index], templates[target]] = [templates[target]!, templates[index]!];
  return { ...set, templates };
}

/** Reorders templates relative to a stable target, including moves across several entries. */
export function reorderProjectSetTemplate(
  set: ProjectSetDocument,
  templateId: string,
  targetTemplateId: string,
  side: 'before' | 'after',
): ProjectSetDocument {
  const source = set.templates.find((template) => template.id === templateId);
  if (!source) throw new Error(`Template not found: ${templateId}`);
  if (!set.templates.some((template) => template.id === targetTemplateId))
    throw new Error(`Template not found: ${targetTemplateId}`);
  if (templateId === targetTemplateId) return set;
  const templates = set.templates.filter((template) => template.id !== templateId);
  const targetIndex = templates.findIndex((template) => template.id === targetTemplateId);
  templates.splice(targetIndex + (side === 'after' ? 1 : 0), 0, source);
  if (templates.every((template, index) => template === set.templates[index])) return set;
  return { ...set, templates };
}

/** Renames a child and its template label while keeping IDs and inherited bindings intact. */
export function renameProjectSetTemplate(
  set: ProjectSetDocument,
  templateId: string,
  name: string,
): ProjectSetDocument {
  const source = set.templates.find((template) => template.id === templateId);
  if (!source) throw new Error(`Template not found: ${templateId}`);
  const nextName = name.trim().normalize('NFC');
  if (!nextName) throw new Error('Enter a template name.');
  const comparison = nextName.toLowerCase();
  if (
    set.templates.some(
      (template) =>
        template.id !== templateId &&
        template.name.trim().normalize('NFC').toLowerCase() === comparison,
    )
  )
    throw new Error(`A template named “${nextName}” already exists in this set.`);
  if (source.name === nextName && source.project.name === nextName) return set;
  return {
    ...set,
    templates: set.templates.map((template) =>
      template.id === templateId
        ? { ...template, name: nextName, project: { ...template.project, name: nextName } }
        : template,
    ),
  };
}

export function removeProjectSetTemplate(
  set: ProjectSetDocument,
  templateId: string,
): ProjectSetDocument {
  if (!set.templates.some((template) => template.id === templateId))
    throw new Error(`Template not found: ${templateId}`);
  if (set.transitionLogic?.states.some((state) => state.templateId === templateId))
    throw new Error(
      'This template is used by playout transitions. Remove its transition states before removing the template.',
    );
  return {
    ...set,
    templates: set.templates.filter((template) => template.id !== templateId),
    activeTemplateId:
      set.activeTemplateId === templateId
        ? set.templates.find((template) => template.id !== templateId)?.id
        : set.activeTemplateId,
    controls: set.controls.map((control) => ({
      ...control,
      bindings: control.bindings.filter((binding) => binding.templateId !== templateId),
    })),
    assetSlots: set.assetSlots.map((slot) => ({
      ...slot,
      bindings: slot.bindings.filter((binding) => binding.templateId !== templateId),
    })),
  };
}

/** Changes set defaults atomically and bakes them only into templates that inherit. */
export function updateProjectSetSettings(
  set: ProjectSetDocument,
  settings: TemplateSetSettings,
  inheritance: Record<string, boolean> = {},
): ProjectSetDocument {
  const errors = templateSetSettingsErrors(settings);
  if (errors.length) throw new Error(errors.join(' '));
  for (const id of Object.keys(inheritance))
    if (!set.templates.some((template) => template.id === id))
      throw new Error(`Template not found: ${id}`);
  return {
    ...set,
    settings: structuredClone(settings),
    templates: set.templates.map((template) => {
      const inheritSettings = inheritance[template.id] ?? template.inheritSettings ?? true;
      const settingsOverrides =
        inheritance[template.id] === true && template.inheritSettings === false
          ? []
          : template.settingsOverrides;
      return {
        ...template,
        inheritSettings,
        settingsOverrides,
        project: inheritSettings
          ? applyTemplateSetSettings(
              template.project,
              effectiveTemplateSetSettings(template.project, settings, settingsOverrides),
            )
          : template.project,
      };
    }),
  };
}

/** Saves an edited child while keeping set-owned control and asset overrides outside its .ogs. */
export function saveProjectSetTemplateEdits(
  set: ProjectSetDocument,
  templateId: string,
  editedProject: Project,
): ProjectSetDocument {
  const source = set.templates.find((template) => template.id === templateId);
  if (!source) throw new Error(`Template not found: ${templateId}`);
  // Project replacement can arrive independently of set synchronization. A stale active row
  // must never adopt a different document merely because a snapshot or autosave was requested.
  if (source.project.id !== editedProject.id) return set;
  const before = resolveProjectSetTemplate(set, templateId);
  const settingsOverrides = [
    ...new Set([
      ...(source.settingsOverrides ?? []),
      ...(set.settings && source.inheritSettings !== false
        ? changedTemplateSetSettingKeys(before, editedProject)
        : []),
    ]),
  ];
  const brandKitOverrides = [
    ...new Set([
      ...(source.brandKitOverrides ?? []),
      ...(set.brandKit ? changedSharedBrandTokenIds(before, editedProject, set.brandKit) : []),
    ]),
  ];
  const typographyOverrides = [
    ...new Set([
      ...(source.typographyOverrides ?? []),
      ...(set.brandKit
        ? changedSharedStyleIds(before, editedProject, set.brandKit, 'typography')
        : []),
    ]),
  ];
  const backgroundOverrides = [
    ...new Set([
      ...(source.backgroundOverrides ?? []),
      ...(set.brandKit
        ? changedSharedStyleIds(before, editedProject, set.brandKit, 'backgrounds')
        : []),
    ]),
  ];
  const oldMain = before.compositions.find((item) => item.id === before.mainCompositionId)!;
  const newMain = editedProject.compositions.find(
    (item) => item.id === editedProject.mainCompositionId,
  )!;
  const backgroundOverridden = Boolean(
    source.backgroundOverridden ||
    oldMain.backgroundStyleId !== newMain.backgroundStyleId ||
    newMain.backgroundPaintOverridden === true ||
    (!newMain.backgroundStyleId &&
      JSON.stringify(oldMain.backgroundPaint) !== JSON.stringify(newMain.backgroundPaint)),
  );
  let project =
    set.settings && source.inheritSettings !== false
      ? applyTemplateSetSettings(
          editedProject,
          effectiveTemplateSetSettings(editedProject, set.settings, settingsOverrides),
        )
      : structuredClone(editedProject);
  if (set.brandKit)
    project = resolveTemplateSetBrandKit(project, set.brandKit, brandKitOverrides, {
      typography: typographyOverrides,
      backgrounds: backgroundOverrides,
      background: backgroundOverridden,
    });

  for (const control of set.controls) {
    for (const binding of control.bindings.filter(
      (item) => item.templateId === templateId && item.inherit,
    )) {
      const sourceComposition = source.project.compositions.find(
        (item) => item.id === binding.compositionId,
      );
      const sourceField = sourceComposition?.dataFields.find((item) => item.id === binding.fieldId);
      const composition = project.compositions.find((item) => item.id === binding.compositionId);
      if (!sourceField || !composition) continue;
      const index = composition.dataFields.findIndex((item) => item.id === binding.fieldId);
      if (index < 0) composition.dataFields.push(structuredClone(sourceField));
      else {
        const previousField = before.compositions
          .find((item) => item.id === binding.compositionId)
          ?.dataFields.find((item) => item.id === binding.fieldId);
        composition.dataFields[index] = preserveFieldExposureEdits(
          sourceField,
          previousField,
          composition.dataFields[index]!,
        );
      }
    }
  }

  for (const slot of set.assetSlots) {
    for (const binding of slot.bindings.filter(
      (item) => item.templateId === templateId && item.inherit,
    )) {
      const sourceComposition = source.project.compositions.find(
        (item) => item.id === binding.compositionId,
      );
      const sourceAsset = sourceComposition?.assets.find(
        (item) => item.id === binding.templateAssetId,
      );
      const composition = project.compositions.find((item) => item.id === binding.compositionId);
      if (!sourceAsset || !composition) continue;
      const index = composition.assets.findIndex((item) => item.id === binding.templateAssetId);
      if (index < 0) composition.assets.push(structuredClone(sourceAsset));
      else composition.assets[index] = structuredClone(sourceAsset);
    }
  }

  const updated = {
    ...set,
    templates: set.templates.map((template) =>
      template.id === templateId
        ? {
            ...template,
            name: source.project.name !== project.name ? project.name : template.name,
            project,
            settingsOverrides,
            brandKitOverrides,
            typographyOverrides,
            backgroundOverrides,
            backgroundOverridden,
          }
        : template,
    ),
  };
  return synchronizeSetComponentLibrary(updated, templateId, project, source.project);
}

function replaceAssetIds(value: FieldValue, replacements: Map<string, string>): FieldValue {
  if (typeof value === 'string' && value.startsWith('asset:'))
    return replacements.get(value.slice('asset:'.length)) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceAssetIds(item, replacements));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceAssetIds(item, replacements)]),
    ) as FieldValue;
  return value;
}

function assetSlotReferences(value: unknown): string[] {
  if (typeof value === 'string' && value.startsWith('asset-slot:'))
    return [value.slice('asset-slot:'.length)];
  if (Array.isArray(value)) return value.flatMap(assetSlotReferences);
  if (value && typeof value === 'object') return Object.values(value).flatMap(assetSlotReferences);
  return [];
}

function replaceAssetSlotIds(value: FieldValue, replacements: Map<string, string>): FieldValue {
  if (typeof value === 'string' && value.startsWith('asset-slot:')) {
    const assetId = replacements.get(value.slice('asset-slot:'.length));
    return assetId ? `asset:${assetId}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceAssetSlotIds(item, replacements));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceAssetSlotIds(item, replacements)]),
    ) as FieldValue;
  return value;
}

export function addProjectSetControl(
  set: ProjectSetDocument,
  templateId: string,
  compositionId: string,
  fieldId: string,
  sourceProject?: Project,
): ProjectSetDocument {
  const template = set.templates.find((item) => item.id === templateId);
  const contentProject = sourceProject ?? template?.project;
  const field = contentProject?.compositions
    .find((item) => item.id === compositionId)
    ?.dataFields.find((item) => item.id === fieldId);
  if (!field) throw new Error('Choose a field from a template in this set.');
  if (set.controls.some((item) => item.field.key === field.key))
    throw new Error(`A shared control with key "${field.key}" already exists.`);

  let nextSet = set;
  const referencedAssetIds = assetReferences(field.defaultValue, field.key).map(
    (item) => item.assetId,
  );
  if (referencedAssetIds.length && field.type !== 'image-url')
    throw new Error('Asset-backed shared controls currently require an image-url field.');
  const assetIds = [...new Set(referencedAssetIds)];
  const replacements = new Map<string, string>();
  for (const assetId of assetIds) {
    const existingSlot = nextSet.assetSlots.find((slot) =>
      slot.bindings.some(
        (binding) =>
          binding.templateId === templateId &&
          binding.compositionId === compositionId &&
          binding.templateAssetId === assetId,
      ),
    );
    if (existingSlot?.assetId) {
      replacements.set(assetId, `asset-slot:${existingSlot.id}`);
      continue;
    }
    const localAsset = contentProject?.compositions
      .find((item) => item.id === compositionId)
      ?.assets.find((item) => item.id === assetId);
    if (!localAsset) continue;
    if (existingSlot) {
      const sharedAsset = { ...structuredClone(localAsset), id: newId('setasset') };
      delete sharedAsset.packagePath;
      nextSet = setProjectSetAssetSlotSource(
        { ...nextSet, assets: [...nextSet.assets, sharedAsset] },
        existingSlot.id,
        sharedAsset.id,
      );
      replacements.set(assetId, `asset-slot:${existingSlot.id}`);
    } else {
      nextSet = addProjectSetAssetSlot(nextSet, templateId, compositionId, assetId, sourceProject);
      const createdSlot = nextSet.assetSlots.at(-1);
      if (createdSlot?.assetId) replacements.set(assetId, `asset-slot:${createdSlot.id}`);
    }
  }
  const controlId = newId('control');
  return {
    ...nextSet,
    controls: [
      ...nextSet.controls,
      {
        field: { ...structuredClone(field), id: controlId, defaultTokenId: null },
        value: replaceAssetIds(structuredClone(field.defaultValue), replacements),
        bindings: [{ templateId, compositionId, fieldId, inherit: true }],
      },
    ],
  };
}

export function setProjectSetControlValue(
  set: ProjectSetDocument,
  controlId: string,
  value: FieldValue,
): ProjectSetDocument {
  return {
    ...set,
    controls: set.controls.map((control) =>
      control.field.id === controlId ? { ...control, value: structuredClone(value) } : control,
    ),
  };
}

export function bindProjectSetControl(
  set: ProjectSetDocument,
  controlId: string,
  templateId: string,
  compositionId: string,
  fieldId: string | null,
): ProjectSetDocument {
  const control = set.controls.find((item) => item.field.id === controlId);
  if (!control) throw new Error(`Shared control not found: ${controlId}`);
  const controls = set.controls.map((item) =>
    item.field.id === controlId
      ? {
          ...item,
          bindings: item.bindings.filter((binding) => binding.templateId !== templateId),
        }
      : item,
  );
  if (!fieldId) return { ...set, controls };

  const template = set.templates.find((item) => item.id === templateId);
  const composition = template?.project.compositions.find((item) => item.id === compositionId);
  const target = composition?.dataFields.find((item) => item.id === fieldId);
  if (!target) throw new Error('Choose a valid field from the selected template.');
  if (target.type !== control.field.type)
    throw new Error('The shared control and selected field must have the same type.');
  for (const reference of assetReferences(control.value, control.field.key)) {
    if (!set.assets.some((asset) => asset.id === reference.assetId)) continue;
    const slot = set.assetSlots.find((item) => item.assetId === reference.assetId);
    if (
      !slot?.bindings.some(
        (item) => item.templateId === templateId && item.compositionId === compositionId,
      )
    )
      throw new Error('Link the shared asset slot to this template before binding the field.');
  }
  if (
    controls.some((item) =>
      item.bindings.some(
        (binding) =>
          binding.templateId === templateId &&
          binding.compositionId === compositionId &&
          binding.fieldId === fieldId,
      ),
    )
  )
    throw new Error('That field is already linked to another shared control.');
  for (const slotId of assetSlotReferences(control.value)) {
    const slot = set.assetSlots.find((item) => item.id === slotId);
    if (
      !slot?.bindings.some(
        (item) => item.templateId === templateId && item.compositionId === compositionId,
      )
    )
      throw new Error('Link the shared asset slot to this template before binding the field.');
  }
  return {
    ...set,
    controls: controls.map((item) =>
      item.field.id === controlId
        ? {
            ...item,
            bindings: [...item.bindings, { templateId, compositionId, fieldId, inherit: true }],
          }
        : item,
    ),
  };
}

export function setProjectSetControlBindingInherited(
  set: ProjectSetDocument,
  controlId: string,
  templateId: string,
  compositionId: string,
  fieldId: string,
  inherit: boolean,
): ProjectSetDocument {
  return {
    ...set,
    controls: set.controls.map((control) => ({
      ...control,
      bindings: control.bindings.map((binding) =>
        control.field.id === controlId &&
        binding.templateId === templateId &&
        binding.compositionId === compositionId &&
        binding.fieldId === fieldId
          ? { ...binding, inherit }
          : binding,
      ),
    })),
  };
}

export function removeProjectSetControl(
  set: ProjectSetDocument,
  controlId: string,
): ProjectSetDocument {
  return { ...set, controls: set.controls.filter((control) => control.field.id !== controlId) };
}

export function addProjectSetAssetSlot(
  set: ProjectSetDocument,
  templateId: string,
  compositionId: string,
  templateAssetId: string,
  sourceProject?: Project,
): ProjectSetDocument {
  const template = set.templates.find((item) => item.id === templateId);
  const asset = (sourceProject ?? template?.project)?.compositions
    .find((item) => item.id === compositionId)
    ?.assets.find((item) => item.id === templateAssetId);
  if (!asset) throw new Error('Choose an asset from a template in this set.');
  const slug =
    asset.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '') || 'shared.asset';
  let key = slug;
  let suffix = 2;
  while (set.assetSlots.some((slot) => slot.key === key)) key = `${slug}.${suffix++}`;

  const sharedAsset = { ...structuredClone(asset), id: newId('setasset') };
  delete sharedAsset.packagePath;
  const slotId = newId('slot');
  return {
    ...set,
    assets: [...set.assets, sharedAsset],
    assetSlots: [
      ...set.assetSlots,
      {
        id: slotId,
        key,
        label: asset.name,
        kind: asset.kind,
        required: false,
        assetId: sharedAsset.id,
        bindings: [
          {
            id: newId('assetinstance'),
            templateId,
            compositionId,
            templateAssetId,
            inherit: true,
          },
        ],
      },
    ],
  };
}

export function setProjectSetAssetSlotSource(
  set: ProjectSetDocument,
  slotId: string,
  assetId: string | null,
): ProjectSetDocument {
  const slot = set.assetSlots.find((item) => item.id === slotId);
  if (!slot) throw new Error(`Asset slot not found: ${slotId}`);
  const asset = assetId ? set.assets.find((item) => item.id === assetId) : null;
  if (assetId && !asset) throw new Error(`Set asset not found: ${assetId}`);
  if (asset && asset.kind !== slot.kind)
    throw new Error('The shared asset and slot must have the same asset kind.');
  return {
    ...set,
    assetSlots: set.assetSlots.map((item) => (item.id === slotId ? { ...item, assetId } : item)),
  };
}

export function bindProjectSetAsset(
  set: ProjectSetDocument,
  slotId: string,
  templateId: string,
  compositionId: string,
  templateAssetId: string | null,
): ProjectSetDocument {
  const slot = set.assetSlots.find((item) => item.id === slotId);
  if (!slot) throw new Error(`Asset slot not found: ${slotId}`);
  const slots = set.assetSlots.map((item) =>
    item.id === slotId
      ? {
          ...item,
          bindings: item.bindings.filter((binding) => binding.templateId !== templateId),
        }
      : item,
  );
  if (!templateAssetId) {
    const updated = { ...set, assetSlots: slots };
    validateSet(updated);
    return updated;
  }
  const template = set.templates.find((item) => item.id === templateId);
  const composition = template?.project.compositions.find((item) => item.id === compositionId);
  const target = composition?.assets.find((item) => item.id === templateAssetId);
  if (!target) throw new Error('Choose a valid asset from the selected template.');
  if (target.kind !== slot.kind)
    throw new Error('The template asset and shared asset slot must have the same kind.');
  if (
    slots.some((item) =>
      item.bindings.some(
        (binding) =>
          binding.templateId === templateId &&
          binding.compositionId === compositionId &&
          binding.templateAssetId === templateAssetId,
      ),
    )
  )
    throw new Error('That template asset is already linked to another shared slot.');
  const updated = {
    ...set,
    assetSlots: slots.map((item) =>
      item.id === slotId
        ? {
            ...item,
            bindings: [
              ...item.bindings,
              {
                id: newId('assetinstance'),
                templateId,
                compositionId,
                templateAssetId,
                inherit: true,
              },
            ],
          }
        : item,
    ),
  };
  validateSet(updated);
  return updated;
}

export function setProjectSetAssetBindingInherited(
  set: ProjectSetDocument,
  slotId: string,
  bindingId: string,
  inherit: boolean,
): ProjectSetDocument {
  return {
    ...set,
    assetSlots: set.assetSlots.map((slot) => ({
      ...slot,
      bindings: slot.bindings.map((binding) =>
        slot.id === slotId && binding.id === bindingId ? { ...binding, inherit } : binding,
      ),
    })),
  };
}

export function removeProjectSetAssetSlot(
  set: ProjectSetDocument,
  slotId: string,
): ProjectSetDocument {
  const slot = set.assetSlots.find((item) => item.id === slotId);
  if (!slot) throw new Error(`Asset slot not found: ${slotId}`);
  if (
    set.controls.some(
      (control) =>
        assetSlotReferences(control.value).includes(slotId) ||
        (slot.assetId &&
          assetReferences(control.value, control.field.key).some(
            (reference) => reference.assetId === slot.assetId,
          )),
    )
  )
    throw new Error('Change or remove shared controls that use this slot before removing it.');
  return { ...set, assetSlots: set.assetSlots.filter((slot) => slot.id !== slotId) };
}

function assetReferences(value: unknown, path: string): Array<{ assetId: string; path: string }> {
  if (typeof value === 'string' && value.startsWith('asset:'))
    return [{ assetId: value.slice('asset:'.length), path }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => assetReferences(item, `${path}[${index}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      assetReferences(item, path ? `${path}.${key}` : key),
    );
  return [];
}

function layerTree(
  layers: Project['compositions'][number]['layers'],
  scopeId: string,
  usesByLayerId: Map<string, ProjectSetSceneNode[]>,
  templateId: string,
  compositionId: string,
  compositionLayers: Project['compositions'][number]['layers'] = layers,
): ProjectSetSceneNode[] {
  const displayLayers = [...layers].reverse();
  const zOrderById = new Map(compositionLayers.map((layer, index) => [layer.id, index + 1]));
  const nodeById = new Map(
    displayLayers.map((layer) => [
      layer.id,
      {
        id: `${scopeId}/layer:${layer.id}`,
        kind: 'layer' as const,
        label: layer.name,
        templateId,
        compositionId,
        targetId: layer.id,
        targetKind: 'layer' as const,
        zOrder: zOrderById.get(layer.id),
        isVisible: layer.isVisible,
        ...(layer.groupId ? { groupId: layer.groupId } : {}),
        ...(layer.componentLink
          ? {
              componentId: layer.componentLink.componentId,
              instanceId: layer.componentLink.instanceId,
              sourceLayerId: layer.componentLink.sourceLayerId,
              inherited: !layer.componentLink.overridePaths?.length,
            }
          : {}),
        children: usesByLayerId.get(layer.id) ?? [],
      },
    ]),
  );
  const byId = new Map(displayLayers.map((layer) => [layer.id, layer]));
  const roots: ProjectSetSceneNode[] = [];

  const parentChainHasCycle = (startId: string): boolean => {
    const visited = new Set<string>();
    let currentId: string | null = startId;
    while (currentId) {
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      currentId = byId.get(currentId)?.parentId ?? null;
    }
    return false;
  };

  for (const layer of displayLayers) {
    const node = nodeById.get(layer.id)!;
    const parent = layer.parentId ? nodeById.get(layer.parentId) : undefined;
    if (parent && !parentChainHasCycle(layer.id)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function componentAssetTree(
  definition: ComponentDefinition,
  scope: string,
  owners: Array<{ template: ProjectSetTemplate; composition: Project['compositions'][number] }>,
  preferredTemplateId?: string,
): ProjectSetSceneNode {
  const canOwn = ({ composition }: (typeof owners)[number]) =>
    composition.components.some((component) => component.id === definition.id);
  const owner =
    owners.find((item) => item.template.id === preferredTemplateId && canOwn(item)) ??
    owners.find(canOwn);
  const id = `${scope}/component:${definition.id}`;
  const sourceById = new Map<string, ProjectSetSceneNode>();
  for (const [index, layer] of definition.layers.entries())
    sourceById.set(layer.id, {
      id: `${id}/source:${layer.id}`,
      kind: 'component-source-layer',
      label: layer.name,
      templateId: owner?.template.id,
      compositionId: owner?.composition.id,
      componentId: definition.id,
      sourceLayerId: layer.id,
      zOrder: index + 1,
      isVisible: layer.isVisible,
      children: [],
    });
  const sourceRoots: ProjectSetSceneNode[] = [];
  for (const layer of definition.layers) {
    const node = sourceById.get(layer.id)!;
    const parent =
      layer.parentId && layer.parentId !== layer.id ? sourceById.get(layer.parentId) : undefined;
    if (parent) parent.children.push(node);
    else sourceRoots.push(node);
  }
  const instances: ProjectSetSceneNode[] = [];
  for (const { template, composition } of owners) {
    const groups = new Map<string, typeof composition.layers>();
    for (const layer of composition.layers) {
      if (layer.componentLink?.componentId !== definition.id) continue;
      const instanceId = layer.componentLink.instanceId;
      groups.set(instanceId, [...(groups.get(instanceId) ?? []), layer]);
    }
    for (const [instanceId, layers] of groups) {
      const instanceNodeId = `${id}/template:${template.id}/composition:${composition.id}/instance:${instanceId}`;
      instances.push({
        id: instanceNodeId,
        kind: 'component-instance',
        label: `${template.name} · Instance ${instances.length + 1}`,
        templateId: template.id,
        compositionId: composition.id,
        componentId: definition.id,
        instanceId,
        targetId: layers[0]?.id,
        targetKind: 'layer',
        groupId: layers[0]?.groupId ?? undefined,
        isVisible: layers.some((layer) => layer.isVisible),
        children: layerTree(
          layers,
          instanceNodeId,
          new Map(),
          template.id,
          composition.id,
          composition.layers,
        ),
      });
    }
  }
  return {
    id,
    kind: 'component-asset',
    label: definition.name,
    componentId: definition.id,
    templateId: owner?.template.id,
    compositionId: owner?.composition.id,
    children: [
      {
        id: `${id}/source`,
        kind: 'layers',
        label: `Master layers (${definition.layers.length})`,
        componentId: definition.id,
        children: sourceRoots,
      },
      {
        id: `${id}/instances`,
        kind: 'component-instances',
        label: `Uses (${instances.length})`,
        componentId: definition.id,
        children: instances,
      },
    ],
  };
}

function templateSceneNode(template: ProjectSetTemplate): ProjectSetSceneNode {
  const templateNode: ProjectSetSceneNode = {
    id: `template:${template.id}`,
    kind: 'template',
    label: template.name,
    templateId: template.id,
    children: [],
  };

  for (const composition of template.project.compositions) {
    const assetNodes = new Map<string, ProjectSetSceneNode>();
    const missingAssetNodes = new Map<string, ProjectSetSceneNode>();
    const instanceLinksByOwner = new Map<string, ProjectSetSceneNode[]>();
    const layerInstanceLinks = new Map<string, ProjectSetSceneNode[]>();
    for (const asset of composition.assets) {
      assetNodes.set(asset.id, {
        id: `template:${template.id}/composition:${composition.id}/asset:${asset.id}`,
        kind: 'asset',
        label: asset.name,
        templateId: template.id,
        compositionId: composition.id,
        assetId: asset.id,
        children: [],
      });
    }

    const attachUse = (
      assetId: string,
      label: string,
      targetId: string,
      targetKind: NonNullable<ProjectSetSceneNode['targetKind']>,
      referencePath: string,
      componentId?: string,
    ) => {
      let assetNode = assetNodes.get(assetId);
      if (!assetNode) {
        assetNode = missingAssetNodes.get(assetId);
        if (!assetNode) {
          assetNode = {
            id: `template:${template.id}/composition:${composition.id}/missing-asset:${assetId}`,
            kind: 'asset',
            label: `Missing asset · ${assetId}`,
            templateId: template.id,
            compositionId: composition.id,
            assetId,
            children: [],
          };
          missingAssetNodes.set(assetId, assetNode);
        }
      }
      const instanceId = `${assetNode.id}/use:${encodeURIComponent(`${targetKind}/${componentId ? `${componentId}/` : ''}${targetId}/${referencePath}`)}`;
      const instanceNode: ProjectSetSceneNode = {
        id: instanceId,
        kind: 'asset-instance',
        label,
        templateId: template.id,
        compositionId: composition.id,
        assetId,
        instanceId,
        targetId,
        targetKind,
        referencePath,
        ...(componentId ? { componentId, sourceLayerId: targetId } : {}),
        children: [],
      };
      assetNode.children.push(instanceNode);
      const ownerKey = `${targetKind}/${targetId}`;
      const ownerLinks = instanceLinksByOwner.get(ownerKey) ?? [];
      ownerLinks.push({
        ...instanceNode,
        id: `${instanceId}/owner-link`,
        children: [],
      });
      instanceLinksByOwner.set(ownerKey, ownerLinks);
      if (targetKind === 'layer' || targetKind === 'font-use') {
        const layerLinks = layerInstanceLinks.get(targetId) ?? [];
        layerLinks.push({ ...instanceNode, id: `${instanceId}/scene-link`, children: [] });
        layerInstanceLinks.set(targetId, layerLinks);
      }
    };

    for (const layer of composition.layers) {
      for (const reference of assetReferences(layer.element, 'element')) {
        attachUse(
          reference.assetId,
          `${layer.name} · ${reference.path}`,
          layer.id,
          'layer',
          reference.path,
        );
      }
      if (layer.element.type === 'text') {
        const families = layer.element.fontFamily
          .split(',')
          .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'));
        for (const asset of composition.assets) {
          if (asset.kind === 'font' && asset.fontFamily && families.includes(asset.fontFamily))
            attachUse(asset.id, `${layer.name} · fontFamily`, layer.id, 'font-use', 'fontFamily');
        }
      }
    }

    for (const definition of composition.components) {
      for (const layer of definition.layers) {
        for (const reference of assetReferences(layer.element, 'element'))
          attachUse(
            reference.assetId,
            `${definition.name} · ${layer.name}`,
            layer.id,
            'component-layer',
            reference.path,
            definition.id,
          );
        if (layer.element.type === 'text') {
          const families = layer.element.fontFamily
            .split(',')
            .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'));
          for (const asset of composition.assets)
            if (asset.kind === 'font' && asset.fontFamily && families.includes(asset.fontFamily))
              attachUse(
                asset.id,
                `${definition.name} · ${layer.name} · Font`,
                layer.id,
                'component-layer',
                'fontFamily',
                definition.id,
              );
        }
      }
    }

    for (const field of composition.dataFields) {
      for (const reference of assetReferences(field.defaultValue, 'defaultValue')) {
        attachUse(
          reference.assetId,
          `${field.label} · ${reference.path}`,
          field.id,
          'field',
          reference.path,
        );
      }
    }

    for (const cue of composition.mediaCues ?? []) {
      for (const reference of assetReferences(cue.sources, 'sources')) {
        attachUse(
          reference.assetId,
          `${cue.name} · ${reference.path}`,
          cue.id,
          'media-cue',
          reference.path,
        );
      }
    }

    templateNode.children.push({
      id: `template:${template.id}/composition:${composition.id}`,
      kind: 'composition',
      label: composition.name,
      templateId: template.id,
      compositionId: composition.id,
      children: [
        {
          id: `template:${template.id}/composition:${composition.id}/components`,
          kind: 'component-assets',
          label: 'Components',
          templateId: template.id,
          compositionId: composition.id,
          children: composition.components
            .filter((definition) => definition.scope !== 'set')
            .map((definition) =>
              componentAssetTree(
                definition,
                `template:${template.id}/composition:${composition.id}`,
                [{ template, composition }],
              ),
            ),
        },
        {
          id: `template:${template.id}/composition:${composition.id}/layers`,
          kind: 'layers',
          label: 'Scene',
          templateId: template.id,
          compositionId: composition.id,
          children: layerTree(
            composition.layers,
            `template:${template.id}/composition:${composition.id}`,
            layerInstanceLinks,
            template.id,
            composition.id,
          ),
        },
        {
          id: `template:${template.id}/composition:${composition.id}/data`,
          kind: 'data',
          label: 'Data Fields',
          templateId: template.id,
          compositionId: composition.id,
          children: composition.dataFields.map((field) => ({
            id: `template:${template.id}/composition:${composition.id}/field:${field.id}`,
            kind: 'field',
            label: field.label,
            templateId: template.id,
            compositionId: composition.id,
            targetId: field.id,
            targetKind: 'field',
            children: instanceLinksByOwner.get(`field/${field.id}`) ?? [],
          })),
        },
        {
          id: `template:${template.id}/composition:${composition.id}/media`,
          kind: 'media',
          label: 'Media Cues',
          templateId: template.id,
          compositionId: composition.id,
          children: (composition.mediaCues ?? []).map((cue) => ({
            id: `template:${template.id}/composition:${composition.id}/media-cue:${cue.id}`,
            kind: 'media-cue',
            label: cue.name,
            templateId: template.id,
            compositionId: composition.id,
            targetId: cue.id,
            targetKind: 'media-cue',
            children: instanceLinksByOwner.get(`media-cue/${cue.id}`) ?? [],
          })),
        },
        {
          id: `template:${template.id}/composition:${composition.id}/assets`,
          kind: 'assets',
          label: 'Assets',
          templateId: template.id,
          compositionId: composition.id,
          children: [...assetNodes.values(), ...missingAssetNodes.values()],
        },
      ],
    });
  }

  return templateNode;
}

/** Creates the navigator tree, keeping asset definitions separate from their concrete uses. */
export function buildProjectSetSceneTree(set: ProjectSetDocument): ProjectSetSceneNode {
  const sharedAssetNodes = new Map<string, ProjectSetSceneNode>();
  const unassignedSlots: ProjectSetSceneNode[] = [];
  for (const asset of set.assets) {
    sharedAssetNodes.set(asset.id, {
      id: `set:${set.id}/asset:${asset.id}`,
      kind: 'asset',
      label: asset.name,
      assetId: asset.id,
      children: [],
    });
  }

  for (const slot of set.assetSlots) {
    const assetNode = slot.assetId ? sharedAssetNodes.get(slot.assetId) : undefined;
    const slotNode: ProjectSetSceneNode = {
      id: `set:${set.id}/slot:${slot.id}`,
      kind: 'asset-slot',
      label: slot.label,
      assetId: slot.assetId ?? undefined,
      children: [],
    };
    for (const binding of slot.bindings) {
      const template = set.templates.find((item) => item.id === binding.templateId);
      const composition = template?.project.compositions.find(
        (item) => item.id === binding.compositionId,
      );
      const localAsset = composition?.assets.find((item) => item.id === binding.templateAssetId);
      slotNode.children.push({
        id: `set:${set.id}/slot:${slot.id}/binding:${binding.id}`,
        kind: 'asset-instance',
        label: `${template?.name ?? binding.templateId} · ${localAsset?.name ?? binding.templateAssetId}`,
        templateId: binding.templateId,
        compositionId: binding.compositionId,
        assetId: slot.assetId ?? undefined,
        instanceId: binding.id,
        targetId: binding.templateAssetId,
        targetKind: 'asset-binding',
        referencePath: slot.key,
        inherited: binding.inherit,
        children: [],
      });
    }
    if (assetNode) assetNode.children.push(slotNode);
    else unassignedSlots.push(slotNode);
  }

  const templates = set.templates.map(templateSceneNode);
  const componentOwners = set.templates.flatMap((template) =>
    template.project.compositions.map((composition) => ({ template, composition })),
  );
  const componentAssetsNode: ProjectSetSceneNode = {
    id: `set:${set.id}/components`,
    kind: 'component-assets',
    label: 'Components',
    children: componentLibraryFromTemplates(set).map((definition) =>
      componentAssetTree(definition, `set:${set.id}`, componentOwners, set.activeTemplateId),
    ),
  };
  const controlsNode: ProjectSetSceneNode = {
    id: `set:${set.id}/controls`,
    kind: 'controls',
    label: 'Shared Controls',
    children: set.controls.map((control) => ({
      id: `set:${set.id}/control:${control.field.id}`,
      kind: 'control',
      label: control.field.label,
      children: control.bindings.map((binding) => {
        const template = set.templates.find((item) => item.id === binding.templateId);
        const composition = template?.project.compositions.find(
          (item) => item.id === binding.compositionId,
        );
        const field = composition?.dataFields.find((item) => item.id === binding.fieldId);
        return {
          id: `set:${set.id}/control:${control.field.id}/binding:${binding.templateId}:${binding.compositionId}:${binding.fieldId}`,
          kind: 'control' as const,
          label: `${template?.name ?? binding.templateId} · ${field?.label ?? binding.fieldId}`,
          templateId: binding.templateId,
          compositionId: binding.compositionId,
          targetId: binding.fieldId,
          targetKind: 'field' as const,
          inherited: binding.inherit,
          children: [],
        };
      }),
    })),
  };
  const setAssets: ProjectSetSceneNode = {
    id: `set:${set.id}/assets`,
    kind: 'shared-assets',
    label: 'Set Assets',
    children: [...sharedAssetNodes.values(), ...unassignedSlots],
  };
  return {
    id: `set:${set.id}`,
    kind: 'set',
    label: set.name,
    children: [...templates, componentAssetsNode, controlsNode, setAssets],
  };
}

interface ProjectSetArchiveManifest {
  format: typeof PROJECT_SET_FORMAT;
  schemaVersion: number;
  id: string;
  name: string;
  nameOrigin?: 'default' | 'custom';
  activeTemplateId?: string;
  settings?: TemplateSetSettings;
  brandKit?: DesignSystem;
  transitionLogic?: TransitionLogicDefinition;
  presenter?: PresenterDefinition;
  resources?: SetResourceRecord[];
  resourceRefs?: SetResourceReference[];
  sharedComponents?: SharedComponentRecord;
  templates: Array<{
    id: string;
    name: string;
    source: string;
    projectId: string;
    sha256: string;
    inheritSettings?: boolean;
    settingsOverrides?: TemplateSetSettingKey[];
    brandKitOverrides?: string[];
    typographyOverrides?: string[];
    backgroundOverrides?: string[];
    backgroundOverridden?: boolean;
    sharedAssets?: Array<{ compositionId: string; assetId: string; setAssetId: string }>;
    resourceRefs?: SetResourceReference[];
    componentRefs?: SetComponentReference[];
  }>;
  controls: ProjectSetControl[];
  assetSlots: ProjectSetAssetSlot[];
  assets: Array<Omit<Asset, 'dataUri'> & { path: string; sha256: string }>;
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function templateSourcePath(templateId: string): string {
  return `templates/${templateId}.ogs`;
}

function assetDataPath(sha256: string): string {
  return `assets/${sha256}.bin`;
}

function archiveFile(zip: JSZip, path: string): JSZip.JSZipObject {
  const file = zip.file(path);
  if (!file || file.dir) throw new Error(`Template-set archive is missing ${path}.`);
  if (file.unsafeOriginalName && file.unsafeOriginalName !== path)
    throw new Error(`Template-set archive contains an unsafe entry for ${path}.`);
  return file;
}

/** Reject advertised ZIP bombs before inflation, and verify the actual inflated byte count. */
async function boundedArchiveBytes(zip: JSZip, path: string, limit: number): Promise<Uint8Array> {
  const file = archiveFile(zip, path);
  const advertised = (file as JSZip.JSZipObject & { _data?: { uncompressedSize?: unknown } })._data
    ?.uncompressedSize;
  if (
    typeof advertised !== 'number' ||
    !Number.isSafeInteger(advertised) ||
    advertised < 0 ||
    advertised > limit
  )
    throw new Error(`Template-set entry exceeds its size limit: ${path}.`);
  const bytes = await file.async('uint8array');
  if (bytes.byteLength !== advertised || bytes.byteLength > limit)
    throw new Error(`Template-set entry has an invalid byte count: ${path}.`);
  return bytes;
}

function archiveJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
}

function templateSource(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUri);
  if (!match) throw new Error('Template-set assets must use embedded data URIs.');
  const payload = match[3] ?? '';
  if (match[2]) {
    const binary = atob(payload);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', ownedBytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateSet(set: ProjectSetDocument): void {
  if (set.presenter !== undefined) validatePresenterDefinition(set.presenter);
  if (set.settings !== undefined) {
    const errors = templateSetSettingsErrors(set.settings);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (set.brandKit !== undefined) {
    const errors = validateTemplateSetBrandKit(set.brandKit);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (!safeId(set.id)) throw new Error('Template-set ID is invalid.');
  if (!set.name.trim()) throw new Error('Template-set name is required.');
  if (set.nameOrigin !== undefined && set.nameOrigin !== 'default' && set.nameOrigin !== 'custom')
    throw new Error('Template-set name origin is invalid.');
  if (set.templates.length > MAX_PROJECT_SET_TEMPLATES)
    throw new Error(`A template set can contain at most ${MAX_PROJECT_SET_TEMPLATES} templates.`);

  const templateById = new Map<string, ProjectSetTemplate>();
  for (const template of set.templates) {
    if (!safeId(template.id)) throw new Error(`Template ID is invalid: ${template.id}`);
    if (templateById.has(template.id)) throw new Error(`Duplicate template ID: ${template.id}`);
    if (!template.name.trim()) throw new Error(`Template ${template.id} needs a name.`);
    if (template.inheritSettings !== undefined && typeof template.inheritSettings !== 'boolean')
      throw new Error(`Template ${template.name} has invalid settings inheritance.`);
    for (const [keys, allowed, label] of [
      [template.settingsOverrides, TEMPLATE_SET_SETTING_KEYS, 'settings'],
      [
        template.brandKitOverrides,
        set.brandKit?.tokens.map((token) => token.id) ?? [],
        'Brand Kit',
      ],
      [
        template.typographyOverrides,
        set.brandKit?.typography?.map((style) => style.id) ?? [],
        'typography',
      ],
      [
        template.backgroundOverrides,
        set.brandKit?.backgrounds?.map((style) => style.id) ?? [],
        'background style',
      ],
    ] as const) {
      if (
        keys !== undefined &&
        (!Array.isArray(keys) ||
          keys.length > allowed.length ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => !(allowed as readonly string[]).includes(key)))
      )
        throw new Error(`Template ${template.name} has invalid ${label} overrides.`);
    }
    if (
      template.backgroundOverridden !== undefined &&
      typeof template.backgroundOverridden !== 'boolean'
    )
      throw new Error('Invalid background inheritance.');
    templateById.set(template.id, template);
  }
  if (set.activeTemplateId && !templateById.has(set.activeTemplateId))
    throw new Error('The active template is missing from this template set.');
  if (set.transitionLogic !== undefined) {
    if (set.templates.length === 0)
      throw new Error('Insert a template before saving a set with playout transitions.');
    const errors = transitionLogicErrors(set.transitionLogic, {
      templateIds: [...templateById.keys()],
      componentLayers: Object.fromEntries(
        componentLibraryFromTemplates(set).map((component) => [
          component.id,
          component.layers.map((layer) => layer.id),
        ]),
      ),
    });
    if (errors.length) throw new Error(errors.join(' '));
  }

  for (const template of set.templates) {
    for (const composition of template.project.compositions) {
      const errors = compositionPlayoutActionErrors(composition, set.transitionLogic);
      if (errors.length) throw new Error(`Template "${template.name}": ${errors.join(' ')}`);
    }
  }

  const assetById = new Map(set.assets.map((asset) => [asset.id, asset]));
  if (assetById.size !== set.assets.length) throw new Error('Duplicate set-level asset ID.');
  for (const asset of set.assets) {
    if (!safeId(asset.id)) throw new Error(`Set-level asset ID is invalid: ${asset.id}`);
    dataUriToBytes(asset.dataUri);
  }

  const controlIds = new Set<string>();
  const controlKeys = new Set<string>();
  const boundFields = new Set<string>();
  for (const control of set.controls) {
    const field = control.field;
    if (!safeId(field.id) || controlIds.has(field.id))
      throw new Error(`Invalid or duplicate shared-control ID: ${field.id}`);
    if (!field.key.trim() || controlKeys.has(field.key))
      throw new Error(`Invalid or duplicate shared-control key: ${field.key}`);
    controlIds.add(field.id);
    controlKeys.add(field.key);
    if (field.type !== 'image-url' && assetSlotReferences(control.value).length)
      throw new Error(
        `Only image-url shared controls can reference shared asset slots (${field.key}).`,
      );
    const targets = new Set<string>();
    for (const binding of control.bindings) {
      if (typeof binding.inherit !== 'boolean')
        throw new Error(`Control ${field.key} is missing its inheritance setting.`);
      const template = templateById.get(binding.templateId);
      if (!template) throw new Error(`Control ${field.key} targets an unknown template.`);
      const composition = template.project.compositions.find(
        (item) => item.id === binding.compositionId,
      );
      const target = composition?.dataFields.find((item) => item.id === binding.fieldId);
      if (!target) throw new Error(`Control ${field.key} targets an unknown template field.`);
      if (target.type !== field.type)
        throw new Error(`Control ${field.key} has an incompatible field type in ${template.name}.`);
      if (composition!.dataFields.some((item) => item.id !== target.id && item.key === field.key))
        throw new Error(`Control ${field.key} duplicates a field key in ${template.name}.`);
      if (!binding.inherit) continue;
      for (const reference of assetReferences(control.value, field.key)) {
        if (!assetById.has(reference.assetId)) continue;
        if (field.type !== 'image-url')
          throw new Error(
            `Only image-url shared controls can reference set assets (${field.key}).`,
          );
        const slot = set.assetSlots.find((item) => item.assetId === reference.assetId);
        if (
          !slot?.bindings.some(
            (item) =>
              item.templateId === binding.templateId &&
              item.compositionId === binding.compositionId,
          )
        )
          throw new Error(
            `Control ${field.key} uses a shared asset that is not linked to ${template.name}.`,
          );
      }
      for (const slotId of assetSlotReferences(control.value)) {
        const slot = set.assetSlots.find((item) => item.id === slotId);
        if (!slot) throw new Error(`Control ${field.key} refers to an unknown shared asset slot.`);
        if (
          !slot.bindings.some(
            (item) =>
              item.templateId === binding.templateId &&
              item.compositionId === binding.compositionId,
          )
        )
          throw new Error(
            `Control ${field.key} uses an asset slot that is not linked to ${template.name}.`,
          );
      }
      const targetKey = `${binding.templateId}/${binding.compositionId}/${binding.fieldId}`;
      if (targets.has(targetKey) || boundFields.has(targetKey))
        throw new Error(`A template field is bound more than once: ${targetKey}`);
      targets.add(targetKey);
      boundFields.add(targetKey);
    }
  }

  const slotIds = new Set<string>();
  const slotKeys = new Set<string>();
  const assetBindingIds = new Set<string>();
  const boundAssets = new Set<string>();
  for (const slot of set.assetSlots) {
    if (!safeId(slot.id) || slotIds.has(slot.id))
      throw new Error(`Invalid or duplicate asset-slot ID: ${slot.id}`);
    if (!slot.key.trim() || slotKeys.has(slot.key))
      throw new Error(`Invalid or duplicate asset-slot key: ${slot.key}`);
    slotIds.add(slot.id);
    slotKeys.add(slot.key);
    if (slot.assetId && !assetById.has(slot.assetId))
      throw new Error(`Asset slot ${slot.key} refers to an unknown set asset.`);
    if (slot.assetId && assetById.get(slot.assetId)?.kind !== slot.kind)
      throw new Error(`Asset slot ${slot.key} has an incompatible set asset.`);
    for (const binding of slot.bindings) {
      if (typeof binding.inherit !== 'boolean')
        throw new Error(`Asset slot ${slot.key} is missing an inheritance setting.`);
      if (!safeId(binding.id) || assetBindingIds.has(binding.id))
        throw new Error(`Invalid or duplicate set asset-instance ID: ${binding.id}`);
      assetBindingIds.add(binding.id);
      const template = templateById.get(binding.templateId);
      if (!template) throw new Error(`Asset slot ${slot.key} targets an unknown template.`);
      const composition = template.project.compositions.find(
        (item) => item.id === binding.compositionId,
      );
      const target = composition?.assets.find((item) => item.id === binding.templateAssetId);
      if (!target) throw new Error(`Asset slot ${slot.key} targets an unknown template asset.`);
      if (target.kind !== slot.kind)
        throw new Error(`Asset slot ${slot.key} has an incompatible template asset.`);
      const targetKey = `${binding.templateId}/${binding.compositionId}/${binding.templateAssetId}`;
      if (boundAssets.has(targetKey))
        throw new Error(`A template asset is bound more than once: ${targetKey}`);
      boundAssets.add(targetKey);
    }
    if (slot.required && !slot.assetId && !slot.bindings.length)
      throw new Error(`Required asset slot ${slot.key} has no asset or template binding.`);
  }
}

export function validateProjectSetDocument(set: ProjectSetDocument): void {
  validateSet(set);
}

function resolveControlAssetReferences(
  value: FieldValue,
  set: ProjectSetDocument,
  templateId: string,
  compositionId: string,
): FieldValue {
  const slotReplacements = new Map<string, string>();
  for (const slotId of assetSlotReferences(value)) {
    const slot = set.assetSlots.find((item) => item.id === slotId);
    const binding = slot?.bindings.find(
      (item) => item.templateId === templateId && item.compositionId === compositionId,
    );
    if (!binding)
      throw new Error(`Shared asset slot ${slotId} is not mapped to the selected template.`);
    slotReplacements.set(slotId, binding.templateAssetId);
  }
  const slotResolvedValue = replaceAssetSlotIds(value, slotReplacements);
  const setAssetIds = new Set(set.assets.map((asset) => asset.id));
  const replacements = new Map<string, string>();
  for (const reference of assetReferences(slotResolvedValue, 'value')) {
    if (!setAssetIds.has(reference.assetId)) continue;
    const slot = set.assetSlots.find((item) => item.assetId === reference.assetId);
    const binding = slot?.bindings.find(
      (item) => item.templateId === templateId && item.compositionId === compositionId,
    );
    if (!binding)
      throw new Error(`Shared asset ${reference.assetId} is not mapped to the selected template.`);
    replacements.set(reference.assetId, binding.templateAssetId);
  }
  return replaceAssetIds(slotResolvedValue, replacements);
}

/** Applies set-level control values and asset-slot values to a fresh child-project copy. */
export function resolveProjectSetTemplate(set: ProjectSetDocument, templateId: string): Project {
  validateSet(set);
  const template = set.templates.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);
  let project =
    set.settings && template.inheritSettings !== false
      ? applyTemplateSetSettings(
          template.project,
          effectiveTemplateSetSettings(template.project, set.settings, template.settingsOverrides),
        )
      : structuredClone(template.project);
  if (set.brandKit)
    project = resolveTemplateSetBrandKit(project, set.brandKit, template.brandKitOverrides, {
      typography: template.typographyOverrides,
      backgrounds: template.backgroundOverrides,
      background: template.backgroundOverridden,
    });
  // Font files referenced by the master palette/type tokens travel with every child.
  for (const composition of project.compositions) {
    for (const font of set.assets.filter(
      (asset) =>
        asset.kind === 'font' &&
        (set.brandKit?.tokens.some(
          (token) =>
            token.type === 'font-family' &&
            String(token.value)
              .split(',')
              .some((family) => family.trim().replace(/^['"]|['"]$/g, '') === asset.fontFamily),
        ) ||
          set.brandKit?.typography?.some((style) =>
            style.properties.fontFamily
              .split(',')
              .some((family) => family.trim().replace(/^['"]|['"]$/g, '') === asset.fontFamily),
          )),
    )) {
      const id = `setfont-${font.id}`;
      const local = composition.assets.find((asset) => asset.id === id);
      const embedded = { ...structuredClone(font), id };
      if (local) Object.assign(local, embedded);
      else composition.assets.push(embedded);
    }
  }

  const backgroundAssetIds = new Set(
    (set.brandKit?.backgrounds ?? []).flatMap((style) =>
      isMediaPaint(style.paint)
        ? mediaPaintAssetReferences(style.paint)
            .filter((ref) => ref.startsWith('asset:'))
            .map((ref) => ref.slice(6))
        : [],
    ),
  );
  for (const composition of project.compositions)
    for (const asset of set.assets.filter((item) => backgroundAssetIds.has(item.id))) {
      const local = composition.assets.find((item) => item.id === asset.id);
      if (local && local.dataUri !== asset.dataUri)
        throw new Error('A shared background asset conflicts with a local asset.');
      if (!local) composition.assets.push(structuredClone(asset));
    }
  enforceBackgroundMediaProfile(project);
  if (set.settings && template.inheritSettings !== false)
    project = applyTemplateSetSettings(
      project,
      effectiveTemplateSetSettings(project, set.settings, template.settingsOverrides),
    );
  for (const control of set.controls) {
    for (const binding of control.bindings.filter(
      (item) => item.templateId === templateId && item.inherit,
    )) {
      const composition = project.compositions.find((item) => item.id === binding.compositionId)!;
      const index = composition.dataFields.findIndex((item) => item.id === binding.fieldId);
      const target = composition.dataFields[index]!;
      composition.dataFields[index] = {
        ...applyFieldExposureOverrides(control.field, target),
        id: target.id,
        defaultTokenId: null,
        generatedShaderParameter: target.generatedShaderParameter,
        defaultValue: resolveControlAssetReferences(
          control.value,
          set,
          templateId,
          binding.compositionId,
        ),
      };
    }
  }

  const assetsById = new Map(set.assets.map((asset) => [asset.id, asset]));
  for (const slot of set.assetSlots) {
    if (!slot.assetId) continue;
    const sharedAsset = assetsById.get(slot.assetId)!;
    for (const binding of slot.bindings.filter(
      (item) => item.templateId === templateId && item.inherit,
    )) {
      const composition = project.compositions.find((item) => item.id === binding.compositionId)!;
      const index = composition.assets.findIndex((item) => item.id === binding.templateAssetId);
      const localAsset = composition.assets[index]!;
      composition.assets[index] = {
        ...localAsset,
        name: localAsset.name,
        kind: sharedAsset.kind,
        dataUri: sharedAsset.dataUri,
        mimeType: sharedAsset.mimeType,
        originalFileName: sharedAsset.originalFileName,
        byteSize: sharedAsset.byteSize,
        durationMs: sharedAsset.durationMs,
        fontFamily: sharedAsset.fontFamily,
        fontWeight: sharedAsset.fontWeight,
        fontStyle: sharedAsset.fontStyle,
        licenseName: sharedAsset.licenseName,
        licenseUrl: sharedAsset.licenseUrl,
        licenseText: sharedAsset.licenseText,
      };
      delete composition.assets[index]!.packagePath;
    }
  }

  return applySetComponentLibrary(project, componentLibraryFromTemplates(set));
}

/** Builds a portable set ZIP; compact storage is hydrated when opened or exported alone. */
export interface ProjectSetArchiveProgress {
  phase: 'validating' | 'templates' | 'resources' | 'compressing' | 'complete';
  percent: number;
  message: string;
}

export async function createProjectSetArchive(
  set: ProjectSetDocument,
  options: {
    legacyFormat?: boolean;
    archiveMode?: 'compact' | 'compatible';
    onProgress?: (progress: ProjectSetArchiveProgress) => void;
  } = {},
): Promise<Blob> {
  let lastProgress = '';
  const progress = (
    phase: ProjectSetArchiveProgress['phase'],
    percent: number,
    message: string,
  ) => {
    const signature = `${phase}/${Math.floor(percent)}/${message}`;
    if (signature === lastProgress) return;
    lastProgress = signature;
    options.onProgress?.({ phase, percent, message });
  };
  progress('validating', 0, 'Checking the template set…');
  if (options.archiveMode !== undefined && !['compact', 'compatible'].includes(options.archiveMode))
    throw new Error('Invalid template-set archive mode.');
  const compactMode = !options.legacyFormat && options.archiveMode !== 'compatible';
  if (options.legacyFormat && set.presenter !== undefined)
    throw new Error(
      'Legacy .ogp export does not preserve Presenter settings. Save as .ogs instead.',
    );
  if (options.legacyFormat && set.transitionLogic !== undefined)
    throw new Error(
      'Legacy .ogp export does not support playout transitions. Save the template set as .ogs to retain its coordinated playout definitions.',
    );
  validateSet(set);
  const zip = new JSZip();
  const resourcePool = new SetResourcePool();
  const archiveAssets = new Map<string, Uint8Array>();
  // Shared-scene assets need to survive even when no template has placed an instance yet.
  // Keep their source and resources in the existing, bounded child-project payloads.
  const componentLibrary = componentLibraryFromTemplates(set).map((component) => ({
    ...component,
    scope: 'set' as const,
  }));
  if (!compactMode && !set.templates.length && componentLibrary.length)
    throw new Error(
      'Compatible and legacy archives need at least one template to retain shared components. Add a template or save the compact .ogs format.',
    );
  if (
    compactMode &&
    (componentLibrary.length > 4096 ||
      new Set((set.componentAssets ?? []).map((definition) => definition.id)).size !==
        (set.componentAssets ?? []).length)
  )
    throw new Error('Shared component library count or identities are invalid.');
  const manifest: ProjectSetArchiveManifest = {
    format: PROJECT_SET_FORMAT,
    schemaVersion: options.legacyFormat ? 4 : compactMode ? PROJECT_SET_SCHEMA_VERSION : 5,
    id: set.id,
    name: set.name,
    ...(set.nameOrigin ? { nameOrigin: set.nameOrigin } : {}),
    ...(set.activeTemplateId ? { activeTemplateId: set.activeTemplateId } : {}),
    ...(set.settings ? { settings: structuredClone(set.settings) } : {}),
    ...(set.brandKit ? { brandKit: structuredClone(set.brandKit) } : {}),
    ...(set.transitionLogic !== undefined
      ? { transitionLogic: structuredClone(set.transitionLogic) }
      : {}),
    ...(set.presenter !== undefined ? { presenter: structuredClone(set.presenter) } : {}),
    templates: [],
    controls: structuredClone(set.controls),
    assetSlots: structuredClone(set.assetSlots),
    assets: [],
  };

  for (const template of set.templates) {
    progress(
      'templates',
      5 + (manifest.templates.length / Math.max(1, set.templates.length)) * 55,
      `Preparing template ${manifest.templates.length + 1} of ${set.templates.length}: ${template.name}`,
    );
    // Set archives store promoted clip/font bytes once; standalone saves still embed them.
    const compact = compactMode
      ? structuredClone(template.project)
      : structuredClone(applySetComponentLibrary(template.project, componentLibrary));
    const componentRefs = compactMode ? extractSetComponents(compact, componentLibrary) : [];
    const sharedAssets: NonNullable<
      ProjectSetArchiveManifest['templates'][number]['sharedAssets']
    > = [];
    if (!compactMode)
      for (const composition of compact.compositions)
        for (const asset of composition.assets) {
          const shared = set.assets.find(
            (item) =>
              item.kind === asset.kind &&
              item.mimeType === asset.mimeType &&
              item.dataUri === asset.dataUri,
          );
          if (!shared) continue;
          sharedAssets.push({
            compositionId: composition.id,
            assetId: asset.id,
            setAssetId: shared.id,
          });
          asset.dataUri = '';
        }
    // Keep prompts inline even when their literal text looks like an embedded resource URI.
    const { authoringPrompts, ...resourceSource } = compact;
    const resourceRefs = compactMode ? await extractSetResources(resourceSource, resourcePool) : [];
    if (authoringPrompts !== undefined) Object.assign(resourceSource, { authoringPrompts });
    const source = templateSource(
      compactMode && (componentRefs.length || resourceRefs.length)
        ? Object.assign(resourceSource, {
            archiveFragment: {
              format: 'ograf-template-fragment',
              schemaVersion: 1,
              resourceReferenceCount: resourceRefs.length,
              componentReferenceCount: componentRefs.reduce(
                (count, reference) => count + reference.componentIds.length,
                0,
              ),
            },
          })
        : resourceSource,
    );
    if (new TextEncoder().encode(source).byteLength > MAX_TEMPLATE_SOURCE_BYTES)
      throw new Error(`Template source exceeds the 32 MiB limit: ${template.name}.`);
    zip.file(templateSourcePath(template.id), source);
    manifest.templates.push({
      id: template.id,
      name: template.name,
      projectId: template.project.id,
      ...(sharedAssets.length ? { sharedAssets } : {}),
      ...(componentRefs.length ? { componentRefs } : {}),
      ...(resourceRefs.length ? { resourceRefs } : {}),
      ...(template.inheritSettings !== undefined
        ? { inheritSettings: template.inheritSettings }
        : {}),
      ...(template.settingsOverrides ? { settingsOverrides: template.settingsOverrides } : {}),
      ...(template.brandKitOverrides ? { brandKitOverrides: template.brandKitOverrides } : {}),
      ...(template.typographyOverrides
        ? { typographyOverrides: template.typographyOverrides }
        : {}),
      ...(template.backgroundOverrides
        ? { backgroundOverrides: template.backgroundOverrides }
        : {}),
      ...(template.backgroundOverridden !== undefined
        ? { backgroundOverridden: template.backgroundOverridden }
        : {}),
      source: templateSourcePath(template.id),
      sha256: await sha256(new TextEncoder().encode(source)),
    });
  }

  for (const asset of set.assets) {
    progress(
      'resources',
      60,
      `Preparing shared resources (${manifest.assets.length + 1}/${set.assets.length})…`,
    );
    if (compactMode) {
      const hash = await resourcePool.add(asset.dataUri);
      const { dataUri: _dataUri, ...metadata } = asset;
      manifest.assets.push({ ...metadata, path: setResourcePath(hash), sha256: hash });
      continue;
    }
    const bytes = dataUriToBytes(asset.dataUri);
    const hash = await sha256(bytes);
    const path = assetDataPath(hash);
    if (!archiveAssets.has(hash)) archiveAssets.set(hash, bytes);
    const { dataUri: _dataUri, ...metadata } = asset;
    manifest.assets.push({ ...metadata, path, sha256: hash });
  }
  if (compactMode) {
    if (componentLibrary.length) {
      const library = structuredClone(componentLibrary);
      const resourceRefs = await extractSetResources(library, resourcePool);
      const source = JSON.stringify(library);
      const bytes = new TextEncoder().encode(source);
      if (bytes.byteLength > MAX_TEMPLATE_SOURCE_BYTES)
        throw new Error('Shared component sources exceed the 32 MiB limit.');
      zip.file('components/shared.json', bytes);
      manifest.sharedComponents = {
        path: 'components/shared.json',
        sha256: await sha256(bytes),
        componentIds: library.map((definition) => definition.id),
        resourceReferenceCount: resourceRefs.length,
        ...(resourceRefs.length ? { resourceRefs } : {}),
      };
    }
    // Settings, tokens and control values may also contain embedded paint/media payloads.
    const resourceRefs = await extractSetResources(manifest, resourcePool);
    if (resourceRefs.length) manifest.resourceRefs = resourceRefs;
    manifest.resources = [...resourcePool.entries.values()].map((entry) => entry.record);
    for (const { record, bytes } of resourcePool.entries.values()) zip.file(record.path, bytes);
  }
  for (const [hash, bytes] of archiveAssets) zip.file(assetDataPath(hash), bytes);
  const manifestText = JSON.stringify(manifest, null, 2);
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES)
    throw new Error('Template-set manifest exceeds the size limit.');
  zip.file(MANIFEST_PATH, manifestText);

  progress('compressing', 65, 'Compressing the template set…');
  const archive = await zip.generateAsync(
    {
      type: 'blob',
      mimeType: 'application/x-ograf-template-set',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    },
    ({ percent }) =>
      progress(
        'compressing',
        65 + percent * 0.34,
        `Compressing the template set… ${Math.floor(percent)}%`,
      ),
  );
  if (archive.size > MAX_PROJECT_SET_ARCHIVE_BYTES)
    throw new Error('Template-set archive exceeds the 256 MiB size limit.');
  progress('complete', 100, 'Template set ready.');
  return archive;
}

/** Opens legacy and compact set archives into self-contained ordinary child projects. */
export async function openProjectSetArchive(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<ProjectSetDocument> {
  const inputSize = input instanceof Blob ? input.size : input.byteLength;
  if (inputSize > MAX_PROJECT_SET_ARCHIVE_BYTES)
    throw new Error('Template-set archive exceeds the 256 MiB size limit.');
  const zip = await JSZip.loadAsync(input);
  const manifestBytes = await boundedArchiveBytes(zip, MANIFEST_PATH, MAX_MANIFEST_BYTES);
  const manifestText = new TextDecoder().decode(manifestBytes);
  if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES)
    throw new Error('Template-set manifest exceeds the size limit.');

  let unknownManifest: unknown;
  try {
    unknownManifest = JSON.parse(manifestText);
  } catch {
    throw new Error('Template-set manifest is not valid JSON.');
  }
  if (!unknownManifest || typeof unknownManifest !== 'object')
    throw new Error('Template-set manifest is invalid.');
  const manifest = unknownManifest as ProjectSetArchiveManifest;
  if (manifest.format !== PROJECT_SET_FORMAT)
    throw new Error('This archive is not an OGraf template set.');
  if (![1, 2, 3, 4, 5, PROJECT_SET_SCHEMA_VERSION].includes(manifest.schemaVersion))
    throw new Error(`Unsupported template-set version: ${String(manifest.schemaVersion)}`);
  if (manifest.transitionLogic !== undefined && manifest.schemaVersion < 5)
    throw new Error('Playout transitions require template-set version 5 or later.');
  if (
    manifest.nameOrigin !== undefined &&
    manifest.nameOrigin !== 'default' &&
    manifest.nameOrigin !== 'custom'
  )
    throw new Error('Template-set name origin is invalid.');
  if (
    !Array.isArray(manifest.templates) ||
    !Array.isArray(manifest.controls) ||
    !Array.isArray(manifest.assetSlots) ||
    !Array.isArray(manifest.assets)
  )
    throw new Error('Template-set manifest is missing templates or assets.');
  if (manifest.templates.length > MAX_PROJECT_SET_TEMPLATES)
    throw new Error(`A template set can contain at most ${MAX_PROJECT_SET_TEMPLATES} templates.`);

  const templates: ProjectSetTemplate[] = [];
  let totalContentBytes = 0;
  let expandedContentBytes = manifestBytes.byteLength;
  const accountExpandedBytes = (bytes: number) => {
    expandedContentBytes += bytes;
    if (expandedContentBytes > MAX_PROJECT_SET_CONTENT_BYTES)
      throw new Error('Hydrated template-set contents exceed the 512 MiB size limit.');
  };
  const compactResources = new Map<string, string>();
  const sharedComponents = new Map<string, ComponentDefinition>();
  if (
    manifest.schemaVersion < 6 &&
    (manifest.resources !== undefined ||
      manifest.resourceRefs !== undefined ||
      manifest.sharedComponents !== undefined ||
      manifest.templates.some(
        (item) => item.resourceRefs !== undefined || item.componentRefs !== undefined,
      ))
  )
    throw new Error('Compact resources and components require template-set version 6.');
  if (manifest.schemaVersion >= 6) {
    if (!Array.isArray(manifest.resources) || manifest.resources.length > 8192)
      throw new Error('Compact template-set resource pool is invalid.');
    for (const resource of manifest.resources) {
      if (
        !resource ||
        typeof resource !== 'object' ||
        Object.keys(resource).some(
          (key) => !['sha256', 'path', 'byteLength', 'encoding'].includes(key),
        ) ||
        typeof resource.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(resource.sha256) ||
        resource.path !== setResourcePath(resource.sha256) ||
        compactResources.has(resource.sha256) ||
        resource.encoding !== 'data-uri-utf8' ||
        !Number.isSafeInteger(resource.byteLength) ||
        resource.byteLength <= 0 ||
        resource.byteLength > MAX_SET_ASSET_BYTES
      )
        throw new Error('Compact template-set resource metadata is invalid.');
      const bytes = await boundedArchiveBytes(zip, resource.path, MAX_SET_ASSET_BYTES);
      totalContentBytes += bytes.byteLength;
      if (totalContentBytes > MAX_PROJECT_SET_CONTENT_BYTES)
        throw new Error('Template-set contents exceed the 512 MiB size limit.');
      if (bytes.byteLength !== resource.byteLength || (await sha256(bytes)) !== resource.sha256)
        throw new Error('Compact embedded resource failed integrity verification.');
      let uri: string;
      try {
        uri = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('Compact embedded resource is not valid UTF-8.');
      }
      if (!/^data:[^,]*,/i.test(uri))
        throw new Error('Compact embedded resource is not a data URI.');
      compactResources.set(resource.sha256, uri);
    }
    hydrateSetResources(manifest, manifest.resourceRefs, compactResources, accountExpandedBytes);
    const record = manifest.sharedComponents;
    if (record !== undefined) {
      if (
        !record ||
        typeof record !== 'object' ||
        Object.keys(record).some(
          (key) =>
            !['path', 'sha256', 'componentIds', 'resourceReferenceCount', 'resourceRefs'].includes(
              key,
            ),
        ) ||
        record.path !== 'components/shared.json' ||
        typeof record.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.sha256) ||
        !Array.isArray(record.componentIds) ||
        record.componentIds.length > 4096 ||
        record.componentIds.some((id) => typeof id !== 'string' || !safeId(id)) ||
        new Set(record.componentIds).size !== record.componentIds.length
      )
        throw new Error('Shared component library metadata is invalid.');
      const bytes = await boundedArchiveBytes(zip, record.path, MAX_TEMPLATE_SOURCE_BYTES);
      totalContentBytes += bytes.byteLength;
      if (totalContentBytes > MAX_PROJECT_SET_CONTENT_BYTES)
        throw new Error('Template-set contents exceed the 512 MiB size limit.');
      if ((await sha256(bytes)) !== record.sha256)
        throw new Error('Shared component library failed integrity verification.');
      const library = archiveJson(bytes, 'Shared component library');
      if (!Array.isArray(library) || library.length !== record.componentIds.length)
        throw new Error('Shared component library identities do not match the manifest.');
      if (record.resourceReferenceCount !== (record.resourceRefs?.length ?? 0))
        throw new Error('Shared component library resource reference count is invalid.');
      hydrateSetResources(library, record.resourceRefs, compactResources, accountExpandedBytes);
      assertCompactResourcePlaceholdersResolved(library);
      for (let index = 0; index < library.length; index++) {
        const definition = library[index] as ComponentDefinition;
        if (
          !definition ||
          typeof definition !== 'object' ||
          definition.id !== record.componentIds[index] ||
          definition.scope !== 'set' ||
          !Array.isArray(definition.layers) ||
          !Array.isArray(definition.dataFields)
        )
          throw new Error('Shared component library contains an invalid source.');
        sharedComponents.set(definition.id, definition);
      }
    }
  }
  const sharedPayloads = new Map<string, Uint8Array>();
  const sharedDataUris = new Map<string, string>();
  let decodedSharedBytes = 0;
  for (const item of manifest.templates) {
    if (!safeId(item.id) || item.source !== templateSourcePath(item.id))
      throw new Error(`Invalid source path for template ${String(item.id)}.`);
    const sourceBytes = await boundedArchiveBytes(zip, item.source, MAX_TEMPLATE_SOURCE_BYTES);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
    if (sourceBytes.byteLength > MAX_TEMPLATE_SOURCE_BYTES)
      throw new Error(`Template source exceeds the 32 MiB limit: ${item.name}.`);
    totalContentBytes += sourceBytes.byteLength;
    if (totalContentBytes > MAX_PROJECT_SET_CONTENT_BYTES)
      throw new Error('Template-set contents exceed the 512 MiB size limit.');
    if (!/^[a-f0-9]{64}$/.test(item.sha256))
      throw new Error(`Invalid source checksum for template ${item.name}.`);
    if ((await sha256(sourceBytes)) !== item.sha256)
      throw new Error(`Template source failed integrity verification: ${item.name}`);
    accountExpandedBytes(sourceBytes.byteLength);
    const project =
      manifest.schemaVersion >= 6
        ? (() => {
            const raw = archiveJson(sourceBytes, 'Template source');
            if (
              !raw ||
              typeof raw !== 'object' ||
              !('compositions' in raw) ||
              !Array.isArray(raw.compositions)
            )
              throw new Error('Compact template source is not a project.');
            hydrateSetResources(raw, item.resourceRefs, compactResources, accountExpandedBytes);
            hydrateSetComponents(
              raw as Project,
              item.componentRefs,
              sharedComponents,
              accountExpandedBytes,
            );
            assertCompleteCompactProject(raw as Project, sharedComponents);
            if ('archiveFragment' in raw) {
              const marker = raw.archiveFragment as {
                format?: unknown;
                schemaVersion?: unknown;
                resourceReferenceCount?: unknown;
                componentReferenceCount?: unknown;
              };
              if (
                !marker ||
                marker.format !== 'ograf-template-fragment' ||
                marker.schemaVersion !== 1 ||
                marker.resourceReferenceCount !== (item.resourceRefs?.length ?? 0) ||
                marker.componentReferenceCount !==
                  (item.componentRefs ?? []).reduce(
                    (count, reference) => count + reference.componentIds.length,
                    0,
                  ) ||
                Object.keys(marker).some(
                  (key) =>
                    ![
                      'format',
                      'schemaVersion',
                      'resourceReferenceCount',
                      'componentReferenceCount',
                    ].includes(key),
                )
              )
                throw new Error('Compact template fragment marker is invalid.');
              delete raw.archiveFragment;
            } else if (item.resourceRefs?.length || item.componentRefs?.length)
              throw new Error('Compact template fragment marker is missing.');
            if ('presenter' in raw && raw.presenter !== undefined)
              validatePresenterDefinition(raw.presenter as PresenterDefinition);
            if ('authoringPrompts' in raw && raw.authoringPrompts !== undefined)
              validateAuthoringPrompts(raw.authoringPrompts);
            return raw as Project;
          })()
        : parseProjectSource(source);
    if (manifest.schemaVersion >= 6 && item.sharedAssets !== undefined)
      throw new Error(
        'Compact templates must use the resource pool instead of legacy asset references.',
      );
    if (item.sharedAssets !== undefined) {
      if (
        !Array.isArray(item.sharedAssets) ||
        item.sharedAssets.length > 4096 ||
        manifest.schemaVersion < 4
      )
        throw new Error('Invalid shared template asset references.');
      const used = new Set<string>();
      for (const reference of item.sharedAssets) {
        if (
          !reference ||
          typeof reference !== 'object' ||
          Object.keys(reference).some(
            (key) => !['compositionId', 'assetId', 'setAssetId'].includes(key),
          )
        )
          throw new Error('Invalid shared template asset reference.');
        const key = JSON.stringify([reference.compositionId, reference.assetId]);
        if (used.has(key)) throw new Error('Duplicate shared template asset reference.');
        used.add(key);
        const asset = project.compositions
          .find((composition) => composition.id === reference.compositionId)
          ?.assets.find((candidate) => candidate.id === reference.assetId);
        const shared = manifest.assets.find((candidate) => candidate.id === reference.setAssetId);
        if (
          !asset ||
          asset.dataUri !== '' ||
          !shared ||
          asset.kind !== shared.kind ||
          asset.mimeType !== shared.mimeType ||
          !/^[a-f0-9]{64}$/.test(shared.sha256) ||
          shared.path !== assetDataPath(shared.sha256)
        )
          throw new Error('Shared template asset identity does not match the manifest.');
        let bytes = sharedPayloads.get(shared.sha256);
        if (!bytes) {
          bytes = await boundedArchiveBytes(zip, shared.path, MAX_SET_ASSET_BYTES);
          if (
            bytes.byteLength > MAX_SET_ASSET_BYTES ||
            decodedSharedBytes + bytes.byteLength > MAX_PROJECT_SET_CONTENT_BYTES
          )
            throw new Error('Shared template assets exceed the size limit.');
          if ((await sha256(bytes)) !== shared.sha256)
            throw new Error('Shared template asset failed integrity verification.');
          decodedSharedBytes += bytes.byteLength;
          sharedPayloads.set(shared.sha256, bytes);
        }
        const uriKey = JSON.stringify([shared.mimeType, shared.sha256]);
        let dataUri = sharedDataUris.get(uriKey);
        if (!dataUri) {
          dataUri = `data:${shared.mimeType};base64,${bytesToBase64(bytes)}`;
          sharedDataUris.set(uriKey, dataUri);
        }
        asset.dataUri = dataUri;
      }
    }
    if (
      manifest.schemaVersion >= 4 &&
      project.compositions.some((composition) =>
        composition.assets.some((asset) => asset.dataUri === ''),
      )
    )
      throw new Error('Shared template asset references are incomplete.');
    if (project.id !== item.projectId)
      throw new Error(`Template project ID does not match the manifest for ${item.name}.`);
    templates.push({
      id: item.id,
      name: item.name,
      project,
      ...(item.inheritSettings !== undefined ? { inheritSettings: item.inheritSettings } : {}),
      ...(item.settingsOverrides !== undefined
        ? { settingsOverrides: item.settingsOverrides }
        : {}),
      ...(item.brandKitOverrides !== undefined
        ? { brandKitOverrides: item.brandKitOverrides }
        : {}),
      ...(item.typographyOverrides !== undefined
        ? { typographyOverrides: item.typographyOverrides }
        : {}),
      ...(item.backgroundOverrides !== undefined
        ? { backgroundOverrides: item.backgroundOverrides }
        : {}),
      ...(item.backgroundOverridden !== undefined
        ? { backgroundOverridden: item.backgroundOverridden }
        : {}),
    });
  }

  const assets: Asset[] = [];
  const verifiedAssets = new Map<string, Uint8Array>();
  for (const item of manifest.assets) {
    if (manifest.schemaVersion >= 6) {
      if (
        !item ||
        typeof item !== 'object' ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        item.path !== setResourcePath(item.sha256) ||
        !compactResources.has(item.sha256)
      )
        throw new Error('Compact set-level asset reference is invalid.');
      const { path: _path, sha256: _hash, ...metadata } = item;
      const dataUri = compactResources.get(item.sha256)!;
      accountExpandedBytes(new TextEncoder().encode(dataUri).byteLength);
      assets.push({ ...metadata, dataUri });
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || item.path !== assetDataPath(item.sha256))
      throw new Error(`Invalid asset path for ${item.id}.`);
    let bytes = verifiedAssets.get(item.sha256);
    if (!bytes) {
      bytes =
        sharedPayloads.get(item.sha256) ??
        (await boundedArchiveBytes(zip, item.path, MAX_SET_ASSET_BYTES));
      if (bytes.byteLength > MAX_SET_ASSET_BYTES)
        throw new Error(`Set-level asset exceeds the 128 MiB limit: ${item.id}`);
      totalContentBytes += bytes.byteLength;
      if (totalContentBytes > MAX_PROJECT_SET_CONTENT_BYTES)
        throw new Error('Template-set contents exceed the 512 MiB size limit.');
      if ((await sha256(bytes)) !== item.sha256)
        throw new Error(`Set-level asset failed integrity verification: ${item.id}`);
      verifiedAssets.set(item.sha256, bytes);
    }
    const { path: _path, sha256: _hash, ...metadata } = item;
    const uriKey = JSON.stringify([item.mimeType, item.sha256]);
    const dataUri =
      sharedDataUris.get(uriKey) ?? `data:${item.mimeType};base64,${bytesToBase64(bytes)}`;
    sharedDataUris.set(uriKey, dataUri);
    assets.push({ ...metadata, dataUri });
  }

  const set = migrateProjectSetDocument({
    id: manifest.id,
    name: manifest.name,
    ...(manifest.nameOrigin ? { nameOrigin: manifest.nameOrigin } : {}),
    ...(manifest.activeTemplateId ? { activeTemplateId: manifest.activeTemplateId } : {}),
    ...(manifest.settings !== undefined ? { settings: manifest.settings } : {}),
    ...(manifest.brandKit !== undefined ? { brandKit: manifest.brandKit } : {}),
    ...(manifest.transitionLogic !== undefined
      ? { transitionLogic: manifest.transitionLogic }
      : {}),
    ...(manifest.presenter !== undefined ? { presenter: manifest.presenter } : {}),
    ...(sharedComponents.size ? { componentAssets: [...sharedComponents.values()] } : {}),
    templates,
    controls: manifest.controls,
    assetSlots: manifest.assetSlots,
    assets,
  });
  validateSet(set);
  return set;
}
