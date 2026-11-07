import { rendererPluginKey, type RendererPluginReference } from '@ograf-editor/scene-model';
import type { InstalledStudioPlugin } from '../state/pluginSettingsStore';

export interface PluginToolGroup {
  id: string;
  label: string;
  kind: InstalledStudioPlugin['snapshot']['manifest']['kind'];
  versions: InstalledStudioPlugin[];
  preferred: InstalledStudioPlugin;
}

/** One tool per provider id; choosing a tool never silently changes the user's global default. */
export function groupPluginTools(
  installed: readonly InstalledStudioPlugin[],
  defaultProvider: RendererPluginReference | null,
): PluginToolGroup[] {
  const groups = new Map<string, InstalledStudioPlugin[]>();
  for (const entry of installed) {
    if (!entry.enabled || !entry.trusted) continue;
    const id = entry.snapshot.manifest.id;
    const versions = groups.get(id) ?? [];
    versions.push(entry);
    groups.set(id, versions);
  }
  const key = (entry: InstalledStudioPlugin) =>
    rendererPluginKey({ ...entry.snapshot.manifest, sha256: entry.snapshot.sha256 });
  return [...groups]
    .map(([id, entries]) => {
      const versions = [...entries].sort(
        (left, right) =>
          right.installedAt.localeCompare(left.installedAt) ||
          key(right).localeCompare(key(left), undefined, { numeric: true }),
      );
      const preferred =
        versions[0]!.snapshot.manifest.kind === 'chart' && defaultProvider?.id === id
          ? (versions.find((entry) => key(entry) === rendererPluginKey(defaultProvider)) ??
            versions[0]!)
          : versions[0]!;
      return {
        id,
        kind: preferred.snapshot.manifest.kind,
        label: preferred.snapshot.manifest.name,
        preferred,
        versions,
      };
    })
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );
}

/** Icons are inert embedded raster assets. JavaScript, SVG and remote image URLs are excluded. */
export function safePluginIcon(icon: unknown): string | undefined {
  return typeof icon === 'string' &&
    /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(icon) &&
    icon.length <= 44_000
    ? icon
    : undefined;
}
