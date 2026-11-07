import type { Composition, Layer, Project } from '@ograf-editor/scene-model';

/** Preserve cheap shared subtrees on local edits while still comparing cloned remote documents. */
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return JSON.stringify(left) === JSON.stringify(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++)
      if (!same(left[index] ?? null, right[index] ?? null)) return false;
    return true;
  }
  if ('toJSON' in left || 'toJSON' in right) return JSON.stringify(left) === JSON.stringify(right);
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const jsonKeys = (value: Record<string, unknown>) =>
    Object.keys(value).filter(
      (key) => !['undefined', 'function', 'symbol'].includes(typeof value[key]),
    );
  const aKeys = jsonKeys(a),
    bKeys = jsonKeys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && same(a[key], b[key]))
  );
}
const quoted = (value: string) => `“${value}”`;

function describeLayerChange(before: Layer, after: Layer): string {
  const name = quoted(after.name);
  if (before.name !== after.name) return `Rename ${quoted(before.name)} to ${name}`;
  if (!same(before.element, after.element)) return `Edit ${name} properties`;
  if (!same(before.effects, after.effects)) return `Edit ${name} effects`;
  const withoutPosition = (layer: Layer) => ({
    keyframes: layer.keyframes.map((keyframe) => {
      const { x: _x, y: _y, ...transform } = keyframe.transform;
      return { ...keyframe, transform };
    }),
    tracks: Object.fromEntries(
      Object.entries(layer.animationTracks).filter(([key]) => key !== 'x' && key !== 'y'),
    ),
    loop: layer.loop,
  });
  if (
    (!same(before.animationTracks.x, after.animationTracks.x) ||
      !same(before.animationTracks.y, after.animationTracks.y) ||
      !same(
        before.keyframes.map((key) => [key.transform.x, key.transform.y]),
        after.keyframes.map((key) => [key.transform.x, key.transform.y]),
      )) &&
    same(withoutPosition(before), withoutPosition(after))
  )
    return `Move ${name}`;
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
    !same(before.constraints, after.constraints) ||
    !same(before.autoLayout, after.autoLayout)
  ) {
    return `Change ${name} layer settings`;
  }
  if (
    !same(before.bindings, after.bindings) ||
    !same(before.visualRules, after.visualRules) ||
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
  if (!same(before.mediaCues, after.mediaCues)) return 'Edit media cues';
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
