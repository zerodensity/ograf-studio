import {
  cubicBezierProgress,
  easedProgress,
  type CubicBezierCurve,
  type EasingPreset,
} from '@ograf-editor/scene-model';

/** GSAP accepts an easing function; sharing the scene-model sampler prevents preview/runtime drift. */
export function easingForGsap(
  easing: EasingPreset,
  curve?: CubicBezierCurve,
): (progress: number) => number {
  return curve
    ? (progress) => cubicBezierProgress(progress, curve)
    : (progress) => easedProgress(progress, easing);
}
