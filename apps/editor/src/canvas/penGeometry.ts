import { serializeEditablePath, type PathAnchor, type PathPoint } from '@ograf-editor/scene-model';

export function constrainPenAngle(origin: PathPoint, point: PathPoint): PathPoint {
  const dx = point.x - origin.x,
    dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
  return { x: origin.x + length * Math.cos(angle), y: origin.y + length * Math.sin(angle) };
}

export function penPath(nodes: PathAnchor[], closed: boolean) {
  if (nodes.length < (closed ? 3 : 2)) throw new Error('Not enough points to draw a path.');
  const points = nodes.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]);
  // Open strokes need room in the viewBox so their ends and edges are not clipped.
  const padding = closed ? 0 : 2;
  const x = Math.min(...points.map((p) => p.x)) - padding,
    y = Math.min(...points.map((p) => p.y)) - padding;
  const width = Math.max(1, Math.max(...points.map((p) => p.x)) + padding - x);
  const height = Math.max(1, Math.max(...points.map((p) => p.y)) + padding - y);
  const offset = (p: PathPoint) => ({ x: p.x - x, y: p.y - y });
  const normalized = nodes.map((n) => ({
    ...offset(n),
    ...(n.in ? { in: offset(n.in) } : {}),
    ...(n.out ? { out: offset(n.out) } : {}),
  }));
  return { x, y, width, height, closed, d: serializeEditablePath([{ nodes: normalized, closed }]) };
}
