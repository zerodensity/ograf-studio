import type { LayerTransform } from './types';
import { clampCornerRadii, type CornerRadiiInput } from './cornerRadii';

export interface GeometryPoint {
  x: number;
  y: number;
}

const EPSILON = 0.000001;
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const pointText = (point: GeometryPoint) => `${rounded(point.x)} ${rounded(point.y)}`;

function localToWorld(point: GeometryPoint, transform: LayerTransform): GeometryPoint {
  const originX = transform.transformOriginX * transform.width;
  const originY = transform.transformOriginY * transform.height;
  const radians = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - originX;
  const y = point.y - originY;
  return {
    x: transform.x + originX + x * cosine - y * sine,
    y: transform.y + originY + x * sine + y * cosine,
  };
}

function worldToLocal(point: GeometryPoint, transform: LayerTransform): GeometryPoint {
  const originX = transform.transformOriginX * transform.width;
  const originY = transform.transformOriginY * transform.height;
  const radians = (-transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - transform.x - originX;
  const y = point.y - transform.y - originY;
  return {
    x: originX + x * cosine - y * sine,
    y: originY + x * sine + y * cosine,
  };
}

export function transformBoundsPolygon(transform: LayerTransform): GeometryPoint[] {
  return [
    { x: 0, y: 0 },
    { x: transform.width, y: 0 },
    { x: transform.width, y: transform.height },
    { x: 0, y: transform.height },
  ].map((point) => localToWorld(point, transform));
}

function parentPointInChild(
  point: GeometryPoint,
  child: LayerTransform,
  parent: LayerTransform,
): GeometryPoint {
  return worldToLocal(localToWorld(point, parent), child);
}

/** SVG path in the child's local coordinate system for a transformed rounded parent rectangle. */
export function clipPathSvgForParentBounds(
  child: LayerTransform,
  parent: LayerTransform,
  borderRadius: CornerRadiiInput = 0,
): string {
  const radius = clampCornerRadii(borderRadius, parent.width, parent.height);
  const convert = (x: number, y: number) => parentPointInChild({ x, y }, child, parent);
  const topLeftStart = convert(radius.topLeft, 0);
  const topRightStart = convert(parent.width - radius.topRight, 0);
  const topRightControl = convert(parent.width, 0);
  const topRightEnd = convert(parent.width, radius.topRight);
  const bottomRightStart = convert(parent.width, parent.height - radius.bottomRight);
  const bottomRightControl = convert(parent.width, parent.height);
  const bottomRightEnd = convert(parent.width - radius.bottomRight, parent.height);
  const bottomLeftStart = convert(radius.bottomLeft, parent.height);
  const bottomLeftControl = convert(0, parent.height);
  const bottomLeftEnd = convert(0, parent.height - radius.bottomLeft);
  const topLeftEdge = convert(0, radius.topLeft);
  const topLeftControl = convert(0, 0);

  if (Object.values(radius).every((value) => value <= EPSILON)) {
    const corners = [
      convert(0, 0),
      convert(parent.width, 0),
      convert(parent.width, parent.height),
      convert(0, parent.height),
    ];
    return `M ${corners.map(pointText).join(' L ')} Z`;
  }
  return [
    `M ${pointText(topLeftStart)}`,
    `L ${pointText(topRightStart)}`,
    `Q ${pointText(topRightControl)} ${pointText(topRightEnd)}`,
    `L ${pointText(bottomRightStart)}`,
    `Q ${pointText(bottomRightControl)} ${pointText(bottomRightEnd)}`,
    `L ${pointText(bottomLeftStart)}`,
    `Q ${pointText(bottomLeftControl)} ${pointText(bottomLeftEnd)}`,
    `L ${pointText(topLeftEdge)}`,
    `Q ${pointText(topLeftControl)} ${pointText(topLeftStart)}`,
    'Z',
  ].join(' ');
}

/** CSS clipping path for a parent rectangle expressed in the transformed child's local box. */
export function clipPathForParentBounds(
  child: LayerTransform,
  parent: LayerTransform,
  borderRadius: CornerRadiiInput = 0,
): string {
  return `path("${clipPathSvgForParentBounds(child, parent, borderRadius)}")`;
}

function cross(a: GeometryPoint, b: GeometryPoint, point: GeometryPoint): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function lineIntersection(
  start: GeometryPoint,
  end: GeometryPoint,
  clipStart: GeometryPoint,
  clipEnd: GeometryPoint,
): GeometryPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const clipDx = clipEnd.x - clipStart.x;
  const clipDy = clipEnd.y - clipStart.y;
  const denominator = dx * clipDy - dy * clipDx;
  if (Math.abs(denominator) <= EPSILON) return end;
  const t = ((clipStart.x - start.x) * clipDy - (clipStart.y - start.y) * clipDx) / denominator;
  return { x: start.x + t * dx, y: start.y + t * dy };
}

/** Convex polygon intersection used by clipping-aware diagnostics and broadcast lint. */
export function intersectConvexPolygons(
  subject: GeometryPoint[],
  clip: GeometryPoint[],
): GeometryPoint[] {
  let output = [...subject];
  for (let index = 0; index < clip.length; index++) {
    const clipStart = clip[index]!;
    const clipEnd = clip[(index + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;
    let start = input.at(-1)!;
    for (const end of input) {
      const startInside = cross(clipStart, clipEnd, start) >= -EPSILON;
      const endInside = cross(clipStart, clipEnd, end) >= -EPSILON;
      if (endInside) {
        if (!startInside) output.push(lineIntersection(start, end, clipStart, clipEnd));
        output.push(end);
      } else if (startInside) {
        output.push(lineIntersection(start, end, clipStart, clipEnd));
      }
      start = end;
    }
  }
  return output;
}

export function polygonBounds(
  polygon: GeometryPoint[],
  source: LayerTransform,
): LayerTransform | null {
  if (polygon.length === 0) return null;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  if (right - x <= EPSILON || bottom - y <= EPSILON) return null;
  return { ...source, x, y, width: right - x, height: bottom - y, rotation: 0 };
}

export function intersectTransformBounds(
  bounds: LayerTransform,
  clip: LayerTransform,
): LayerTransform | null {
  return polygonBounds(
    intersectConvexPolygons(transformBoundsPolygon(bounds), transformBoundsPolygon(clip)),
    bounds,
  );
}

export function isTransformClippedBy(bounds: LayerTransform, clip: LayerTransform): boolean {
  const subject = transformBoundsPolygon(bounds);
  const intersection = intersectConvexPolygons(subject, transformBoundsPolygon(clip));
  if (intersection.length !== subject.length) return true;
  return subject.some(
    (point, index) =>
      Math.abs(point.x - intersection[index]!.x) > EPSILON ||
      Math.abs(point.y - intersection[index]!.y) > EPSILON,
  );
}
