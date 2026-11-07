import {
  cubicBezierProgress,
  easedProgress,
  type CubicBezierCurve,
  type EasingPreset,
} from '@ograf-editor/scene-model';

/** Pure progress mapping through the canonical scene-model easing sampler. */
export function easingForProgress(
  easing: EasingPreset,
  curve?: CubicBezierCurve,
): (progress: number) => number {
  return curve
    ? (progress) => cubicBezierProgress(progress, curve)
    : (progress) => easedProgress(progress, easing);
}
