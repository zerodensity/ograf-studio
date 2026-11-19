import {
  chartRendererFeatureErrors,
  isRendererPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
  validateRendererPluginReference,
  validateRendererPluginSnapshot,
  type ChartElement,
  type ComponentDefinition,
  type Composition,
  type Layer,
  type Project,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import type { InstalledRendererPlugin, InstalledStudioPlugin } from './pluginSettingsStore';

/** Reuse one resolver to check multiple charts against the same installed catalog. */
export function createChartRendererResolver(installed: readonly InstalledStudioPlugin[]) {
  const available = installed
    .filter(
      (entry): entry is InstalledRendererPlugin =>
        entry.enabled && entry.trusted && isRendererPluginSnapshot(entry.snapshot),
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.bundled)) - Number(Boolean(left.bundled)) ||
        String(right.installedAt).localeCompare(String(left.installedAt)) ||
        String(left.snapshot.sha256).localeCompare(String(right.snapshot.sha256)),
    );

  // Component sources and collection prototypes can use the same large bundle many times.
  // Cache digest checks only for the lifetime of this resolution.
  const verified = new Map<RendererPluginSnapshot, boolean>();
  function verify(snapshot: RendererPluginSnapshot): boolean {
    const cached = verified.get(snapshot);
    if (cached !== undefined) return cached;
    const valid = validateRendererPluginSnapshot(snapshot).length === 0;
    verified.set(snapshot, valid);
    return valid;
  }

  return (
    chart: ChartElement,
    saved: readonly RendererPluginSnapshot[],
  ): RendererPluginSnapshot | null => {
    const reference = chart.provider;
    if (!reference || validateRendererPluginReference(reference).length) return null;
    const candidates = available.filter(
      ({ snapshot }) =>
        snapshot.manifest.id === reference.id && snapshot.manifest.version === reference.version,
    );
    if (!candidates.length) return null;
    const embedded = saved.filter(
      (snapshot) =>
        snapshot?.manifest?.id === reference.id && snapshot.manifest.version === reference.version,
    );
    const pinned = embedded.find((snapshot) => snapshot.sha256 === reference.sha256);
    if (!pinned || !verify(pinned)) return null;

    const compatible = ({ snapshot }: InstalledRendererPlugin) =>
      verify(snapshot) &&
      snapshot.manifest.presets.includes(chart.preset) &&
      chartRendererFeatureErrors(chart, snapshot.manifest).length === 0 &&
      // Keep a separate corrupt catalog entry visible to normal project validation.
      embedded.every((entry) => entry.sha256 !== snapshot.sha256 || verify(entry));
    return (
      candidates.find((entry) => entry.snapshot.sha256 === reference.sha256 && compatible(entry))
        ?.snapshot ??
      candidates.find((entry) => entry.snapshot.sha256 !== reference.sha256 && compatible(entry))
        ?.snapshot ??
      null
    );
  };
}

/** Select verified local bytes. Merely matching a version never authorizes a template's bundle. */
export function resolveStudioChartRenderer(
  chart: ChartElement,
  saved: readonly RendererPluginSnapshot[],
  installed: readonly InstalledStudioPlugin[],
): RendererPluginSnapshot | null {
  return createChartRendererResolver(installed)(chart, saved);
}

type ResolveChart = ReturnType<typeof createChartRendererResolver>;
interface RendererReplacement {
  from: string;
  snapshot: RendererPluginSnapshot;
}

function resolveLayers(
  layers: Layer[],
  saved: readonly RendererPluginSnapshot[],
  resolve: ResolveChart,
  replacements: RendererReplacement[],
): Layer[] {
  let changed: Layer[] | undefined;
  layers.forEach((layer, index) => {
    if (layer.element.type !== 'chart' || !layer.element.provider) return;
    const snapshot = resolve(layer.element, saved);
    if (!snapshot || snapshot.sha256 === layer.element.provider.sha256) return;
    changed ??= layers.slice();
    changed[index] = {
      ...layer,
      element: { ...layer.element, provider: studioPluginReference(snapshot) },
    };
    replacements.push({ from: rendererPluginKey(layer.element.provider), snapshot });
  });
  return changed ?? layers;
}

