import type { Composition, Layer, Project } from '@ograf-editor/scene-model';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const quoted = (value: string) => `“${value}”`;

function describeLayerChange(before: Layer, after: Layer): string {
  const name = quoted(after.name);
  if (before.name !== after.name) return `Rename ${quoted(before.name)} to ${name}`;
  if (!same(before.element, after.element)) return `Edit ${name} properties`;
  if (!same(before.effects, after.effects)) return `Edit ${name} effects`;
  if (
    !same(before.keyframes, after.keyframes) ||
    !same(before.animationTracks, after.animationTracks) ||
    !same(before.loop, after.loop)
  ) {
    return `Edit ${name} animation`;
  }
  if (
    before.isVisible !== after.isVisible ||
    before.isGuide !== after.isGuide ||
    before.isLocked !== after.isLocked ||
    before.blendMode !== after.blendMode ||
    before.groupId !== after.groupId ||
    before.parentId !== after.parentId ||
    before.clipChildren !== after.clipChildren ||
    !same(before.constraints, after.constraints)
  ) {
    return `Change ${name} layer settings`;
  }
  if (
    !same(before.bindings, after.bindings) ||
    !same(before.semantics, after.semantics) ||
    !same(before.designTokenBindings, after.designTokenBindings) ||
    !same(before.componentLink, after.componentLink)
  ) {
    return `Edit ${name} metadata`;
  }
  return `Edit ${name}`;
}

function describeCompositionChange(before: Composition, after: Composition): string {
  const beforeLayers = new Map(before.layers.map((layer) => [layer.id, layer]));
  const afterLayers = new Map(after.layers.map((layer) => [layer.id, layer]));
  const added = after.layers.filter((layer) => !beforeLayers.has(layer.id));
  const removed = before.layers.filter((layer) => !afterLayers.has(layer.id));
  if (added.length === 1 && removed.length === 0) return `Add ${quoted(added[0]!.name)}`;
  if (removed.length === 1 && added.length === 0) return `Delete ${quoted(removed[0]!.name)}`;
  if (added.length > 1 && removed.length === 0) return `Add ${added.length} layers`;
  if (removed.length > 1 && added.length === 0) return `Delete ${removed.length} layers`;
  if (added.length > 0 || removed.length > 0) return 'Replace layers';

  if (
    !same(
      before.layers.map((layer) => layer.id),
      after.layers.map((layer) => layer.id),
    )
  ) {
    return 'Reorder layers';
  }
  for (const layer of after.layers) {
    const previous = beforeLayers.get(layer.id);
    if (previous && !same(previous, layer)) return describeLayerChange(previous, layer);
  }

  if (before.name !== after.name) return `Rename composition to ${quoted(after.name)}`;
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.frameRate !== after.frameRate ||
    before.updateTransitionFrames !== after.updateTransitionFrames ||
    before.backgroundColor !== after.backgroundColor
  ) {
    return 'Change composition settings';
  }
  if (!same(before.layout, after.layout)) return 'Change canvas layout';
  if (!same(before.keyframes, after.keyframes) || !same(before.transitions, after.transitions)) {
    return 'Edit lifecycle timeline';
  }
  if (!same(before.dataFields, after.dataFields)) return 'Edit data fields';
  if (!same(before.assets, after.assets)) return 'Edit project resources';
  if (!same(before.designSystem, after.designSystem)) return 'Edit Brand Kit';
  if (!same(before.components, after.components)) return 'Edit components';
  if (!same(before.customActions, after.customActions)) return 'Edit custom actions';
  if (!same(before.runtimeCollections, after.runtimeCollections)) return 'Edit runtime collections';
  return 'Edit composition';
}

export function describeProjectChange(before: Project, after: Project): string {
  if (before.name !== after.name) return `Rename project to ${quoted(after.name)}`;
  if (!same(before.author, after.author)) return 'Edit project metadata';
  if (
    before.supportsRealTime !== after.supportsRealTime ||
    before.supportsNonRealTime !== after.supportsNonRealTime
  ) {
    return 'Change project render modes';
  }
  if (before.compositions.length !== after.compositions.length) return 'Change compositions';
  for (const composition of after.compositions) {
    const previous = before.compositions.find((candidate) => candidate.id === composition.id);
    if (!previous) return 'Change compositions';
    if (!same(previous, composition)) return describeCompositionChange(previous, composition);
  }
  return 'Edit project';
}
