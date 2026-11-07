import { parseEditablePath, type PathPoint } from './pathEditing';
import type { LayerTransform, PathElement } from './types';
import { isAnimatedTextSegment, segmentTextAnimationUnits } from './textAnimation';

export interface TextPathSample {
  x: number;
  y: number;
  angle: number;
}
export interface TextPathGeometry {
  length: number;
  sample(distance: number): TextPathSample | null;
}

export interface PositionedTextPathUnit extends TextPathSample {
  /** The source unit index, including whitespace units. */
  index: number;
  width: number;
}

export interface TextPathSegmentPlacement {
  text: string;
  sourceIndex: number;
  animated: boolean;
  position: PositionedTextPathUnit | null;
}

/** Measure adjacent units so common pair kerning is retained with bounded work. */
export function layoutTextPathSegments(
  geometry: TextPathGeometry,
  source: string,
  split: 'grapheme' | 'word',
  measure: (prefix: string) => number,
  options: { language?: string; startOffset?: number; alignment?: 'start' | 'center' | 'end' } = {},
): TextPathSegmentPlacement[] {
  if (source.length > 4096) throw new Error('Text on a path is limited to 4,096 characters.');
  const records = segmentTextAnimationUnits(source, split, options.language);
  if (records.length > 512 || records.some((record) => record.text.length > 4096))
    throw new Error('Text on a path exceeds its segment limit.');
  if (records.some((record) => /[\r\n]/.test(record.text)))
    throw new Error('Text on a path currently supports one line.');
  let previous = '';
  const widths = records.map((record) => {
    const width = measure(previous + record.text) - (previous ? measure(previous) : 0);
    if (!Number.isFinite(width) || width < 0)
      throw new Error('Text path font measurements are invalid.');
    previous = record.text;
    return width;
  });
  const positions = layoutTextPathUnits(geometry, widths, options.startOffset, options.alignment);
  return records.map((record, index) => ({
    text: record.text,
    sourceIndex: record.index,
    animated: isAnimatedTextSegment(record, split),
    position: positions[index] ?? null,
  }));
}

/** Place measured text units by their centres, returning nulls for units outside the path. */
export function layoutTextPathUnits(
  geometry: TextPathGeometry,
  widths: readonly number[],
  startOffset = 0,
  alignment: 'start' | 'center' | 'end' = 'start',
): Array<PositionedTextPathUnit | null> {
  if (!Number.isFinite(startOffset) || widths.some((width) => !Number.isFinite(width) || width < 0))
    throw new Error('Text path offsets must be finite and widths must be finite and non-negative.');
  const total = widths.reduce((sum, width) => sum + width, 0);
  let cursor =
    startOffset +
    (alignment === 'center'
      ? (geometry.length - total) / 2
      : alignment === 'end'
        ? geometry.length - total
        : 0);
  return widths.map((width, index) => {
    const sample = geometry.sample(cursor + width / 2);
    cursor += width;
    return sample ? { ...sample, index, width } : null;
  });
}

/**
 * Resolve a path layer into the local coordinate system of a text layer.
 * Adaptive subdivision uses a fixed spatial tolerance, making seeks independent of frame order.
 */
