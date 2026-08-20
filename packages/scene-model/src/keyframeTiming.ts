import type { Composition } from './types';

const DEFAULT_TRANSITION_FRAMES = 12;

export interface KeyframeFrame {
  keyframeId: string;
  frame: number;
}

/** Cumulative frame number per Keyframe, walking the chain of consecutive Transitions from Keyframe 0. */
export function computeKeyframeFrames(composition: Composition): KeyframeFrame[] {
  const frames: KeyframeFrame[] = [];
  let cumulative = 0;
  composition.keyframes.forEach((keyframe, i) => {
    if (i === 0) {
      frames.push({ keyframeId: keyframe.id, frame: 0 });
      return;
    }
    const prev = composition.keyframes[i - 1]!;
    const transition = composition.transitions.find(
      (t) => t.fromKeyframeId === prev.id && t.toKeyframeId === keyframe.id,
    );
    cumulative += transition?.durationFrames ?? DEFAULT_TRANSITION_FRAMES;
    frames.push({ keyframeId: keyframe.id, frame: cumulative });
  });
  return frames;
}

export function getTotalFrames(composition: Composition): number {
  const frames = computeKeyframeFrames(composition);
  return frames.length > 0 ? frames[frames.length - 1]!.frame : 0;
}

export function findNearestKeyframe(
  keyframeFrames: KeyframeFrame[],
  frame: number,
): KeyframeFrame | undefined {
  return keyframeFrames.reduce<KeyframeFrame | undefined>((closest, candidate) => {
    if (!closest) return candidate;
    return Math.abs(candidate.frame - frame) < Math.abs(closest.frame - frame)
      ? candidate
      : closest;
  }, undefined);
}
