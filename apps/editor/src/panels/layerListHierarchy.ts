export interface LayerRelationship {
  id: string;
  parentId: string | null;
}

export type LayerDropIntent = 'before' | 'parent' | 'after';

export function layerIndentDepth(layers: readonly LayerRelationship[], layerId: string): number {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const visited = new Set<string>([layerId]);
  let depth = 0;
  let parentId = byId.get(layerId)?.parentId ?? null;
  while (parentId && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    visited.add(parentId);
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

export function layerDropIntent(
  pointerY: number,
  rowTop: number,
  rowHeight: number,
): LayerDropIntent {
  const ratio = rowHeight > 0 ? (pointerY - rowTop) / rowHeight : 0.5;
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'parent';
}

export function canAssignLayerParent(
  layers: readonly LayerRelationship[],
  layerId: string,
  parentId: string,
): boolean {
  if (layerId === parentId) return false;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  if (!byId.has(layerId) || !byId.has(parentId)) return false;
  const visited = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId) {
    if (currentId === layerId || visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = byId.get(currentId)?.parentId ?? null;
  }
  return true;
}

export function reorderLayerDisplayOrder(
  displayOrder: readonly string[],
  draggedId: string,
  targetId: string,
  intent: 'before' | 'after',
): string[] {
  if (draggedId === targetId) return [...displayOrder];
  const remaining = displayOrder.filter((id) => id !== draggedId);
  const targetIndex = remaining.indexOf(targetId);
  if (targetIndex < 0 || !displayOrder.includes(draggedId)) return [...displayOrder];
  remaining.splice(targetIndex + (intent === 'after' ? 1 : 0), 0, draggedId);
  return remaining;
}
