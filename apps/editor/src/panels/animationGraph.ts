import {
  cubicBezierProgress,
  easedProgress,
  sortLayerPropertyKeyframes,
  type LayerPropertyKeyframe,
} from '@ograf-editor/scene-model';

export interface AnimationGraphBounds {
  minFrame: number;
  maxFrame: number;
  minValue: number;
  maxValue: number;
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface TimelineGraphViewport {
  scrollLeft: number;
  width: number;
  pixelsPerFrame: number;
}

/** The numeric inverse of SVG.getScreenCTM(), including viewBox scaling and letterboxing. */
export type GraphScreenInverse = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>;

export interface AnimationGraphDrag {
  bounds: AnimationGraphBounds;
  sample(point: GraphPoint): { frame: number; value: number };
}

/** Keep one pointer gesture in its original coordinates even while its preview changes extrema. */
export function createAnimationGraphDrag(
  key: Pick<LayerPropertyKeyframe, 'frame' | 'value'>,
  bounds: AnimationGraphBounds,
  inverse: GraphScreenInverse,
  pointer: GraphPoint,
  width: number,
  height: number,
  padding = 16,
): AnimationGraphDrag {
  const frozenBounds = { ...bounds };
  const startFrame = key.frame;
  const startValue = key.value;
  const { a, b, c, d, e, f } = inverse;
  const toGraph = ({ x, y }: GraphPoint) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  const startPointer = toGraph(pointer);
  const startKey = graphCoordinates(key.frame, key.value, frozenBounds, width, height, padding);
  return {
    bounds: frozenBounds,
    sample(point) {
      const pointer = toGraph(point);
      const dx = pointer.x - startPointer.x;
      const dy = pointer.y - startPointer.y;
      const x = Math.max(padding, Math.min(width - padding, startKey.x + dx));
      const y = Math.max(padding, Math.min(height - padding, startKey.y + dy));
      return {
        frame: Math.round(
          startFrame +
            ((x - startKey.x) / (width - padding * 2)) *
              (frozenBounds.maxFrame - frozenBounds.minFrame),
        ),
        value:
          startValue -
          ((y - startKey.y) / (height - padding * 2)) *
            (frozenBounds.maxValue - frozenBounds.minValue),
      };
    },
  };
}

export function animationGraphBounds(
  keys: readonly Pick<LayerPropertyKeyframe, 'frame' | 'value'>[],
  durationFrames: number,
): AnimationGraphBounds {
  let minValue = Infinity,
    maxValue = -Infinity;
  let maxFrame = Math.max(1, durationFrames);
  for (const key of keys) {
    minValue = Math.min(minValue, key.value);
    maxValue = Math.max(maxValue, key.value);
    maxFrame = Math.max(maxFrame, key.frame);
  }
  if (!Number.isFinite(minValue)) minValue = 0;
  if (!Number.isFinite(maxValue)) maxValue = 1;
  if (minValue === maxValue) {
    const padding = Math.max(1, Math.abs(minValue) * 0.1);
    minValue -= padding;
    maxValue += padding;
  } else {
    const padding = (maxValue - minValue) * 0.1;
    minValue -= padding;
    maxValue += padding;
  }
  return {
    minFrame: 0,
    maxFrame,
    minValue,
    maxValue,
  };
}

/** The graph shares the timeline's horizontal viewport; its values keep their own scale. */
export function timelineGraphBounds(
  keys: readonly Pick<LayerPropertyKeyframe, 'frame' | 'value'>[],
  durationFrames: number,
  viewport: TimelineGraphViewport,
): AnimationGraphBounds {
  const pixelsPerFrame =
    Number.isFinite(viewport.pixelsPerFrame) && viewport.pixelsPerFrame > 0
      ? viewport.pixelsPerFrame
      : 1;
  const width = Number.isFinite(viewport.width) ? Math.max(1, viewport.width) : 1;
  const scrollLeft = Number.isFinite(viewport.scrollLeft) ? Math.max(0, viewport.scrollLeft) : 0;
  return {
    ...animationGraphBounds(keys, durationFrames),
    minFrame: scrollLeft / pixelsPerFrame,
    maxFrame: (scrollLeft + width) / pixelsPerFrame,
  };
}

export function graphCoordinates(
  frame: number,
  value: number,
  bounds: AnimationGraphBounds,
  width: number,
  height: number,
  padding = 16,
) {
  return {
    x:
      padding +
      ((frame - bounds.minFrame) / (bounds.maxFrame - bounds.minFrame)) * (width - padding * 2),
    y:
      height -
      padding -
      ((value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * (height - padding * 2),
  };
}

export function animationGraphPath(
  keys: LayerPropertyKeyframe[],
  bounds: AnimationGraphBounds,
  width: number,
  height: number,
  padding = 16,
  range?: Pick<AnimationGraphBounds, 'minFrame' | 'maxFrame'>,
): string {
  if (keys.length === 0) return '';
  // A composition can end inside the viewport. Clip samples to its authored interval without
  // remapping that interval onto the entire viewport width or extending the held value past Out.
  const minFrame = Math.max(bounds.minFrame, range?.minFrame ?? bounds.minFrame);
  const maxFrame = Math.min(bounds.maxFrame, range?.maxFrame ?? bounds.maxFrame);
  if (minFrame > maxFrame) return '';
  const sorted = sortLayerPropertyKeyframes(keys);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  // Sampling is bounded by visible pixels, never by the duration of a long template. Include
  // exact key positions too, so a short transition or the end of a hold is not rounded away.
  const sampleWidth =
    ((width - padding * 2) * (maxFrame - minFrame)) / (bounds.maxFrame - bounds.minFrame);
  const intervals = Math.max(1, Math.min(4_096, Math.ceil(sampleWidth)));
  const frames = new Set(
    Array.from(
      { length: intervals + 1 },
      (_, index) => minFrame + ((maxFrame - minFrame) * index) / intervals,
    ),
  );
  for (const key of sorted)
    if (key.frame >= minFrame && key.frame <= maxFrame) frames.add(key.frame);
  let nextIndex = 1;
  return [...frames]
    .sort((left, right) => left - right)
    .map((frame, index) => {
      let value: number;
      if (frame <= first.frame) value = first.value;
      else if (frame >= last.frame) value = last.value;
      else {
        while (sorted[nextIndex]!.frame < frame) nextIndex++;
        const next = sorted[nextIndex]!;
        const previous = sorted[nextIndex - 1]!;
        const rawProgress = (frame - previous.frame) / (next.frame - previous.frame);
        const progress = next.curve
          ? cubicBezierProgress(rawProgress, next.curve)
          : easedProgress(rawProgress, next.easing);
        value =
          next.frame === frame
            ? next.value
            : previous.value + (next.value - previous.value) * progress;
      }
      const point = graphCoordinates(frame, value, bounds, width, height, padding);
      return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(' ');
}
