import {
  rendererPluginKey,
  type Project,
  type RendererPluginReference,
  type RendererPluginSnapshot,
  type StudioPluginSnapshot,
  type AnimationPresetPluginSnapshot,
  type ShaderPackPluginSnapshot,
  getElementShaderPaints,
  getEffectStack,
  isRendererPluginSnapshot,
  validateRendererPluginReference,
} from '@ograf-editor/scene-model';
import { rendererPluginReference, type InstalledStudioPlugin } from '../state/pluginSettingsStore';

interface ApplicationLibrary {
  name: string;
  version: string;
  publisher: string;
  license: string;
  licenseOrigin: string;
  homepage?: string | undefined;
}
interface ApplicationInfo {
  name: string;
  adapter: { name: string; version: string; publisher: string; license: string };
  library: ApplicationLibrary | null;
}
export function applicationComponents(
  snapshot: RendererPluginSnapshot,
): ApplicationInfo & { library: ApplicationLibrary };
export function applicationComponents(
  snapshot: AnimationPresetPluginSnapshot,
): ApplicationInfo & { library: null };
export function applicationComponents(
  snapshot: ShaderPackPluginSnapshot,
): ApplicationInfo & { library: null };
export function applicationComponents(snapshot: StudioPluginSnapshot): ApplicationInfo;
export function applicationComponents(snapshot: StudioPluginSnapshot): ApplicationInfo {
  if (!isRendererPluginSnapshot(snapshot))
    return {
      name: snapshot.manifest.name,
      adapter: {
        name: snapshot.manifest.name,
        version: snapshot.manifest.version,
        publisher: snapshot.manifest.author || 'Not declared',
        license: snapshot.manifest.license,
      },
      library: null,
    };
  const { manifest, licenseText } = snapshot;
  const library = manifest.library;
  const matchingMitNotice =
    library?.name === 'Chart.js' &&
    /(?:^|\r?\n)Chart\.js:[ \t]*\r?\nThe MIT License \(MIT\)[ \t]*(?:\r?\n|$)/.test(licenseText);
  return {
    name: library?.name || manifest.name,
    adapter: {
      name: manifest.name,
      version: manifest.version,
      publisher: manifest.author || 'Not declared',
      license: manifest.license,
    },
    library: {
      name: library?.name || 'Unknown',
      version: library?.version || 'Unknown',
      publisher: library?.author || 'Not declared',
      license: library?.license || (matchingMitNotice ? 'MIT' : 'Unknown'),
      licenseOrigin: library?.license
        ? 'declared'
        : matchingMitNotice
          ? 'bundled notice'
          : 'unknown',
      homepage: library?.homepage,
    },
  };
}

export interface InstalledApplicationGroup {
  id: string;
  key: string;
  kind: StudioPluginSnapshot['manifest']['kind'];
  name: string;
  versions: InstalledStudioPlugin[];
  preferred: InstalledStudioPlugin;
}

/** All installed versions remain manageable, including disabled and not-yet-trusted versions. */
export function installedApplicationGroups(
  installed: readonly InstalledStudioPlugin[],
  defaultProvider: RendererPluginReference | null,
): InstalledApplicationGroup[] {
  const grouped = new Map<string, InstalledStudioPlugin[]>();
  for (const entry of installed) {
    const id = entry.snapshot.manifest.id + ':' + entry.snapshot.manifest.kind;
    const versions = grouped.get(id) ?? [];
    versions.push(entry);
    grouped.set(id, versions);
  }
  return [...grouped]
    .map(([id, entries]) => {
      const versions = [...entries].sort(
        (left, right) =>
          right.installedAt.localeCompare(left.installedAt) ||
          right.snapshot.manifest.version.localeCompare(left.snapshot.manifest.version, undefined, {
            numeric: true,
          }),
      );
      const pluginId = entries[0]!.snapshot.manifest.id;
      const preferred =
        defaultProvider?.id === pluginId && entries[0]!.snapshot.manifest.kind === 'chart'
          ? (versions.find(
              (entry) =>
                rendererPluginKey(rendererPluginReference(entry.snapshot)) ===
                rendererPluginKey(defaultProvider),
            ) ?? versions[0]!)
          : versions[0]!;
      return {
        id: pluginId,
        key: id,
        kind: preferred.snapshot.manifest.kind,
        name: applicationComponents(preferred.snapshot).name,
        versions,
        preferred,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/** Counts authored object references, including guides, prototypes and saved component layers. */
export function applicationProjectUsage(project: Project, reference: RendererPluginReference) {
  const key = rendererPluginKey(reference);
  const matches = (layer: Project['compositions'][number]['layers'][number]) =>
    (layer.element.type === 'chart' &&
      layer.element.provider &&
      rendererPluginKey(layer.element.provider) === key) ||
    [
      ...Object.values(layer.animationPresets ?? {}),
      ...Object.values(layer.element.type === 'chart' ? (layer.element.markAnimations ?? {}) : {}),
    ].some(
      (application) =>
        application &&
        !validateRendererPluginReference(application.reference).length &&
        rendererPluginKey(application.reference) === key,
    ) ||
    [
      ...getElementShaderPaints(layer.element).map((entry) => entry.paint),
      ...getEffectStack(layer.effects).flatMap((effect) => (effect.shader ? [effect.shader] : [])),
    ].some(
      (paint) =>
        paint.packProvenance &&
        !validateRendererPluginReference(paint.packProvenance.reference).length &&
        rendererPluginKey(paint.packProvenance.reference) === key,
    );
  let objects = 0,
    componentObjects = 0;
  const compositions: string[] = [];
  for (const composition of project.compositions) {
    const count = composition.layers.filter(matches).length;
    const saved = composition.components
      .flatMap((component) => component.layers)
      .filter(matches).length;
    objects += count;
    componentObjects += saved;
    if (count || saved) compositions.push(composition.name);
  }
  return { objects, componentObjects, compositions };
}
