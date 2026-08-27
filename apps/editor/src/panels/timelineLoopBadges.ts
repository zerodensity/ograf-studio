import {
  computeKeyframeFrames,
  isAnimatableLayerProperty,
  type AnimatableLayerProperty,
  type Composition,
} from '@ograf-editor/scene-model';

export interface TimelineLoopBadge {
  layerId: string;
  lifecycleKeyframeId: string;
  frame: number;
  activation: 'lifecycle' | 'step';
  properties: AnimatableLayerProperty[];
}

/** Maps each configured layer loop to the lifecycle Step where that loop becomes active. */
export function buildTimelineLoopBadges(composition: Composition): TimelineLoopBadge[] {
  const frameById = new Map(
    computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
  );
  const firstStep = composition.keyframes.find((keyframe) => keyframe.role === 'step');
  const stepIds = new Set(
    composition.keyframes
      .filter((keyframe) => keyframe.role === 'step')
      .map((keyframe) => keyframe.id),
  );
  const badges: TimelineLoopBadge[] = [];
  for (const layer of composition.layers) {
    if (!layer.loop) continue;
    const lifecycleKeyframeId =
      layer.loop.activation.type === 'lifecycle'
        ? firstStep?.id
        : layer.loop.activation.stepKeyframeId;
    if (!lifecycleKeyframeId || !stepIds.has(lifecycleKeyframeId)) continue;
    const frame = frameById.get(lifecycleKeyframeId);
    if (frame === undefined) continue;
    badges.push({
      layerId: layer.id,
      lifecycleKeyframeId,
      frame,
      activation: layer.loop.activation.type,
      properties: Object.keys(layer.loop.tracks).filter(
        (property): property is AnimatableLayerProperty =>
          isAnimatableLayerProperty(property) && (layer.loop?.tracks[property]?.length ?? 0) > 0,
      ),
    });
  }
  return badges;
}
