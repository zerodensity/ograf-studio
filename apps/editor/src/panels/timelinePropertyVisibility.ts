import {
  getLayerAnimatableProperties,
  getResolvedLayerAnimationTracks,
  type AnimatableLayerProperty,
  type Layer,
} from '@ograf-editor/scene-model';

/** Compatibility keys with identical values at lifecycle frames do not make a useful UI track. */
export function isTimelinePropertyMeaningful(
  layer: Layer,
  property: AnimatableLayerProperty,
  lifecycleFrames: ReadonlySet<number>,
): boolean {
  if ((layer.loop?.tracks[property]?.length ?? 0) > 0) return true;
  const keys = getResolvedLayerAnimationTracks(layer)[property] ?? [];
  if (keys.some((keyframe) => !lifecycleFrames.has(keyframe.frame))) return true;
  const firstValue = keys[0]?.value;
  return (
    firstValue !== undefined && keys.some((keyframe) => !Object.is(keyframe.value, firstValue))
  );
}

export function meaningfulTimelineProperties(
  layer: Layer,
  lifecycleFrames: ReadonlySet<number>,
): AnimatableLayerProperty[] {
  return getLayerAnimatableProperties(layer).filter((property) =>
    isTimelinePropertyMeaningful(layer, property, lifecycleFrames),
  );
}
