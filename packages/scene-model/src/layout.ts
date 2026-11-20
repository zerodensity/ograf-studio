import {
  normalizeAuthoredPixelValue,
  PIXEL_TRANSFORM_KEYS,
  type PixelTransformKey,
} from './authoredTransform';
import type { Layer, LayerConstraints, LayerResizeBasis, LayerTransform } from './types';

type CanvasSize = { width: number; height: number };
type Constraint = LayerConstraints[keyof LayerConstraints];
type ResizeSource = { canvasSize: number; value: number };

const geometryChannels: Record<
  PixelTransformKey,
  {
    axis: keyof LayerConstraints;
    dimension: keyof CanvasSize;
    offsets: Partial<Record<Constraint, number>>;
  }
> = {
  x: { axis: 'horizontal', dimension: 'width', offsets: { right: 1, center: 0.5 } },
  y: { axis: 'vertical', dimension: 'height', offsets: { bottom: 1, center: 0.5 } },
  width: { axis: 'horizontal', dimension: 'width', offsets: { 'left-right': 1 } },
  height: { axis: 'vertical', dimension: 'height', offsets: { 'top-bottom': 1 } },
};

function projectGeometry(
  value: number,
  from: number,
  to: number,
  constraint: Constraint,
  offset: number,
): number {
  return constraint === 'scale' ? value * (to / from) : value + (to - from) * offset;
}

/** Resolves one pose against a new canvas without changing its source. */
export function resizeConstrainedTransform(
  pose: LayerTransform,
  constraints: LayerConstraints,
  oldSize: CanvasSize,
  newSize: CanvasSize,
): LayerTransform {
  const next = { ...pose };
  for (const property of PIXEL_TRANSFORM_KEYS) {
    const { axis, dimension, offsets } = geometryChannels[property];
    const constraint = constraints[axis];
    const offset = offsets[constraint];
    if (
      oldSize[dimension] === newSize[dimension] ||
      (constraint !== 'scale' && offset === undefined)
    )
      continue;
    next[property] = normalizeAuthoredPixelValue(
      property,
      projectGeometry(
        pose[property],
        oldSize[dimension],
        newSize[dimension],
        constraint,
        offset ?? 0,
      ),
    );
  }
  return next;
}

/** Resizes the existing pose and property keys, keeping their timing, easing and identities. */
export function resizeConstrainedLayer(
  layer: Layer,
  oldSize: CanvasSize,
  newSize: CanvasSize,
): void {
  const nextBasis: LayerResizeBasis = { ...layer.resizeBasis };
  for (const property of PIXEL_TRANSFORM_KEYS) {
    const { axis, dimension, offsets } = geometryChannels[property];
    const from = oldSize[dimension];
    const to = newSize[dimension];
    if (from === to) continue;
    const constraint = layer.constraints[axis];
    const offset = offsets[constraint] ?? 0;
    const previous = nextBasis[property];
    delete nextBasis[property];
    if (constraint !== 'scale' && offset === 0) continue;
    const basis =
      previous?.constraint === constraint && previous.canvasSize === from ? previous : undefined;
    const poses = new Map<string, ResizeSource>();
    const keys = new Map<string, ResizeSource>();

    const resize = (
      value: number,
      id: string,
      sources: Map<string, ResizeSource>,
      saved?: ResizeSource,
    ): number => {
      // Reuse the source only while the projected value still matches the authored key.
      const source =
        saved &&
        Number.isFinite(saved.canvasSize) &&
        saved.canvasSize > 0 &&
        Number.isFinite(saved.value) &&
        ((property !== 'width' && property !== 'height') || saved.value > 0) &&
        value ===
          normalizeAuthoredPixelValue(
            property,
            projectGeometry(saved.value, saved.canvasSize, from, constraint, offset),
          )
          ? saved
          : { canvasSize: from, value };
      const projected = projectGeometry(source.value, source.canvasSize, to, constraint, offset);
      const baked =
        to === source.canvasSize ? source.value : normalizeAuthoredPixelValue(property, projected);
      if (baked !== projected) sources.set(id, { ...source });
      return baked;
    };

    for (const key of layer.keyframes) {
      key.transform[property] = resize(
        key.transform[property],
        key.id,
        poses,
        basis?.poses?.[key.id],
      );
    }
    for (const key of layer.animationTracks[property] ?? []) {
      // A legacy full-pose track can be materialized on reopen using the derived key ID.
      const suffix = `:${property}`;
      const poseId =
        layer.animationTrackMode !== 'independent' && key.id.endsWith(suffix)
          ? key.id.slice(0, -suffix.length)
          : undefined;
      const saved =
        basis?.keys?.[key.id] ?? (poseId === undefined ? undefined : basis?.poses?.[poseId]);
      key.value = resize(key.value, key.id, keys, saved);
    }
    if (poses.size || keys.size) {
      nextBasis[property] = {
        constraint,
        canvasSize: to,
        poses: Object.fromEntries(poses),
        keys: Object.fromEntries(keys),
      };
    }
  }
  if (Object.keys(nextBasis).length) layer.resizeBasis = nextBasis;
  else if (layer.resizeBasis) delete layer.resizeBasis;
}
