import {
  getLayerAnimatableProperties,
  getResolvedLayerAnimationTracks,
  parseShaderAnimationProperty,
  type AnimatableLayerProperty,
  type Layer,
  type LayerAnimationTracks,
  type LayerKeyframe,
} from '@ograf-editor/scene-model';

/** Runtime resolution synthesizes static channels; the authoring UI shows only enabled tracks. */
export function timelineAnimationTracks(layer: Layer): LayerAnimationTracks {
  if (layer.animationTrackMode !== 'independent') return getResolvedLayerAnimationTracks(layer);
  const tracks: LayerAnimationTracks = {};
  for (const property of getLayerAnimatableProperties(layer)) {
    const authored = layer.animationTracks[property];
    if (authored?.length) tracks[property] = authored;
  }
  return tracks;
}

/** The independent frame-zero base pose is not an authored aggregate animation key. */
export function timelineLayerKeyframes(layer: Layer): LayerKeyframe[] {
  if (layer.animationTrackMode !== 'independent') return layer.keyframes;
  const frames = new Set(
    Object.values(timelineAnimationTracks(layer)).flatMap((track) =>
      (track ?? []).map((key) => key.frame),
    ),
  );
  return layer.keyframes.filter((key) => frames.has(key.frame));
}

/** Compatibility keys with identical values at lifecycle frames do not make a useful UI track. */
export function isTimelinePropertyMeaningful(
  layer: Layer,
  property: AnimatableLayerProperty,
  lifecycleFrames: ReadonlySet<number>,
): boolean {
  if ((layer.loop?.tracks[property]?.length ?? 0) > 0) return true;
  const keys = timelineAnimationTracks(layer)[property] ?? [];
  if (layer.animationTrackMode === 'independent') return keys.length > 0;
  if (parseShaderAnimationProperty(property) && keys.length > 0) return true;
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