function snapshotKey(snapshot: RendererPluginSnapshot): string | null {
  return snapshot?.manifest ? rendererPluginKey(studioPluginReference(snapshot)) : null;
}

function resolvedCatalog(
  saved: readonly RendererPluginSnapshot[],
  layers: readonly Layer[],
  replacements: readonly RendererReplacement[],
): RendererPluginSnapshot[] {
  const replaced = new Set(replacements.map(({ from }) => from));
  const used = new Set(
    layers.flatMap(({ element }) =>
      element.type === 'chart' && element.provider ? [rendererPluginKey(element.provider)] : [],
    ),
  );
  const installed = new Map(
    replacements.map(({ snapshot }) => [
      rendererPluginKey(studioPluginReference(snapshot)),
      snapshot,
    ]),
  );
  const catalog = saved.flatMap((snapshot) => {
    const key = snapshotKey(snapshot);
    if (!key) return [snapshot];
    if (replaced.has(key) && !used.has(key)) return [];
    const replacement = installed.get(key);
    installed.delete(key);
    return [replacement ?? snapshot];
  });
  return [...catalog, ...installed.values()];
}

function resolveComponent(
  component: ComponentDefinition,
  resolve: ResolveChart,
): ComponentDefinition {
  const context = component.context;
  if (!Array.isArray(context?.rendererPlugins)) return component;
  const replacements: RendererReplacement[] = [];
  const layers = resolveLayers(component.layers, context.rendererPlugins, resolve, replacements);
  if (layers === component.layers) return component;
  return {
    ...component,
    layers,
    context: {
      ...context,
      rendererPlugins: resolvedCatalog(context.rendererPlugins, layers, replacements),
    },
  };
}

/** Shared instances are compiled from component definitions independent of their host template. */
export function resolveStudioRendererComponent(
  component: ComponentDefinition,
  installed: readonly InstalledStudioPlugin[],
): ComponentDefinition {
  return resolveComponent(component, createChartRendererResolver(installed));
}

function resolveComposition(composition: Composition, resolve: ResolveChart): Composition {
  const saved = Array.isArray(composition.rendererPlugins) ? composition.rendererPlugins : [];
  const replacements: RendererReplacement[] = [];
  const layers = resolveLayers(composition.layers, saved, resolve, replacements);
  const components = composition.components.map((component) => {
    if (component.context) return resolveComponent(component, resolve);
    const layers = resolveLayers(component.layers, saved, resolve, replacements);
    return layers === component.layers ? component : { ...component, layers };
  });
  const componentsChanged = components.some(
    (component, index) => component !== composition.components[index],
  );
  if (!replacements.length && !componentsChanged) return composition;
  return {
    ...composition,
    layers,
    components: componentsChanged ? components : composition.components,
    ...(replacements.length
      ? {
          rendererPlugins: resolvedCatalog(
            saved,
            [
              ...layers,
              ...components.flatMap((component) => (component.context ? [] : component.layers)),
            ],
            replacements,
          ),
        }
      : {}),
  };
}

/** Resolve playback inputs without editing the original composition or its plugin pins. */
export function resolveStudioRendererComposition(
  composition: Composition,
  installed: readonly InstalledStudioPlugin[],
): Composition {
  return resolveComposition(composition, createChartRendererResolver(installed));
}

export function resolveStudioRendererProject(
  project: Project,
  installed: readonly InstalledStudioPlugin[],
): Project {
  const resolve = createChartRendererResolver(installed);
  const compositions = project.compositions.map((composition) =>
    resolveComposition(composition, resolve),
  );
  return compositions.some((composition, index) => composition !== project.compositions[index])
    ? { ...project, compositions }
    : project;
}
