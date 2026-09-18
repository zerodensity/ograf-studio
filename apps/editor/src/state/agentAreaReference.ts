import type { AgentAreaReference } from '@ograf-editor/agent-tools/chat-references';
import { MAX_AREA_POLYGON_POINTS } from '@ograf-editor/agent-tools/chat-references';

export interface AreaPoint {
  x: number;
  y: number;
}

/** Sample in screen-pixel increments and bound long gestures without cutting off their end. */
export function appendFreehandPoint(points: AreaPoint[], point: AreaPoint, distance: number) {
  const last = points.at(-1);
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < distance) return points;
  const retained =
    points.length >= MAX_AREA_POLYGON_POINTS
      ? points.filter((_, index) => index % 2 === 0)
      : points;
  return [...retained, point];
}

export function freehandAreaFromPoints(
  points: AreaPoint[],
  width: number,
  height: number,
): Pick<AgentAreaReference, 'rect' | 'polygon'> | null {
  const polygon = points.map(({ x, y }) => ({
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
  }));
  if (polygon.length < 3) return null;
  const first = polygon[0]!;
  const farthest = polygon.reduce((a, b) =>
    Math.hypot(a.x - first.x, a.y - first.y) > Math.hypot(b.x - first.x, b.y - first.y) ? a : b,
  );
  // Reject clicks and straight strokes, but allow self-crossing lasso outlines.
  const baseline = Math.hypot(farthest.x - first.x, farthest.y - first.y);
  if (
    !baseline ||
    !polygon.some(
      (p) =>
        Math.abs(
          (farthest.x - first.x) * (p.y - first.y) - (farthest.y - first.y) * (p.x - first.x),
        ) /
          baseline >=
        1,
    )
  )
    return null;
  const rect = areaRectFromPoints(
    { x: Math.min(...polygon.map((p) => p.x)), y: Math.min(...polygon.map((p) => p.y)) },
    { x: Math.max(...polygon.map((p) => p.x)), y: Math.max(...polygon.map((p) => p.y)) },
    width,
    height,
  );
  return rect.width >= 2 && rect.height >= 2 ? { rect, polygon } : null;
}

/** Convert a drag on the fitted image to integer composition coordinates, in either direction. */
export function areaRectFromPoints(
  start: AreaPoint,
  end: AreaPoint,
  width: number,
  height: number,
): AgentAreaReference['rect'] {
  const x = Math.floor(Math.max(0, Math.min(width, start.x, end.x)));
  const y = Math.floor(Math.max(0, Math.min(height, start.y, end.y)));
  const right = Math.ceil(Math.max(0, Math.min(width, Math.max(start.x, end.x))));
  const bottom = Math.ceil(Math.max(0, Math.min(height, Math.max(start.y, end.y))));
  return { x, y, width: right - x, height: bottom - y };
}

export async function cropAreaImage(
  image: HTMLImageElement,
  rect: AgentAreaReference['rect'],
  compositionWidth: number,
  compositionHeight: number,
  polygon?: AreaPoint[],
): Promise<AgentAreaReference['image']> {
  const scale = Math.min(1, 1024 / Math.max(rect.width, rect.height));
  const canvas = image.ownerDocument.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image capture is unavailable.');
  if (polygon?.length) {
    context.beginPath();
    polygon.forEach((point, index) => {
      const x = ((point.x - rect.x) / rect.width) * canvas.width;
      const y = ((point.y - rect.y) / rect.height) * canvas.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.clip('evenodd');
  }
  context.drawImage(
    image,
    (rect.x * image.naturalWidth) / compositionWidth,
    (rect.y * image.naturalHeight) / compositionHeight,
    (rect.width * image.naturalWidth) / compositionWidth,
    (rect.height * image.naturalHeight) / compositionHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const data = canvas.toDataURL('image/png').split(',')[1]!;
  if (data.length > 6_000_000) throw new Error('This area is too large. Select a smaller area.');
  return { mimeType: 'image/png', data, width: canvas.width, height: canvas.height };
}
