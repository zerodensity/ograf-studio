import { getLayerTransformAtFrame, type Composition } from '@ograf-editor/scene-model';
import { onAirFrame } from '../state/onAirFrame';

export interface RepeatPreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Match the materialized repeater's first-Step bounds and stride without changing the project. */
export function repeatPreview(
  composition: Composition,
  selectedIds: string[],
  count: number,
  direction: 'horizontal' | 'vertical',
  gap: number,
): { boxes: RepeatPreviewBox[]; outsideTitleSafe: boolean } {
  const selected = composition.layers.filter((layer) => selectedIds.includes(layer.id));
  if (!selected.length) return { boxes: [], outsideTitleSafe: false };
  const poses = selected.map((layer) => getLayerTransformAtFrame(layer, onAirFrame(composition)));
  const x = Math.min(...poses.map((pose) => pose.x));
  const y = Math.min(...poses.map((pose) => pose.y));
  const width = Math.max(...poses.map((pose) => pose.x + pose.width)) - x;
  const height = Math.max(...poses.map((pose) => pose.y + pose.height)) - y;
  const stride = (direction === 'horizontal' ? width : height) + Math.max(0, gap);
  const boxes = Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
    x: x + (direction === 'horizontal' ? stride * (index + 1) : 0),
    y: y + (direction === 'vertical' ? stride * (index + 1) : 0),
    width,
    height,
  }));
  const safeX = composition.width * 0.05;
  const safeY = composition.height * 0.05;
  return {
    boxes,
    outsideTitleSafe: boxes.some(
      (box) =>
        box.x < safeX ||
        box.y < safeY ||
        box.x + box.width > composition.width - safeX ||
        box.y + box.height > composition.height - safeY,
    ),
  };
}
