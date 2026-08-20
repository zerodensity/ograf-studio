import type { Layer, TimelineFolder } from '@ograf-editor/scene-model';

export type TimelineEntry =
  { kind: 'folder'; folder: TimelineFolder } | { kind: 'layer'; layer: Layer };

/**
 * Produces timeline-only row ordering. Group members stay in their original relative paint order;
 * the composition layer array itself is never reordered.
 */
export function buildTimelineEntries(
  layersTopToBottom: Layer[],
  folders: TimelineFolder[],
  collapsedFolderIds: ReadonlySet<string>,
): TimelineEntry[] {
  const folderByLayerId = new Map<string, TimelineFolder>();
  for (const folder of folders) {
    for (const layerId of folder.layerIds) folderByLayerId.set(layerId, folder);
  }

  const emittedFolders = new Set<string>();
  const entries: TimelineEntry[] = [];
  for (const layer of layersTopToBottom) {
    const folder = folderByLayerId.get(layer.id);
    if (!folder) {
      entries.push({ kind: 'layer', layer });
      continue;
    }
    if (emittedFolders.has(folder.id)) continue;
    emittedFolders.add(folder.id);
    entries.push({ kind: 'folder', folder });
    if (collapsedFolderIds.has(folder.id)) continue;
    for (const member of layersTopToBottom) {
      if (folder.layerIds.includes(member.id)) entries.push({ kind: 'layer', layer: member });
    }
  }
  return entries;
}
