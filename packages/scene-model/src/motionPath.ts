import { parseEditablePath, type PathPoint } from './pathEditing';
import type { LayerMotionPath, LayerTransform, PathElement } from './types';

const cubic = (a: PathPoint, b: PathPoint, c: PathPoint, d: PathPoint, t: number): PathPoint => {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  };
};

export function sampleMotionPath(element: PathElement, progress: number) {
  const contour = parseEditablePath(element.d)[0];
  if (!contour || contour.nodes.length < 2)
    throw new Error('Motion path needs at least two points.');
  const samples: PathPoint[] = [];
  const segmentCount = contour.nodes.length - (contour.closed ? 0 : 1);
  for (let index = 0; index < segmentCount; index++) {
    const a = contour.nodes[index]!,
      d = contour.nodes[(index + 1) % contour.nodes.length]!,
      b = a.out ?? a,
      c = d.in ?? d;
    for (let step = 0; step <= 24; step++) {
      if (index > 0 && step === 0) continue;
      samples.push(cubic(a, b, c, d, step / 24));
    }
  }
  const lengths = samples
    .slice(1)
    .map((point, index) => Math.hypot(point.x - samples[index]!.x, point.y - samples[index]!.y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const wanted = Math.max(0, Math.min(1, progress)) * total;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (travelled + length >= wanted || index === lengths.length - 1) {
      const a = samples[index]!,
        b = samples[index + 1]!,
        t = length > 0 ? (wanted - travelled) / length : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    travelled += length;
  }
  return { ...samples[0]!, angle: 0 };
}

export function attachTransformToMotionPath(
  target: LayerTransform,
  source: LayerTransform,
  element: PathElement,
  link: LayerMotionPath,
  progress = link.progress,
): LayerTransform {
  const point = sampleMotionPath(element, progress);
  const localX = (point.x / element.viewBoxWidth) * source.width;
  const localY = (point.y / element.viewBoxHeight) * source.height;
  const originX = source.transformOriginX * source.width;
  const originY = source.transformOriginY * source.height;
  const radians = (source.rotation * Math.PI) / 180;
  const dx = localX - originX,
    dy = localY - originY;
  const x = source.x + originX + dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = source.y + originY + dx * Math.sin(radians) + dy * Math.cos(radians);
  // The path is stretched from its viewBox into the source layer before rotation. Its
  // tangent must undergo the same nonuniform stretch as its points before adding a base angle.
  const tangent = (point.angle * Math.PI) / 180;
  const tangentAngle =
    (Math.atan2(
      (Math.sin(tangent) * source.height) / element.viewBoxHeight,
      (Math.cos(tangent) * source.width) / element.viewBoxWidth,
    ) *
      180) /
    Math.PI;
  return {
    ...target,
    x: x - target.transformOriginX * target.width + link.offsetX,
    y: y - target.transformOriginY * target.height + link.offsetY,
    rotation: link.orientToPath
      ? tangentAngle + source.rotation + (link.rotationOffset ?? 0)
      : target.rotation,
  };
}
