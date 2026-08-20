import { computeKeyframeFrames, type Composition } from '@ograf-editor/scene-model';

const FRAME_EPSILON = 0.001;

/** Returns the next pausable OGraf Step strictly after the current playhead. */
export function nextOgrafStepFrame(
  composition: Composition,
  currentFrame: number,
): number | undefined {
  const frameByKeyframeId = new Map(
    computeKeyframeFrames(composition).map(({ keyframeId, frame }) => [keyframeId, frame]),
  );
  return composition.keyframes
    .filter((keyframe) => keyframe.role === 'step')
    .map((keyframe) => frameByKeyframeId.get(keyframe.id))
    .filter((frame): frame is number => frame !== undefined && frame > currentFrame + FRAME_EPSILON)
    .sort((left, right) => left - right)[0];
}
