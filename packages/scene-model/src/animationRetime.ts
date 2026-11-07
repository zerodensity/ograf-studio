import { computeKeyframeFrames } from './keyframeTiming';
import { sortLayerKeyframes, sortLayerPropertyKeyframes } from './layerAnimation';
import { layerMotionWindows } from './layerMotion';
import { retimeChartMarkAnimations } from './chartMarkAnimation';
import type { Composition } from './types';

export type AnimationRetimePhase = 'in' | 'on-air' | 'out' | 'entire';

export interface AnimationRetimeResult {
  phase: AnimationRetimePhase;
  startFrame: number;
  previousEndFrame: number;
  targetEndFrame: number;
  deltaFrames: number;
  retimedKeys: number;
}

export interface AnimationRetimePhaseRange {
  phase: AnimationRetimePhase;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  transitionCount: number;
  retimable: boolean;
}

export function animationRetimePhaseRange(
  composition: Composition,
  phase: AnimationRetimePhase,
): AnimationRetimePhaseRange {
  const lifecycle = computeKeyframeFrames(composition);
  const roleById = new Map(composition.keyframes.map((keyframe) => [keyframe.id, keyframe.role]));
  const steps = lifecycle.filter((item) => roleById.get(item.keyframeId) === 'step');
  const end = lifecycle.at(-1)!;
  const firstStep = steps[0] ?? end;
  const lastStep = steps.at(-1) ?? lifecycle[0]!;
  const [startFrame, endFrame] =
    phase === 'in'
      ? [0, firstStep.frame]
      : phase === 'out'
        ? [lastStep.frame, end.frame]
        : phase === 'on-air'
          ? [firstStep.frame, lastStep.frame]
          : [0, end.frame];
  const transitionCount = composition.transitions.filter((transition) => {
    const from = lifecycle.find((item) => item.keyframeId === transition.fromKeyframeId)?.frame;
    const to = lifecycle.find((item) => item.keyframeId === transition.toKeyframeId)?.frame;
    return from !== undefined && to !== undefined && from >= startFrame && to <= endFrame;
  }).length;
  return {
    phase,
    startFrame,
    endFrame,
    durationFrames: Math.max(0, endFrame - startFrame),
    transitionCount,
    retimable: transitionCount > 0 && endFrame > startFrame,
  };
}

export function retimeAnimationPhase(
  composition: Composition,
  phase: AnimationRetimePhase,
  targetFrames: number,
): AnimationRetimeResult {
  const lifecycle = computeKeyframeFrames(composition);
  const range = animationRetimePhaseRange(composition, phase);
  const markWindows = layerMotionWindows(composition);
  const { startFrame, endFrame: previousEndFrame } = range;
  const transitionIndexes = composition.transitions.flatMap((transition, index) => {
    const from = lifecycle.find((item) => item.keyframeId === transition.fromKeyframeId)?.frame;
    const to = lifecycle.find((item) => item.keyframeId === transition.toKeyframeId)?.frame;
    return from !== undefined && to !== undefined && from >= startFrame && to <= previousEndFrame
      ? [index]
      : [];
  });
  if (!range.retimable) throw new Error(`The ${phase} phase has no retimable lifecycle range.`);
  const duration = Math.max(transitionIndexes.length, Math.round(targetFrames));
  const oldDuration = previousEndFrame - startFrame;
  const scale = duration / oldDuration;
  let assigned = 0;
  transitionIndexes.forEach((index, position) => {
    const transition = composition.transitions[index]!;
    const next =
      position === transitionIndexes.length - 1
        ? duration - assigned
        : Math.max(1, Math.round(transition.durationFrames * scale));
    transition.durationFrames = next;
    assigned += next;
  });
  const targetEndFrame = startFrame + duration;
  const deltaFrames = targetEndFrame - previousEndFrame;
  let retimedKeys = 0;
  const mapFrame = (frame: number) => {
    if (frame < startFrame) return frame;
    if (frame <= previousEndFrame) {
      retimedKeys += 1;
      return Math.round(startFrame + (frame - startFrame) * scale);
    }
    return frame + deltaFrames;
  };
  for (const layer of composition.layers) {
    if (layer.element.type === 'chart')
      retimeChartMarkAnimations(layer.element, markWindows, (frame) =>
        frame < startFrame
          ? frame
          : frame <= previousEndFrame
            ? Math.round(startFrame + (frame - startFrame) * scale)
            : frame + deltaFrames,
      );
    layer.keyframes = sortLayerKeyframes(
      layer.keyframes.map((keyframe) => ({ ...keyframe, frame: mapFrame(keyframe.frame) })),
    );
    for (const [property, keys] of Object.entries(layer.animationTracks)) {
      if (!keys) continue;
      layer.animationTracks[property as keyof typeof layer.animationTracks] =
        sortLayerPropertyKeyframes(keys.map((key) => ({ ...key, frame: mapFrame(key.frame) })));
    }
  }
  return { phase, startFrame, previousEndFrame, targetEndFrame, deltaFrames, retimedKeys };
}
