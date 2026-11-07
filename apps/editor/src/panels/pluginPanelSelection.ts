import {
  rendererPluginKey,
  studioPluginReference,
  type StudioPluginReference,
  type StudioPluginSnapshot,
} from '@ograf-editor/scene-model';
import {
  installedApplicationGroups,
  type InstalledApplicationGroup,
} from '../components/configurationApplications';
import type { InstalledStudioPlugin } from '../state/pluginSettingsStore';
import type { PluginPanelSelection } from '../state/configurationRequestStore';

export const PLUGIN_CATEGORIES = [
  { kind: 'animation-presets', label: 'Animation' },
  { kind: 'chart', label: 'Chart' },
  { kind: 'shader-pack', label: 'Shader' },
] as const satisfies readonly {
  kind: StudioPluginSnapshot['manifest']['kind'];
  label: string;
}[];

/** Browse one category without changing its installation, trust or exact version identities. */
export function pluginGroupsForCategory(
  groups: readonly InstalledApplicationGroup[],
  kind: StudioPluginSnapshot['manifest']['kind'],
  query = '',
): InstalledApplicationGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    if (group.kind !== kind) return false;
    const text = `${group.name} ${group.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Include pinned project bundles for explicit review, never as enabled/trusted installations. */
export function pluginPanelGroups(
  installed: readonly InstalledStudioPlugin[],
  required: readonly StudioPluginSnapshot[],
  defaultProvider: StudioPluginReference | null,
): InstalledApplicationGroup[] {
  const keys = new Set(
    installed.map((entry) => rendererPluginKey(studioPluginReference(entry.snapshot))),
  );
  const entries = [...installed];
  for (const snapshot of required) {
    const key = rendererPluginKey(studioPluginReference(snapshot));
    if (keys.has(key)) continue;
    keys.add(key);
    entries.push({ snapshot, installedAt: '', enabled: false, trusted: false });
  }
  return installedApplicationGroups(entries, defaultProvider);
}

export function requestedPluginGroup(
  groups: readonly InstalledApplicationGroup[],
  selection: PluginPanelSelection | null,
): InstalledApplicationGroup | undefined {
  return selection
    ? groups.find(
        (group) => group.id === selection.id && (!selection.kind || group.kind === selection.kind),
      )
    : undefined;
}

/** An exact version selector cannot accidentally borrow a snapshot from another application. */
export function pluginPanelVersion(
  group: InstalledApplicationGroup,
  key?: string,
): InstalledStudioPlugin {
  return (
    group.versions.find(
      (entry) => rendererPluginKey(studioPluginReference(entry.snapshot)) === key,
    ) ?? group.preferred
  );
}

export const PLUGIN_KIND_LABELS: Record<StudioPluginSnapshot['manifest']['kind'], string> = {
  chart: 'Charts',
  'animation-presets': 'Animation presets',
  'shader-pack': 'Shader pack',
};
