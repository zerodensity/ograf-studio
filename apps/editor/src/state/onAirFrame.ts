import { computeKeyframeFrames, type Composition } from '@ograf-editor/scene-model';

/** The first operator hold is the useful default pose for authoring. */
export function onAirFrame(composition: Composition): number {
  const step = composition.keyframes.find((keyframe) => keyframe.role === 'step');
  if (!step) return 0;
  return (
    computeKeyframeFrames(composition).find((entry) => entry.keyframeId === step.id)?.frame ?? 0
  );
}
