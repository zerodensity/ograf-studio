import { createLayerKeyframe } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import type { Composition, LayerKeyframe, LayerTransform } from './types';

export const MOTION_PRESET_NAMES = ['wipe-reveal', 'stagger-cascade', 'directional-slide'] as const;

export type MotionPresetName = (typeof MOTION_PRESET_NAMES)[number];
export type MotionStyle = 'wipe' | 'stagger' | 'slide' | 'none';
export type MotionDirection = 'left' | 'right' | 'up' | 'down' | 'none';

export interface LayerMotionRequest {
  composition: Composition;
  onAir: LayerTransform;
  style: MotionStyle;
  entrance: MotionDirection;
  exit: MotionDirection;
  isRevealMask?: boolean;
  cascadeIndex?: number;
  cascadeCount?: number;
  staggerFrames?: number;
}

interface LifecycleFrames {
  start: number;
  firstStep: number;
  end: number;
  byId: Map<string, number>;
}

function lifecycleFrames(composition: Composition): LifecycleFrames {
  const frames = computeKeyframeFrames(composition);
  const byId = new Map(frames.map((entry) => [entry.keyframeId, entry.frame]));
  const startId = composition.keyframes.find((keyframe) => keyframe.role === 'start')?.id;
  const firstStepId = composition.keyframes.find((keyframe) => keyframe.role === 'step')?.id;
  const endId = composition.keyframes.find((keyframe) => keyframe.role === 'end')?.id;
  if (!startId || !firstStepId || !endId) {
    throw new Error('Motion presets require explicit Start, at least one Step, and End.');
  }
  return {
    start: byId.get(startId) ?? 0,
    firstStep: byId.get(firstStepId) ?? 0,
    end: byId.get(endId) ?? frames.at(-1)?.frame ?? 0,
    byId,
  };
}

function directionalOffCanvas(
  composition: Composition,
  onAir: LayerTransform,
  direction: MotionDirection,
): LayerTransform {
  const transform = { ...onAir };
  switch (direction) {
    case 'left':
      transform.x = -onAir.width - 40;
      break;
    case 'right':
      transform.x = composition.width + 40;
      break;
    case 'up':
      transform.y = -onAir.height - 40;
      break;
    case 'down':
      transform.y = composition.height + 40;
      break;
    case 'none':
      break;
  }
  return transform;
}

function collapsedReveal(onAir: LayerTransform, direction: MotionDirection): LayerTransform {
  const transform = { ...onAir };
  switch (direction) {
    case 'left':
      transform.width = 0;
      transform.transformOriginX = 0;
      break;
    case 'right':
      transform.x += transform.width;
      transform.width = 0;
      transform.transformOriginX = 1;
      break;
    case 'up':
      transform.height = 0;
      transform.transformOriginY = 0;
      break;
    case 'down':
      transform.y += transform.height;
      transform.height = 0;
      transform.transformOriginY = 1;
      break;
    case 'none':
      break;
  }
  return transform;
}

export function assertStaggerFits(
  composition: Composition,
  cascadeCount: number,
  staggerFrames: number,
): void {
  if (!Number.isInteger(staggerFrames) || staggerFrames < 0) {
    throw new Error('staggerFrames must be a non-negative integer.');
  }
  const frames = lifecycleFrames(composition);
  const entranceFrames = frames.firstStep - frames.start;
  const cascadeDelay = Math.max(0, cascadeCount - 1) * staggerFrames;
  if (entranceFrames - cascadeDelay < 2) {
    throw new Error(
      `Stagger cascade needs at least ${cascadeDelay + 2} entrance frames for ${cascadeCount} layers at ${staggerFrames} frames apart; only ${entranceFrames} are available before the first Step.`,
    );
  }
  if (frames.firstStep > frames.end) {
    throw new Error('The first Step is beyond End; stagger keys cannot be authored safely.');
  }
}

/** Builds ordinary layer keys for one deterministic named motion style. */
export function buildLayerMotionKeyframes(request: LayerMotionRequest): LayerKeyframe[] {
  const {
    composition,
    onAir,
    style,
    entrance,
    exit,
    isRevealMask = false,
    cascadeIndex = 0,
    cascadeCount = 1,
    staggerFrames = 0,
  } = request;
  const frames = lifecycleFrames(composition);
  if (style === 'stagger' && entrance !== 'none') {
    assertStaggerFits(composition, cascadeCount, staggerFrames);
  }

  const noMotion = style === 'none';
  const entranceTransform =
    noMotion || entrance === 'none'
      ? onAir
      : style === 'wipe'
        ? isRevealMask
          ? collapsedReveal(onAir, entrance)
          : onAir
        : directionalOffCanvas(composition, onAir, entrance);
  const exitTransform =
    noMotion || exit === 'none' ? onAir : directionalOffCanvas(composition, onAir, exit);
  const byFrame = new Map<number, LayerKeyframe>();
  const put = (
    frame: number,
    transform: LayerTransform,
    easing: LayerKeyframe['easing'] = 'linear',
  ) => byFrame.set(frame, createLayerKeyframe(frame, transform, { easing }));

  for (const lifecycle of composition.keyframes) {
    const frame = frames.byId.get(lifecycle.id) ?? 0;
    if (lifecycle.role === 'start') put(frame, entranceTransform);
    else if (lifecycle.role === 'end') {
      put(frame, exitTransform, noMotion || exit === 'none' ? 'linear' : 'cubic-in');
    } else {
      put(
        frame,
        onAir,
        frame === frames.firstStep && !noMotion && entrance !== 'none' ? 'cubic-out' : 'linear',
      );
    }
  }

  if (style === 'stagger' && entrance !== 'none') {
    const delay = cascadeIndex * staggerFrames;
    const remaining = Math.max(0, cascadeCount - 1 - cascadeIndex) * staggerFrames;
    const motionStart = frames.start + delay;
    const arrival = frames.firstStep - remaining;
    if (motionStart > frames.start) put(motionStart, entranceTransform);
    if (arrival < frames.firstStep) put(arrival, onAir, 'cubic-out');
  }

  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}
