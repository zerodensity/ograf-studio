import {
  rendererPluginKey,
  studioPluginReference,
  validateRendererPluginReference,
  validateRendererPluginSnapshot,
  walkElementContents,
  type Layer,
  type Project,
  type RendererPluginReference,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { chartRendererUpgradeOffers } from './chartRendererUpgrade';
import { isInstalledChartPlugin, type InstalledStudioPlugin } from './pluginSettingsStore';
import type { ProjectSetDocument } from './projectSet';

export type PluginLoadWarningReason =
  | 'unconfigured'
  | 'invalid-reference'
  | 'missing-bundle'
  | 'invalid-bundle'
  | 'not-installed'
  | 'disabled'
  | 'untrusted'
  | 'content-mismatch';

export interface PluginLoadWarning {
  key: string;
  templateId: string | null;
  templateName: string;
  projectId: string;
  reference: RendererPluginReference | null;
  pluginName: string;
  reason: PluginLoadWarningReason;
  objects: number;
  componentObjects: number;
  /** Only an installed, enabled, trusted candidate whose complete migration preflight passed. */
  replacement: RendererPluginReference | null;
  replacementErrors: string[];
}

interface WarningInput {
  project: Project;
  projectSet?: ProjectSetDocument | null;
  activeTemplateId?: string | null;
  installed: readonly InstalledStudioPlugin[];
  initialized: boolean;
  loading?: boolean;
}

function canonicalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalMetadata(child)]),
    );
  return value;
}

/** Match Studio's exact-byte execution policy without reading or changing its global store. */
function sameBundle(saved: RendererPluginSnapshot, local: RendererPluginSnapshot): boolean {
  return (
    saved.source === local.source &&
    saved.licenseText === local.licenseText &&
    JSON.stringify(canonicalMetadata(saved.manifest)) ===
      JSON.stringify(canonicalMetadata(local.manifest))
  );
}

function blockingReason(
  reference: RendererPluginReference,
  saved: RendererPluginSnapshot | undefined,
  installed: readonly InstalledStudioPlugin[],
): PluginLoadWarningReason | null {
  if (!saved) return 'missing-bundle';
  const key = rendererPluginKey(reference);
  const exact = installed
    .filter(isInstalledChartPlugin)
    .filter((entry) => rendererPluginKey(studioPluginReference(entry.snapshot)) === key);
  const matching = exact.filter((entry) => sameBundle(saved, entry.snapshot));
  // The installed catalog is verified on initialization. Exact trusted bytes follow the same
  // fast policy path as rendering, without hashing a multi-megabyte bundle on every text edit.
  if (matching.some((entry) => entry.enabled && entry.trusted)) return null;
  if (validateRendererPluginSnapshot(saved).length) return 'invalid-bundle';
  if (!exact.length) return 'not-installed';
  if (!matching.length) return 'content-mismatch';
  if (!matching.some((entry) => entry.trusted)) return 'untrusted';
  return 'disabled';
}

/** Blocking chart requirements only: an optional upgrade never interrupts a usable document. */
export function collectPluginLoadWarnings({
  project,
  projectSet,
  activeTemplateId,
  installed,
  initialized,
  loading,
}: WarningInput): PluginLoadWarning[] {
  if (!initialized || loading) return [];
  // One saved snapshot can serve many chart instances and prototypes. Reuse its policy result
  // only within this scan; a new scan always observes the current installed/trust preferences.
  const reasons = new Map<RendererPluginSnapshot, Map<string, PluginLoadWarningReason | null>>();
  const reasonFor = (
    reference: RendererPluginReference,
    saved: RendererPluginSnapshot | undefined,
  ) => {
    if (!saved) return 'missing-bundle' as const;
    const key = rendererPluginKey(reference);
    let byReference = reasons.get(saved);
    if (byReference?.has(key)) return byReference.get(key)!;
    if (!byReference) reasons.set(saved, (byReference = new Map()));
    const reason = blockingReason(reference, saved, installed);
    byReference.set(key, reason);
    return reason;
  };
  const templates = projectSet
    ? projectSet.templates.map((template) => ({
        id: template.id,
        name: template.name,
        project:
          template.id === activeTemplateId && template.project.id === project.id
            ? project
            : template.project,
      }))
    : [{ id: null, name: project.name, project }];
  const warnings: PluginLoadWarning[] = [];
  for (const template of templates) {
    // A usable document needs no migration preflight. Defer snapshot hashing until a blocked
    // reference needs an offer; healthy live-data edits stay on the cheap execution-policy path.
    let offers: ReturnType<typeof chartRendererUpgradeOffers> | undefined;
    const collected = new Map<string, PluginLoadWarning>();
    const inspect = (layer: Layer, component: boolean, catalog: RendererPluginSnapshot[]) => {
      for (const element of walkElementContents(layer.element)) {
        if (element.type !== 'chart') continue;
        const provider = element.provider;
        const valid = provider && !validateRendererPluginReference(provider).length;
        const reference = valid ? provider : null;
        const sourceKey = reference ? rendererPluginKey(reference) : '';
        const saved = reference
          ? catalog.find(
              (snapshot) =>
                snapshot?.manifest?.id === reference.id &&
                snapshot.manifest.version === reference.version &&
                snapshot.sha256 === reference.sha256,
            )
          : undefined;
        const reason = !provider
          ? 'unconfigured'
          : !reference
            ? 'invalid-reference'
            : reasonFor(reference, saved);
        if (!reason) continue;
        const key = JSON.stringify([template.id ?? template.project.id, sourceKey, reason]);
        let warning = collected.get(key);
        if (!warning) {
          if (reference)
            offers ??= chartRendererUpgradeOffers(
              template.project,
              installed,
              projectSet,
              template.id,
            );
          const offer = reference
            ? offers?.find((plan) => rendererPluginKey(plan.from) === sourceKey)
            : undefined;
          warning = {
            key,
            templateId: template.id,
            templateName: template.name,
            projectId: template.project.id,
            reference,
            pluginName: saved?.manifest.name ?? reference?.id ?? 'Chart renderer',
            reason,
            objects: 0,
            componentObjects: 0,
            replacement: offer && !offer.errors.length ? studioPluginReference(offer.to) : null,
            replacementErrors: offer?.errors ?? [],
          };
          collected.set(key, warning);
        }
        if (component) warning.componentObjects++;
        else warning.objects++;
      }
    };
    for (const composition of template.project.compositions) {
      // Runtime collection prototypes remain ordinary authored layers in this list.
      const catalog = composition.rendererPlugins ?? [];
      for (const layer of composition.layers) inspect(layer, false, catalog);
      for (const component of composition.components)
        for (const layer of component.layers)
          inspect(layer, true, component.context?.rendererPlugins ?? catalog);
    }
    warnings.push(...collected.values());
  }
  return warnings;
}

/** Stable across frame, selection and ordinary data edits; no plugin source is serialized. */
export function pluginLoadWarningSignature(warnings: readonly PluginLoadWarning[]): string {
  return JSON.stringify(
    warnings
      .map((warning) => [
        warning.key,
        warning.objects,
        warning.componentObjects,
        warning.replacement ? rendererPluginKey(warning.replacement) : null,
        warning.replacementErrors,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}
