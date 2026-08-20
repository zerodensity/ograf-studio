import type { LayerTransform } from '@ograf-editor/scene-model';
export { resizeConstrainedTransform } from '@ograf-editor/scene-model';

export type AlignmentMode =
  'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom';
export type DistributionMode = 'horizontal' | 'vertical';

export function alignedPatches(
  items: Array<{ id: string; pose: LayerTransform }>,
  mode: AlignmentMode,
): Map<string, Partial<LayerTransform>> {
  const result = new Map<string, Partial<LayerTransform>>();
  if (items.length < 2) return result;
  const left = Math.min(...items.map((item) => item.pose.x));
  const right = Math.max(...items.map((item) => item.pose.x + item.pose.width));
  const top = Math.min(...items.map((item) => item.pose.y));
  const bottom = Math.max(...items.map((item) => item.pose.y + item.pose.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  for (const item of items) {
    if (mode === 'left') result.set(item.id, { x: left });
    if (mode === 'horizontal-center') result.set(item.id, { x: centerX - item.pose.width / 2 });
    if (mode === 'right') result.set(item.id, { x: right - item.pose.width });
    if (mode === 'top') result.set(item.id, { y: top });
    if (mode === 'vertical-center') result.set(item.id, { y: centerY - item.pose.height / 2 });
    if (mode === 'bottom') result.set(item.id, { y: bottom - item.pose.height });
  }
  return result;
}

export function distributedPatches(
  items: Array<{ id: string; pose: LayerTransform }>,
  mode: DistributionMode,
): Map<string, Partial<LayerTransform>> {
  const result = new Map<string, Partial<LayerTransform>>();
  if (items.length < 3) return result;
  const sorted = [...items].sort((a, b) =>
    mode === 'horizontal' ? a.pose.x - b.pose.x : a.pose.y - b.pose.y,
  );
  const first = sorted[0]!.pose;
  const last = sorted.at(-1)!.pose;
  const start = mode === 'horizontal' ? first.x : first.y;
  const end = mode === 'horizontal' ? last.x + last.width : last.y + last.height;
  const occupied = sorted.reduce(
    (sum, item) => sum + (mode === 'horizontal' ? item.pose.width : item.pose.height),
    0,
  );
  const gap = (end - start - occupied) / (sorted.length - 1);
  let cursor = start;
  for (const item of sorted) {
    result.set(item.id, mode === 'horizontal' ? { x: cursor } : { y: cursor });
    cursor += (mode === 'horizontal' ? item.pose.width : item.pose.height) + gap;
  }
  return result;
}

export interface SnapOptions {
  threshold: number;
  gridSize?: number;
  verticalGuides: number[];
  horizontalGuides: number[];
  bounds?: { width: number; height: number };
}

function nearestDelta(values: number[], targets: number[], threshold: number): number {
  let best = 0;
  let distance = threshold + 1;
  for (const value of values) {
    for (const target of targets) {
      const delta = target - value;
      if (Math.abs(delta) < distance) {
        best = delta;
        distance = Math.abs(delta);
      }
    }
  }
  return distance <= threshold ? best : 0;
}

export function snapLayerPosition(
  pose: Pick<LayerTransform, 'x' | 'y' | 'width' | 'height'>,
  options: SnapOptions,
): { x: number; y: number } {
  const vertical = [...options.verticalGuides];
  const horizontal = [...options.horizontalGuides];
  if (options.gridSize && options.gridSize > 0) {
    for (const value of [pose.x, pose.x + pose.width / 2, pose.x + pose.width]) {
      vertical.push(Math.round(value / options.gridSize) * options.gridSize);
    }
    for (const value of [pose.y, pose.y + pose.height / 2, pose.y + pose.height]) {
      horizontal.push(Math.round(value / options.gridSize) * options.gridSize);
    }
  }
  let x =
    pose.x +
    nearestDelta(
      [pose.x, pose.x + pose.width / 2, pose.x + pose.width],
      vertical,
      options.threshold,
    );
  let y =
    pose.y +
    nearestDelta(
      [pose.y, pose.y + pose.height / 2, pose.y + pose.height],
      horizontal,
      options.threshold,
    );
  if (options.bounds) {
    x = Math.max(0, Math.min(options.bounds.width - pose.width, x));
    y = Math.max(0, Math.min(options.bounds.height - pose.height, y));
  }
  return { x: Math.round(x), y: Math.round(y) };
}
