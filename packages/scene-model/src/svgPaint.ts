import { roundedRectangleSvgPath } from './cornerRadii';
import type { Element, Paint } from './types';

export const escapeSvgAttribute = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** SVG paint for masks/diagnostic vectors; geometry uses the authored box, not its bounding path. */
export function svgPaint(
  paint: Paint,
  width: number,
  height: number,
  id: string,
): { defs: string; fill: string } {
  if (typeof paint === 'string') return { defs: '', fill: escapeSvgAttribute(paint) };
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset);
  const content = stops
    .map(
      (s) =>
        `<stop offset="${s.offset}" stop-color="${escapeSvgAttribute(s.color)}" stop-opacity="${s.opacity}"/>`,
    )
    .join('');
  const fill = `url(#${id})`;
  if (paint.type === 'radial')
    return {
      fill,
      defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${width / 2}" cy="${height / 2}" r="${Math.hypot(width, height) / 2}">${content}</radialGradient>`,
    };
  if (paint.type === 'linear') {
    const angle = (paint.angle * Math.PI) / 180,
      dx = Math.sin(angle),
      dy = -Math.cos(angle),
      length = Math.abs(width * dx) + Math.abs(height * dy);
    return {
      fill,
      defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${width / 2 - (dx * length) / 2}" y1="${height / 2 - (dy * length) / 2}" x2="${width / 2 + (dx * length) / 2}" y2="${height / 2 + (dy * length) / 2}">${content}</linearGradient>`,
    };
  }
  // SVG has no conic-gradient element. Deterministic sub-degree wedges retain conic alpha,
  // including animated stop positions, without foreignObject (unsupported inside SVG masks).
  const cx = width / 2,
    cy = height / 2,
    r = Math.hypot(width, height),
    wedges: string[] = [];
  const count = 720;
  for (let i = 0; i < count; i++) {
    const offset = (i + 0.5) / count;
    const upper = stops.findIndex((s) => s.offset >= offset);
    const b = stops[upper < 0 ? stops.length - 1 : upper]!;
    const a = stops[Math.max(0, upper < 0 ? stops.length - 1 : upper - 1)]!;
    const t =
      a === b
        ? 0
        : Math.max(0, Math.min(1, (offset - a.offset) / Math.max(1e-12, b.offset - a.offset)));
    const color =
      a.color === b.color
        ? a.color
        : `color-mix(in srgb, ${a.color} ${(1 - t) * 100}%, ${b.color} ${t * 100}%)`;
    const angle = ((paint.angle - 90 + (i * 360) / count) * Math.PI) / 180;
    const end = angle + (2 * Math.PI) / count + 0.000001;
    wedges.push(
      `<path d="M${cx} ${cy} L${cx + Math.cos(angle) * r} ${cy + Math.sin(angle) * r} A${r} ${r} 0 0 1 ${cx + Math.cos(end) * r} ${cy + Math.sin(end) * r} Z" fill="${escapeSvgAttribute(color)}" fill-opacity="${a.opacity + (b.opacity - a.opacity) * t}"/>`,
    );
  }
  return {
    fill,
    defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${width}" height="${height}">${wedges.join('')}</pattern>`,
  };
}

export function svgMaskSourceContent(
  element: Element,
  width: number,
  height: number,
  id: string,
  pathOnly = false,
): string {
  if (element.type === 'image')
    return !pathOnly && element.src
      ? `<image width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="${escapeSvgAttribute(element.src)}"/>`
      : '';
  if (element.type !== 'path' && element.type !== 'rectangle' && element.type !== 'ellipse')
    return '';
  const paint = svgPaint(pathOnly ? '#ffffff' : element.fill, width, height, `${id}-paint`);
  const stroke = pathOnly ? 'none' : escapeSvgAttribute(element.strokeColor);
  const strokeWidth = pathOnly ? 0 : element.strokeWidth;
  let shape: string;
  if (element.type === 'path') {
    const d = escapeSvgAttribute(element.d),
      rule = escapeSvgAttribute(element.fillRule ?? 'nonzero'),
      scale = `scale(${width / element.viewBoxWidth} ${height / element.viewBoxHeight})`;
    shape = `<defs>${paint.defs}<clipPath id="${id}-path"><path transform="${scale}" d="${d}" clip-rule="${rule}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${paint.fill}" clip-path="url(#${id}-path)"/><path transform="${scale}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    return shape;
  }
  if (element.type === 'rectangle')
    shape = `<path d="${roundedRectangleSvgPath(width, height, element.borderRadius)}" fill="${paint.fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  else
    shape = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${paint.fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  return `<defs>${paint.defs}</defs>${shape}`;
}

export function pathMaskImage(element: Extract<Element, { type: 'path' }>): string {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${element.viewBoxWidth} ${element.viewBoxHeight}" preserveAspectRatio="none"><path d="${escapeSvgAttribute(element.d)}" fill="white" fill-rule="${element.fillRule ?? 'nonzero'}"/></svg>`)}")`;
}
