import {
  layerModifierGeometryReferences,
  layerModifiersErrors,
  remapLayerModifierReferences,
} from './modifiers';
import type { Layer } from './types';

/** Deleting an owner removes its own references; surviving consumers must be retargeted first. */
export function assertModifierSourcesRemovable(
  composition: { layers: readonly Layer[] },
  removed: ReadonlySet<string>,
): void {
  for (const owner of composition.layers) {
    if (removed.has(owner.id)) continue;
    for (const reference of layerModifierGeometryReferences(owner)) {
      const missing =
        reference.kind === 'layer'
          ? removed.has(reference.layerId)
          : composition.layers.some((layer) => layer.groupId === reference.groupId) &&
            !composition.layers.some(
              (layer) => layer.groupId === reference.groupId && !removed.has(layer.id),
            );
      if (missing)
        throw new Error(
          `Retarget or remove the modifier on "${owner.name}" before removing its referenced ${reference.kind}.`,
        );
    }
  }
}

/** Copies must not turn a referenced complete group into a smaller or wider group. */
export function assertModifierGroupCopySafe(
  composition: { layers: readonly Layer[] },
  sources: readonly Layer[],
  flattenGroups = false,
): void {
  const selected = new Set(sources.map((layer) => layer.id));
  for (const owner of sources)
    for (const reference of layerModifierGeometryReferences(owner)) {
      if (reference.kind !== 'group') continue;
      const members = composition.layers.filter((layer) => layer.groupId === reference.groupId);
      const copiedMembers = members.filter((layer) => selected.has(layer.id));
      if (!copiedMembers.length) continue; // Deliberate external reference stays external.
      if (copiedMembers.length !== members.length)
        throw new Error(`Copy the complete referenced group for modifier on "${owner.name}".`);
      if (flattenGroups && copiedMembers.length !== sources.length)
        throw new Error(
          'Duplicating this selection would widen a modifier subgroup reference to the whole copied group. Copy only that complete group or retarget the modifier first.',
        );
    }
}

/**
 * A pure rename of a complete group's identity follows references. Losing a group's last member
 * through an ungroup/merge is rejected rather than silently changing the affected artwork.
 */
export function applyModifierSafeGroupChanges(
  layers: Layer[],
  changes: ReadonlyMap<string, string | null>,
): void {
  const groupMap = new Map<string, string>();
  const references = new Set(
    layers.flatMap((owner) =>
      layerModifierGeometryReferences(owner).flatMap((reference) =>
        reference.kind === 'group' ? [reference.groupId] : [],
      ),
    ),
  );
  const nextGroup = (layer: Layer) =>
    changes.has(layer.id) ? changes.get(layer.id)! : layer.groupId;
  for (const groupId of references) {
    if (layers.some((layer) => nextGroup(layer) === groupId)) continue;
    const before = layers.filter((layer) => layer.groupId === groupId);
    if (!before.length) continue;
    const target = nextGroup(before[0]!);
    const after = target ? layers.filter((layer) => nextGroup(layer) === target) : [];
    if (
      !target ||
      after.length !== before.length ||
      before.some((layer) => nextGroup(layer) !== target)
    )
      throw new Error(
        'Retarget or remove modifiers referencing this group before ungrouping or merging its last members.',
      );
    groupMap.set(groupId, target);
  }
  const projected = layers.map((layer) => ({
    ...layer,
    groupId: nextGroup(layer),
    ...(layer.modifiers
      ? { modifiers: remapLayerModifierReferences(layer.modifiers, { groups: groupMap })! }
      : {}),
  }));
  const errors = layerModifiersErrors(projected);
  if (errors.length) throw new Error(errors.join(' '));
  for (const layer of layers) {
    if (changes.has(layer.id)) layer.groupId = changes.get(layer.id)!;
    if (groupMap.size && layer.modifiers)
      layer.modifiers = remapLayerModifierReferences(layer.modifiers, { groups: groupMap })!;
    const baseline = layer.componentLink?.baseline;
    if (groupMap.size && baseline?.modifiers)
      baseline.modifiers = remapLayerModifierReferences(baseline.modifiers, { groups: groupMap })!;
  }
}
