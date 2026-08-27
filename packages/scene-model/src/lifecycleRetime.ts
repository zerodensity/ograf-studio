import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerAnimatableProperties, getResolvedLayerAnimationTracks } from './layerAnimation';
import type { Composition } from './types';

export interface LifecycleRetimeBounds {
  currentFrame: number;
  minFrame: number;
  maxFrame: number | null;
}

export interface LifecycleRetimePlan extends LifecycleRetimeBounds {
  keyframeId: string;
  targetFrame: number;
  transitionUpdates: Array<{ transitionId: string; durationFrames: number }>;
  warnings: string[];
}

export const MIN_LIFECYCLE_TRANSITION_FRAMES = 1;

export function lifecycleRetimeBounds(
  composition: Composition,
  keyframeId: string,
  minimumTransitionFrames = MIN_LIFECYCLE_TRANSITION_FRAMES,
): LifecycleRetimeBounds | null {
  const index = composition.keyframes.findIndex((keyframe) => keyframe.id === keyframeId);
  if (index <= 0) return null;
  const frames = computeKeyframeFrames(composition);
  const currentFrame = frames[index]?.frame;
  const previousFrame = frames[index - 1]?.frame;
  if (currentFrame === undefined || previousFrame === undefined) return null;
  const minFrame = previousFrame + minimumTransitionFrames;
  const nextFrame = frames[index + 1]?.frame;
  const maxFrame = nextFrame === undefined ? null : nextFrame - minimumTransitionFrames;
  if (maxFrame !== null && maxFrame < minFrame) {
    return { currentFrame, minFrame: currentFrame, maxFrame: currentFrame };
  }
  return { currentFrame, minFrame, maxFrame };
}

function strandedKeyWarnings(
  composition: Composition,
  currentFrame: number,
  targetFrame: number,
  movesCompositionEnd: boolean,
): string[] {
  if (currentFrame === targetFrame) return [];
  let keysAtOldFrame = 0;
  let keysBeyondNewEnd = 0;
  const affectedLayers = new Set<string>();
  const beyondEndLayers = new Set<string>();
  for (const layer of composition.layers) {
    const tracks = getResolvedLayerAnimationTracks(layer);
    for (const property of getLayerAnimatableProperties(layer)) {
      for (const key of tracks[property] ?? []) {
        if (key.frame === currentFrame) {
          keysAtOldFrame += 1;
          affectedLayers.add(layer.name);
        }
        if (movesCompositionEnd && key.frame > targetFrame) {
          keysBeyondNewEnd += 1;
          beyondEndLayers.add(layer.name);
        }
      }
    }
  }
  const warnings: string[] = [];
  if (keysAtOldFrame > 0) {
    warnings.push(
      `${keysAtOldFrame} layer property ${keysAtOldFrame === 1 ? 'key remains' : 'keys remain'} at old lifecycle frame ${currentFrame} across ${affectedLayers.size} ${affectedLayers.size === 1 ? 'layer' : 'layers'}.`,
    );
  }
  if (keysBeyondNewEnd > 0) {
    warnings.push(
      `${keysBeyondNewEnd} layer property ${keysBeyondNewEnd === 1 ? 'key is' : 'keys are'} beyond the new End frame ${targetFrame} across ${beyondEndLayers.size} ${beyondEndLayers.size === 1 ? 'layer' : 'layers'}; export will remain blocked until those keys are retimed or removed.`,
    );
  }
  return warnings;
}

export function planLifecycleRetime(
  composition: Composition,
  keyframeId: string,
  requestedFrame: number,
  minimumTransitionFrames = MIN_LIFECYCLE_TRANSITION_FRAMES,
): LifecycleRetimePlan | null {
  const index = composition.keyframes.findIndex((keyframe) => keyframe.id === keyframeId);
  const bounds = lifecycleRetimeBounds(composition, keyframeId, minimumTransitionFrames);
  if (index <= 0 || !bounds) return null;
  const previous = composition.keyframes[index - 1]!;
  const keyframe = composition.keyframes[index]!;
  const next = composition.keyframes[index + 1];
  const inbound = composition.transitions.find(
    (transition) =>
      transition.fromKeyframeId === previous.id && transition.toKeyframeId === keyframe.id,
  );
  if (!inbound) return null;
  const roundedFrame = Math.round(requestedFrame);
  const targetFrame = Math.max(
    bounds.minFrame,
    bounds.maxFrame === null ? roundedFrame : Math.min(bounds.maxFrame, roundedFrame),
  );
  const deltaFrames = targetFrame - bounds.currentFrame;
  const transitionUpdates = [
    { transitionId: inbound.id, durationFrames: inbound.durationFrames + deltaFrames },
  ];
  if (next) {
    const outbound = composition.transitions.find(
      (transition) =>
        transition.fromKeyframeId === keyframe.id && transition.toKeyframeId === next.id,
    );
    if (!outbound) return null;
    transitionUpdates.push({
      transitionId: outbound.id,
      durationFrames: outbound.durationFrames - deltaFrames,
    });
  }
  return {
    keyframeId,
    ...bounds,
    targetFrame,
    transitionUpdates,
    warnings: strandedKeyWarnings(
      composition,
      bounds.currentFrame,
      targetFrame,
      next === undefined && targetFrame < bounds.currentFrame,
    ),
  };
}
