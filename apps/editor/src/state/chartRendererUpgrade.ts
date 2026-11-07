import {
  chartRendererFeatureErrors,
  rendererPluginKey,
  rendererPluginByteLength,
  MAX_RENDERER_PLUGIN_CATALOG_BYTES,
  MAX_RENDERER_PLUGIN_CATALOG_ENTRIES,
  studioPluginReference,
  validateRendererPluginReference,
  validateRendererPluginSnapshot,
  type Project,
  type RendererPluginReference,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { isInstalledChartPlugin, type InstalledStudioPlugin } from './pluginSettingsStore';
import type { ProjectSetDocument } from './projectSet';

/** Compare semantic versions without treating a different hash as a newer version. */
export function compareRendererVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(value);
    return match ? { core: match.slice(1, 4), pre: match[4]?.split('.') } : null;
  };
  const numeric = (a: string, b: string) => {
    const x = a.replace(/^0+(?=\d)/, ''),
      y = b.replace(/^0+(?=\d)/, '');
    return x.length === y.length ? (x === y ? 0 : x < y ? -1 : 1) : x.length < y.length ? -1 : 1;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error('Plugin versions must be valid semantic versions.');
  for (let i = 0; i < 3; i++) {
    const delta = numeric(a.core[i]!, b.core[i]!);
    if (delta) return delta;
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) {
      const delta = numeric(x, y);
      if (delta) return delta;
      continue;
    }
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export interface ChartRendererUpgradePlan {
  from: RendererPluginReference;
  to: RendererPluginSnapshot;
  objects: number;
  componentObjects: number;
  sharedInstances: number;
  preservedOverrides: number;
  errors: string[];
}

/** Preflight every affected chart before changing any reference or embedded source. */
export function planChartRendererUpgrade(
  project: Project,
  from: RendererPluginReference,
  to: RendererPluginSnapshot,
  projectSet?: ProjectSetDocument | null,
  activeTemplateId?: string | null,
): ChartRendererUpgradePlan {
  const errors = [...validateRendererPluginSnapshot(to), ...validateRendererPluginReference(from)];
  const sourceKey = rendererPluginKey(from);
  const target = studioPluginReference(to);
  if (from.id !== target.id || rendererPluginKey(target) === sourceKey)
    errors.push('Choose a different build of the same chart renderer.');
  if (!errors.length && compareRendererVersions(target.version, from.version) < 0)
    errors.push('The selected renderer is older than the saved renderer.');
  let objects = 0;
  let componentObjects = 0;
  let sharedInstances = 0;
  let preservedOverrides = 0;
  const sharedSources = new Map<string, Set<string>>();
  for (const composition of project.compositions) {
    for (const component of composition.components) {
      if (component.scope !== 'set') continue;
      for (const source of component.layers) {
        if (
          source.element.type === 'chart' &&
          source.element.provider &&
          rendererPluginKey(source.element.provider) === sourceKey
        ) {
          const ids = sharedSources.get(component.id) ?? new Set<string>();
          ids.add(source.id);
          sharedSources.set(component.id, ids);
        }
      }
    }
    for (const [layers, component] of [
      [composition.layers, false],
      [composition.components.flatMap((item) => item.layers), true],
    ] as const) {
      for (const layer of layers) {
        if (
          layer.element.type !== 'chart' ||
          !layer.element.provider ||
          rendererPluginKey(layer.element.provider) !== sourceKey
        )
          continue;
        if (component) componentObjects++;
        else objects++;
        if (layer.isLocked) errors.push(`Unlock "${layer.name}" before updating its renderer.`);
        if (!to.manifest.presets.includes(layer.element.preset))
          errors.push(`"${layer.name}" uses a chart type not supported by the installed renderer.`);
        errors.push(...chartRendererFeatureErrors(layer.element, to.manifest));
      }
    }
  }
  // A shared master can update inherited instances in other templates. Validate their
  // local chart options and catalog capacity before publishing either project or set.
  for (const template of projectSet?.templates ?? []) {
    if (template.id === activeTemplateId) continue;
    for (const composition of template.project.compositions) {
      let inheritsUpgrade = false;
      for (const layer of composition.layers) {
        const link = layer.componentLink;
        if (
          !link ||
          !sharedSources.get(link.componentId)?.has(link.sourceLayerId) ||
          layer.element.type !== 'chart' ||
          !layer.element.provider ||
          rendererPluginKey(layer.element.provider) !== sourceKey
        )
          continue;
        const baseline = link.baseline?.element;
        const explicitProvider = link.overridePaths?.some(
          (path) =>
            path === '/element' ||
            path === '/element/provider' ||
            path.startsWith('/element/provider/'),
        );
        const inferredProvider =
          baseline?.type === 'chart' &&
          baseline.provider &&
          rendererPluginKey(baseline.provider) !== sourceKey;
        if (explicitProvider || inferredProvider) {
          preservedOverrides++;
          continue;
        }
        sharedInstances++;
        inheritsUpgrade = true;
        if (layer.isLocked)
          errors.push(
            `Unlock "${layer.name}" in "${template.name}" before updating its shared renderer.`,
          );
        if (!to.manifest.presets.includes(layer.element.preset))
          errors.push(
            `"${layer.name}" in "${template.name}" uses a chart type not supported by the installed renderer.`,
          );
        errors.push(
          ...chartRendererFeatureErrors(layer.element, to.manifest).map(
            (error) => `${template.name}: ${error}`,
          ),
        );
      }
      const catalog = composition.rendererPlugins ?? [];
      if (
        inheritsUpgrade &&
        !catalog.some(
          (snapshot) =>
            rendererPluginKey(studioPluginReference(snapshot)) === rendererPluginKey(target),
        )
      ) {
        const total = [...catalog, to].reduce(
          (size, snapshot) =>
            size +
            rendererPluginByteLength(JSON.stringify(snapshot.manifest)) +
            rendererPluginByteLength(snapshot.source) +
            rendererPluginByteLength(snapshot.licenseText),
          0,
        );
        if (
          catalog.length >= MAX_RENDERER_PLUGIN_CATALOG_ENTRIES ||
          total > MAX_RENDERER_PLUGIN_CATALOG_BYTES
        )
          errors.push(
            `"${template.name}" cannot store another chart renderer. Remove an unused renderer first.`,
          );
      }
    }
  }
  if (!objects && !componentObjects) errors.push('No charts still use this saved renderer.');
  return {
    from,
    to,
    objects,
    componentObjects,
    sharedInstances,
    preservedOverrides,
    errors: [...new Set(errors)],
  };
}

/** Offer only installed, enabled, trusted same-ID candidates with equal or newer semver. */
export function chartRendererUpgradeOffers(
  project: Project,
  installed: readonly InstalledStudioPlugin[],
  projectSet?: ProjectSetDocument | null,
  activeTemplateId?: string | null,
): ChartRendererUpgradePlan[] {
  const saved = chartRendererReferences(project);
  return saved.flatMap((from) => {
    const candidates = installed
      .filter(isInstalledChartPlugin)
      .filter((entry) => entry.enabled && entry.trusted && entry.snapshot.manifest.id === from.id)
      .filter(
        (entry) =>
          rendererPluginKey(studioPluginReference(entry.snapshot)) !== rendererPluginKey(from),
      )
      .filter(
        (entry) => compareRendererVersions(entry.snapshot.manifest.version, from.version) >= 0,
      )
      .sort((a, b) =>
        compareRendererVersions(b.snapshot.manifest.version, a.snapshot.manifest.version),
      );
    const plans = candidates.map((entry) =>
      planChartRendererUpgrade(project, from, entry.snapshot, projectSet, activeTemplateId),
    );
    const compatible = plans.find((plan) => !plan.errors.length);
    return compatible ? [compatible] : plans.length ? [plans[0]!] : [];
  });
}

/** Project references are listed even if their saved bundle is missing or needs review. */
export function chartRendererReferences(project: Project): RendererPluginReference[] {
  const saved = new Map<string, RendererPluginReference>();
  for (const composition of project.compositions) {
    for (const layer of [
      ...composition.layers,
      ...composition.components.flatMap((item) => item.layers),
    ]) {
      if (
        layer.element.type === 'chart' &&
        layer.element.provider &&
        !validateRendererPluginReference(layer.element.provider).length
      )
        saved.set(rendererPluginKey(layer.element.provider), layer.element.provider);
    }
  }
  return [...saved.values()];
}