export function createTextPathGeometry(
  path: PathElement,
  source: LayerTransform,
  text: LayerTransform,
  sourceScale = 1,
  textScale = 1,
): TextPathGeometry {
  if (
    !Number.isFinite(sourceScale) ||
    !Number.isFinite(textScale) ||
    sourceScale < 0 ||
    textScale <= 0
  )
    throw new Error('Text path scale must be finite and positive.');
  if (path.viewBoxWidth <= 0 || path.viewBoxHeight <= 0)
    throw new Error('Text path viewBox must be positive.');
  const contour = parseEditablePath(path.d)[0];
  if (!contour || contour.nodes.length < 2) throw new Error('Text path needs at least two points.');
  const sourceAngle = (source.rotation * Math.PI) / 180,
    targetAngle = (-text.rotation * Math.PI) / 180;
  const sourceOriginX = source.transformOriginX * source.width,
    sourceOriginY = source.transformOriginY * source.height;
  const targetOriginX = text.transformOriginX * text.width,
    targetOriginY = text.transformOriginY * text.height;
  const point = (p: PathPoint): PathPoint => {
    const x = (p.x / path.viewBoxWidth) * source.width - sourceOriginX;
    const y = (p.y / path.viewBoxHeight) * source.height - sourceOriginY;
    const worldX =
      source.x +
      sourceOriginX +
      sourceScale * (x * Math.cos(sourceAngle) - y * Math.sin(sourceAngle));
    const worldY =
      source.y +
      sourceOriginY +
      sourceScale * (x * Math.sin(sourceAngle) + y * Math.cos(sourceAngle));
    const dx = worldX - text.x - targetOriginX,
      dy = worldY - text.y - targetOriginY;
    const result = {
      x: targetOriginX + (dx * Math.cos(targetAngle) - dy * Math.sin(targetAngle)) / textScale,
      y: targetOriginY + (dx * Math.sin(targetAngle) + dy * Math.cos(targetAngle)) / textScale,
    };
    if (![result.x, result.y].every(Number.isFinite))
      throw new Error('Text path contains non-finite geometry.');
    return result;
  };
  const points: PathPoint[] = [point(contour.nodes[0]!)];
  const add = (p: PathPoint) => {
    const last = points.at(-1)!;
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) return;
    if (points.length >= 20_000) throw new Error('Text path geometry exceeds its sampling limit.');
    points.push(p);
  };
  const midpoint = (a: PathPoint, b: PathPoint): PathPoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const distanceToChord = (p: PathPoint, a: PathPoint, b: PathPoint) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return length < 1e-9
      ? Math.hypot(p.x - a.x, p.y - a.y)
      : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
  };
  const subdivide = (a: PathPoint, b: PathPoint, c: PathPoint, d: PathPoint, depth: number) => {
    const polygonLength =
      Math.hypot(b.x - a.x, b.y - a.y) +
      Math.hypot(c.x - b.x, c.y - b.y) +
      Math.hypot(d.x - c.x, d.y - c.y);
    const chordLength = Math.hypot(d.x - a.x, d.y - a.y);
    if (
      depth >= 12 ||
      (Math.max(distanceToChord(b, a, d), distanceToChord(c, a, d)) <= 0.2 &&
        polygonLength - chordLength <= 0.2)
    ) {
      add(d);
      return;
    }
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      cd = midpoint(c, d),
      abc = midpoint(ab, bc),
      bcd = midpoint(bc, cd),
      center = midpoint(abc, bcd);
    subdivide(a, ab, abc, center, depth + 1);
    subdivide(center, bcd, cd, d, depth + 1);
  };
  const segments = contour.nodes.length - (contour.closed ? 0 : 1);
  for (let i = 0; i < segments; i++) {
    const a = contour.nodes[i]!,
      d = contour.nodes[(i + 1) % contour.nodes.length]!;
    subdivide(point(a), point(a.out ?? a), point(d.in ?? d), point(d), 0);
  }
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(
      cumulative[i - 1]! +
        Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y),
    );
  const length = cumulative.at(-1)!;
  if (length <= 1e-9) throw new Error('Text path has no length.');
  return {
    length,
    sample(distance) {
      if (!Number.isFinite(distance) || distance < 0 || distance > length) return null;
      let low = 1,
        high = cumulative.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (cumulative[middle]! < distance) low = middle + 1;
        else high = middle;
      }
      const a = points[low - 1]!,
        b = points[low]!,
        span = cumulative[low]! - cumulative[low - 1]!,
        t = span > 0 ? (distance - cumulative[low - 1]!) / span : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    },
  };
}
