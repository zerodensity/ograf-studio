import {
  bindProjectSetAsset,
  saveProjectSetTemplateEdits,
  setProjectSetAssetSlotSource,
  type ProjectSetAssetSlot,
  type ProjectSetDocument,
} from './projectSet';
import type { Asset, Project } from '@ograf-editor/scene-model';

export interface SharedAssetImpactSlot {
  slot: ProjectSetAssetSlot;
  bindings: Array<{
    id: string;
    templateId: string;
    templateName: string;
    assetName: string;
    inherit: boolean;
  }>;
}

/** Fold in unsaved edits before mapping an asset imported into the active template. */
export function bindCurrentProjectSetAsset(
  set: ProjectSetDocument,
  slotId: string,
  templateId: string,
  compositionId: string,
  templateAssetId: string | null,
  active: { templateId: string; project: Project },
): ProjectSetDocument {
  const current =
    templateId === active.templateId
      ? saveProjectSetTemplateEdits(set, templateId, active.project)
      : set;
  return bindProjectSetAsset(current, slotId, templateId, compositionId, templateAssetId);
}

/** The source file can be selected by multiple slots; a replacement updates all of them. */
export function sharedAssetImpact(
  set: ProjectSetDocument,
  slotId: string,
  replaceSharedSource: boolean,
  active?: { templateId: string; project: Project },
): SharedAssetImpactSlot[] {
  const selected = set.assetSlots.find((slot) => slot.id === slotId);
  if (!selected) return [];
  const slots =
    replaceSharedSource && selected.assetId
      ? set.assetSlots.filter((slot) => slot.assetId === selected.assetId)
      : [selected];
  return slots.map((slot) => ({
    slot,
    bindings: slot.bindings.map((binding) => {
      const template = set.templates.find((item) => item.id === binding.templateId);
      const project =
        binding.templateId === active?.templateId ? active.project : template?.project;
      const asset = project?.compositions
        .find((composition) => composition.id === binding.compositionId)
        ?.assets.find((item) => item.id === binding.templateAssetId);
      return {
        id: binding.id,
        templateId: binding.templateId,
        templateName: template?.name ?? 'Missing template',
        assetName: asset?.name ?? 'Missing asset',
        inherit: binding.inherit,
      };
    }),
  }));
}

function refersToAsset(value: unknown, assetId: string): boolean {
  if (typeof value === 'string') return value === `asset:${assetId}`;
  if (Array.isArray(value)) return value.some((item) => refersToAsset(item, assetId));
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => refersToAsset(item, assetId));
  return false;
}

/** Direct references are separate from slot bindings, and change only on source replacement. */
export function sharedSourceReferences(set: ProjectSetDocument, assetId: string) {
  const asset = set.assets.find((item) => item.id === assetId);
  const brand = set.brandKit;
  const family = asset?.kind === 'font' ? asset.fontFamily : undefined;
  const fontMatches = (value: string) =>
    Boolean(
      family && value.split(',').some((item) => item.trim().replace(/^['"]|['"]$/g, '') === family),
    );
  return {
    controls: set.controls
      .filter((control) => refersToAsset(control.value, assetId))
      .map((control) => control.field.label || control.field.key),
    brandKit: Boolean(
      refersToAsset(brand, assetId) ||
      brand?.tokens.some(
        (token) => token.type === 'font-family' && fontMatches(String(token.value)),
      ) ||
      brand?.typography?.some((style) => fontMatches(style.properties.fontFamily)),
    ),
    settings: refersToAsset(set.settings, assetId),
    components: (set.componentAssets ?? [])
      .filter(
        (component) =>
          refersToAsset(component, assetId) ||
          component.resources?.some((resource) => resource.id === assetId),
      )
      .map((component) => component.name),
  };
}

/** Apply the reviewed replacement without changing local template assets or unrelated slots. */
export function replaceReviewedSharedAsset(
  set: ProjectSetDocument,
  slotId: string,
  replacement: Asset,
  mode: 'all' | 'slot',
  newAssetId: string,
): ProjectSetDocument {
  const slot = set.assetSlots.find((item) => item.id === slotId);
  if (!slot) throw new Error('The shared asset slot no longer exists.');
  if (slot.kind !== replacement.kind) throw new Error('The replacement has an incompatible kind.');
  const replaceExisting = mode === 'all' && !!slot.assetId;
  const id = replaceExisting ? slot.assetId! : newAssetId;
  if (replaceExisting && !set.assets.some((asset) => asset.id === id))
    throw new Error('The shared source no longer exists.');
  if (!replaceExisting && (!id || set.assets.some((asset) => asset.id === id)))
    throw new Error('The new shared asset ID is invalid or already in use.');
  const asset = { ...replacement, id };
  const next = {
    ...set,
    assets: replaceExisting
      ? set.assets.map((item) => (item.id === id ? asset : item))
      : [...set.assets, asset],
  };
  return setProjectSetAssetSlotSource(next, slot.id, id);
}
