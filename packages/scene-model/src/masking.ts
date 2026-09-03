import type { Composition, ElementType, Layer, LayerMask, LayerTransform } from './types';

export const ALPHA_MASK_SOURCE_TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'path',
  'image',
  'pattern',
];
export const PATH_MASK_SOURCE_TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'path',
  'pattern',
];

export function maskSourceSupportsMode(source: Layer, mode: LayerMask['mode']): boolean {
  return (mode === 'path' ? PATH_MASK_SOURCE_TYPES : ALPHA_MASK_SOURCE_TYPES).includes(
    source.element.type,
  );
}

export function layerMaskErrors(composition: Composition): string[] {
  const errors: string[] = [];
  const byId = new Map(composition.layers.map((layer) => [layer.id, layer]));
  const owner = new Map(
    composition.runtimeCollections.flatMap((c) =>
      c.prototypeLayerIds.map((id) => [id, c.id] as const),
    ),
  );
  for (const layer of composition.layers) {
    if (!layer.mask) continue;
    const { sourceLayerId, mode, inverted } = layer.mask;
    const source = byId.get(sourceLayerId);
    if (!['alpha', 'path'].includes(mode) || typeof inverted !== 'boolean')
      errors.push(`Layer "${layer.name}" has an invalid mask mode or inversion.`);
    if (!source) {
      errors.push(`Layer "${layer.name}" mask source is missing: ${sourceLayerId}.`);
      continue;
    }
    if (source.isGuide)
      errors.push(`Layer "${layer.name}" cannot use guide "${source.name}" as a mask source.`);
    if (!maskSourceSupportsMode(source, mode))
      errors.push(
        `Layer "${layer.name}" ${mode} mask does not support ${source.element.type} source "${source.name}".`,
      );
    if (owner.get(layer.id) !== owner.get(source.id))
      errors.push(
        `Layer "${layer.name}" mask source must belong to the same runtime collection prototype, or both must be outside collections.`,
      );
    const seen = new Set([layer.id]);
    let current: Layer | undefined = source;
    while (current) {
      if (seen.has(current.id)) {
        errors.push(`Layer "${layer.name}" has a cyclic mask dependency.`);
        break;
      }
      seen.add(current.id);
      current = current.mask ? byId.get(current.mask.sourceLayerId) : undefined;
    }
  }
  return errors;
}

/** Fail before removal rather than unexpectedly revealing a previously masked graphic. */
export function assertMaskSourcesRemovable(
  composition: Composition,
  removedIds: ReadonlySet<string>,
): void {
  const consumers = composition.layers.filter(
    (l) => !removedIds.has(l.id) && l.mask && removedIds.has(l.mask.sourceLayerId),
  );
  if (consumers.length)
    throw new Error(
      `Detach masks from ${consumers.map((l) => `"${l.name}"`).join(', ')} before deleting their source, or delete source and consumers together.`,
    );
}

export type AffineMatrix = [number, number, number, number, number, number];
export function transformMatrix(t: LayerTransform): AffineMatrix {
  const angle = (t.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ox = t.width * t.transformOriginX,
    oy = t.height * t.transformOriginY;
  return [c, s, -s, c, t.x + ox - c * ox + s * oy, t.y + oy - s * ox - c * oy];
}
export function relativeTransformMatrix(
  source: LayerTransform,
  target: LayerTransform,
): AffineMatrix {
  const [a, b, c, d, e, f] = transformMatrix(source),
    [u, v, w, x, y, z] = transformMatrix(target);
  const determinant = u * x - v * w;
  return [
    (x * a - w * b) / determinant,
    (-v * a + u * b) / determinant,
    (x * c - w * d) / determinant,
    (-v * c + u * d) / determinant,
    (x * (e - y) - w * (f - z)) / determinant,
    (-v * (e - y) + u * (f - z)) / determinant,
  ];
}
