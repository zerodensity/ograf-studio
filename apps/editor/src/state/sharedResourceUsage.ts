import {
  isMediaPaint,
  mediaPaintAssetReferences,
  type Asset,
  type Project,
} from '@ograf-editor/scene-model';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import type { ProjectSetDocument } from './projectSet';

/** Match the set-resource injection rules used when resolving a template. */
export function createSharedAssetScope(
  set: ProjectSetDocument | null,
  templateId: string | null,
  compositionId: string,
): (asset: Asset) => string {
  if (!set || !templateId) return () => '';
  const mapped = new Map<string, string>();
  for (const slot of set.assetSlots) {
    for (const binding of slot.bindings) {
      if (binding.templateId === templateId && binding.compositionId === compositionId)
        mapped.set(
          binding.templateAssetId,
          !binding.inherit ? 'Local override' : slot.assetId ? 'Inherited' : 'Local fallback',
        );
    }
  }
  const brand = set.brandKit;
  const sharedAssets = new Map<string, Asset>();
  for (const item of set.assets.filter(
    (item) =>
      item.kind === 'font' &&
      (brand?.tokens.some(
        (token) =>
          token.type === 'font-family' &&
          String(token.value)
            .split(',')
            .some((family) => family.trim().replace(/^['"]|['"]$/g, '') === item.fontFamily),
      ) ||
        brand?.typography?.some((style) =>
          style.properties.fontFamily
            .split(',')
            .some((family) => family.trim().replace(/^['"]|['"]$/g, '') === item.fontFamily),
        )),
  ))
    sharedAssets.set(`setfont-${item.id}`, item);
  const backgroundIds = new Set(
    (brand?.backgrounds ?? []).flatMap((style) =>
      isMediaPaint(style.paint) ? mediaPaintAssetReferences(style.paint) : [],
    ),
  );
  for (const item of set.assets)
    if (backgroundIds.has(`asset:${item.id}`)) sharedAssets.set(item.id, item);
  for (const component of componentLibraryFromTemplates(set))
    for (const item of component.resources ?? []) sharedAssets.set(item.id, item);
  return (asset) => {
    const binding = mapped.get(asset.id);
    if (binding) return binding;
    const source = sharedAssets.get(asset.id);
    return source && source.kind === asset.kind && source.dataUri === asset.dataUri
      ? 'Set'
      : 'Local';
  };
}

/** Count instances rather than source layers, including field-only overrides. */
export function sharedComponentUsage(project: Project, componentId: string) {
  const instances = new Map<
    string,
    { layerId: string; compositionId: string; overridden: boolean }
  >();
  for (const composition of project.compositions) {
    for (const layer of composition.layers) {
      const link = layer.componentLink;
      if (!link || link.componentId !== componentId) continue;
      const key = `${composition.id}:${link.instanceId}`;
      const previous = instances.get(key);
      const overridden = Boolean(
        link.overridePaths?.length ||
        Object.values(link.fieldOverridePaths ?? {}).some((paths) => paths.length),
      );
      instances.set(key, {
        layerId: previous?.layerId ?? layer.id,
        compositionId: composition.id,
        overridden: Boolean(previous?.overridden || overridden),
      });
    }
  }
  return {
    count: instances.size,
    overridden: [...instances.values()].filter((instance) => instance.overridden).length,
    firstLayerId: instances.values().next().value?.layerId,
    firstCompositionId: instances.values().next().value?.compositionId,
  };
}
