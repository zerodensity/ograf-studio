import {
  defaultTransformFor,
  getLayerTransformAtFrame,
  polygonBounds,
  transformBoundsPolygon,
  type Composition,
  type NewLayerKind,
} from '@ograf-editor/scene-model';
import { isPersistentGroupSelection } from './groupSelection';

export interface CanvasInsertion {
  x: number;
  y: number;
  groupId?: string;
  parentId?: string;
}

/** Find the nearest clear chart-sized rectangle on the canvas, when one exists. */
function avoidExistingCharts(
  composition: Composition,
  frame: number,
  size: { width: number; height: number },
  desired: CanvasInsertion,
): CanvasInsertion {
  const maxX = composition.width - size.width;
  const maxY = composition.height - size.height;
  if (maxX < 0 || maxY < 0) return desired;
  const charts = composition.layers
    .filter((layer) => layer.element.type === 'chart' && layer.isVisible)
    .flatMap((layer) => {
      const pose = getLayerTransformAtFrame(layer, frame);
      const bounds = polygonBounds(transformBoundsPolygon(pose), pose);
      return bounds ? [bounds] : [];
    });
  if (!charts.length) return desired;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const xs = new Set([
    clamp(desired.x, maxX),
    ...charts.flatMap((p) => [clamp(p.x - size.width, maxX), clamp(p.x + p.width, maxX)]),
  ]);
  const ys = new Set([
    clamp(desired.y, maxY),
    ...charts.flatMap((p) => [clamp(p.y - size.height, maxY), clamp(p.y + p.height, maxY)]),
  ]);
  const candidates = [...xs].flatMap((x) => [...ys].map((y) => ({ x, y })));
  candidates.sort(
    (a, b) =>
      (a.x - desired.x) ** 2 +
      (a.y - desired.y) ** 2 -
      ((b.x - desired.x) ** 2 + (b.y - desired.y) ** 2),
  );
  return (
    candidates.find(({ x, y }) =>
      charts.every(
        (p) =>
          x + size.width <= p.x ||
          x >= p.x + p.width ||
          y + size.height <= p.y ||
          y >= p.y + p.height,
      ),
    ) ?? desired
  );
}

/** Locate a new item in composition coordinates, respecting zoom and viewport pan. */
export function canvasInsertion(
  root: Element | null,
  composition: Composition,
  kind: NewLayerKind,
  selectedIds: string[],
  frame: number,
  sizeOverride?: { width: number; height: number },
): CanvasInsertion {
  const size = sizeOverride ?? defaultTransformFor(kind);
  const selected = composition.layers.filter((layer) => selectedIds.includes(layer.id));
  if (isPersistentGroupSelection(composition, selectedIds)) {
    const poses = selected.map((layer) => getLayerTransformAtFrame(layer, frame));
    const left = Math.min(...poses.map((pose) => pose.x));
    const top = Math.min(...poses.map((pose) => pose.y));
    const right = Math.max(...poses.map((pose) => pose.x + pose.width));
    const bottom = Math.max(...poses.map((pose) => pose.y + pose.height));
    return {
      x: (left + right - size.width) / 2,
      y: (top + bottom - size.height) / 2,
      groupId: selected[0]!.groupId!,
    };
  }
  if (selected.length === 1 && selected[0]!.clipChildren) {
    const parent = selected[0]!;
    const pose = getLayerTransformAtFrame(parent, frame);
    return {
      x: pose.x + (pose.width - size.width) / 2,
      y: pose.y + (pose.height - size.height) / 2,
      parentId: parent.id,
    };
  }
  const viewport = root?.querySelector('.canvas-stage-viewport')?.getBoundingClientRect();
  const pasteboard = root?.querySelector('.canvas-stage-pasteboard')?.getBoundingClientRect();
  const zoom = pasteboard && composition.width > 0 ? pasteboard.width / composition.width : 0;
  const centerX =
    viewport && pasteboard && zoom > 0
      ? (viewport.left + viewport.width / 2 - pasteboard.left) / zoom
      : composition.width / 2;
  const centerY =
    viewport && pasteboard && zoom > 0
      ? (viewport.top + viewport.height / 2 - pasteboard.top) / zoom
      : composition.height / 2;
  const desired = { x: centerX - size.width / 2, y: centerY - size.height / 2 };
  return kind === 'chart' ? avoidExistingCharts(composition, frame, size, desired) : desired;
}
