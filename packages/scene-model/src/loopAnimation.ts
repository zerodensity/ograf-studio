import { getTrackValueAtFrame } from './layerAnimation';
import { parseShaderAnimationProperty, getShaderTrackValueAtFrame } from './shaderAnimation';
import type {
  AnimatableLayerProperty,
  LayerLoopClip,
  LayerPropertyKeyframe,
  Element,
} from './types';

/** Local clip position derived from absolute elapsed frames; never advances by mutable ticks. */
export function getLoopFrameAtElapsed(loop: LayerLoopClip, elapsedFrames: number): number {
  const duration = Math.max(1, Math.round(loop.durationFrames));
  const shifted = Math.max(0, elapsedFrames + Math.round(loop.phaseOffsetFrames));
  if (loop.repeatCount !== null && shifted >= duration * Math.max(1, loop.repeatCount)) {
    return duration;
  }
  return ((shifted % duration) + duration) % duration;
}

/** Map the playback ruler to authored frames, stretching holds and keeping changes at full speed. */
export function timedLoopElapsedFrames(
  loop: LayerLoopClip,
  elapsedFrames: number,
  frameRate: number,
  holdSeconds: unknown,
  inverse = false,
): number {
  if (
    !loop.timing ||
    typeof holdSeconds !== 'number' ||
    !Number.isFinite(holdSeconds) ||
    holdSeconds < 0
  )
    return elapsedFrames;
  const ranges = loop.timing.holdRanges;
  const holdFrames = Math.max(0, holdSeconds * frameRate);
  const total =
    loop.durationFrames -
    ranges.reduce((sum, range) => sum + range.endFrame - range.startFrame, 0) +
    holdFrames * ranges.length;
  if (total <= 0) return elapsedFrames;
  const sourceDuration = inverse ? loop.durationFrames : total;
  const targetDuration = inverse ? total : loop.durationFrames;
  const shifted = Math.max(0, elapsedFrames + loop.phaseOffsetFrames);
  const cycle = Math.floor(shifted / sourceDuration);
  let phase = shifted - cycle * sourceDuration;
  let source = 0;
  let target = 0;
  let authoredCursor = 0;
  for (const range of ranges) {
    const gap = range.startFrame - authoredCursor;
    if (phase < source + gap)
      return cycle * targetDuration + target + phase - source - loop.phaseOffsetFrames;
    source += gap;
    target += gap;
    const authoredLength = range.endFrame - range.startFrame;
    const fromLength = inverse ? authoredLength : holdFrames;
    const toLength = inverse ? holdFrames : authoredLength;
    if (phase < source + fromLength)
      return (
        cycle * targetDuration +
        target +
        (fromLength ? ((phase - source) * toLength) / fromLength : toLength) -
        loop.phaseOffsetFrames
      );
    source += fromLength;
    target += toLength;
    authoredCursor = range.endFrame;
  }
  return cycle * targetDuration + target + phase - source - loop.phaseOffsetFrames;
}

/** Advance from an authored position under the current hold duration without retiming a change. */
export function advanceTimedLoopElapsedFrames(
  loop: LayerLoopClip,
  authoredElapsedFrames: number,
  deltaFrames: number,
  frameRate: number,
  holdSeconds: unknown,
): number {
  return timedLoopElapsedFrames(
    loop,
    timedLoopElapsedFrames(loop, authoredElapsedFrames, frameRate, holdSeconds, true) +
      Math.max(0, deltaFrames),
    frameRate,
    holdSeconds,
  );
}

export function getLoopPropertyValueAtElapsed(
  loop: LayerLoopClip,
  property: AnimatableLayerProperty,
  elapsedFrames: number,
  fallback: number,
  element?: Element,
): number {
  if (element && parseShaderAnimationProperty(property))
    return getShaderTrackValueAtFrame(
      element,
      property,
      loop.tracks[property] ?? [],
      getLoopFrameAtElapsed(loop, elapsedFrames),
      fallback,
    );
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
