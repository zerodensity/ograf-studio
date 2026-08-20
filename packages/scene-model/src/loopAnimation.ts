import { getTrackValueAtFrame } from './layerAnimation';
import type { AnimatableLayerProperty, LayerLoopClip, LayerPropertyKeyframe } from './types';

/** Local clip position derived from absolute elapsed frames; never advances by mutable ticks. */
export function getLoopFrameAtElapsed(loop: LayerLoopClip, elapsedFrames: number): number {
  const duration = Math.max(1, Math.round(loop.durationFrames));
  const shifted = Math.max(0, elapsedFrames + Math.round(loop.phaseOffsetFrames));
  if (loop.repeatCount !== null && shifted >= duration * Math.max(1, loop.repeatCount)) {
    return duration;
  }
  return ((shifted % duration) + duration) % duration;
}

export function getLoopPropertyValueAtElapsed(
  loop: LayerLoopClip,
  property: AnimatableLayerProperty,
  elapsedFrames: number,
  fallback: number,
): number {
  return getTrackValueAtFrame(
    (loop.tracks[property] ?? []) as LayerPropertyKeyframe[],
    getLoopFrameAtElapsed(loop, elapsedFrames),
    fallback,
  );
}

export function loopHasProperty(
  loop: LayerLoopClip | null | undefined,
  property: AnimatableLayerProperty,
): boolean {
  return (loop?.tracks[property]?.length ?? 0) > 0;
}
