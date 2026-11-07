import { cubicBezierProgress, easedProgress } from './layerAnimation';
import type { ChartAnimation, EasingPreset } from './types';

export const DEFAULT_CHART_ANIMATION: ChartAnimation = {
  type: 'grow',
  durationFrames: 25,
  delayFrames: 0,
  staggerFrames: 2,
  easing: 'cubic-out',
  replayOnUpdate: true,
};

export const CHART_ANIMATION_LABELS: Record<ChartAnimation['type'], string> = {
  none: 'None',
  grow: 'Grow',
  reveal: 'Reveal',
  fade: 'Fade in',
};

export const CHART_ANIMATION_EASINGS: readonly EasingPreset[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'quad-in',
  'quad-out',
  'quad-in-out',
  'cubic-in',
  'cubic-out',
  'cubic-in-out',
  'quart-in',
  'quart-out',
  'quart-in-out',
  'quint-in',
  'quint-out',
  'quint-in-out',
  'sine-in',
  'sine-out',
  'sine-in-out',
  'expo-in',
  'expo-out',
  'expo-in-out',
  'circ-in',
  'circ-out',
  'circ-in-out',
  'back-in',
  'back-out',
  'back-in-out',
  'bounce-in',
  'bounce-out',
  'bounce-in-out',
  'elastic-in',
  'elastic-out',
  'elastic-in-out',
];

const boundedFrames = (value: unknown, fallback: number, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback;

function validCurve(value: unknown): value is NonNullable<ChartAnimation['curve']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const curve = value as Record<string, unknown>;
  return (
    Object.keys(curve).length === 4 &&
    ['x1', 'y1', 'x2', 'y2'].every(
      (key) =>
        typeof curve[key] === 'number' &&
        Number.isFinite(curve[key]) &&
        Number(curve[key]) >= 0 &&
        Number(curve[key]) <= 1,
    )
  );
}

/** Missing persisted animations remain disabled; new-chart factories opt into grow explicitly. */
export function normalizeChartAnimation(
  animation: Partial<ChartAnimation> | null | undefined,
): ChartAnimation {
  return {
    type:
      animation?.type && Object.hasOwn(CHART_ANIMATION_LABELS, animation.type)
        ? animation.type
        : 'none',
    durationFrames: boundedFrames(animation?.durationFrames, 25, 1, 1500),
    delayFrames: boundedFrames(animation?.delayFrames, 0, 0, 1500),
    staggerFrames: boundedFrames(animation?.staggerFrames, 2, 0, 100),
    easing:
      animation?.easing && CHART_ANIMATION_EASINGS.includes(animation.easing)
        ? animation.easing
        : 'cubic-out',
    replayOnUpdate: animation?.replayOnUpdate !== false,
    ...(validCurve(animation?.curve) ? { curve: { ...animation.curve } } : {}),
    ...(animation?.updateMode === undefined ? {} : { updateMode: animation.updateMode }),
  };
}

/** Choosing a named easing replaces any previously authored custom curve. */
export function chartAnimationWithPreset(
  animation: Partial<ChartAnimation>,
  easing: EasingPreset,
): ChartAnimation {
  const next = normalizeChartAnimation({ ...animation, easing });
  delete next.curve;
  return next;
}

/** Deterministic data-point sample; expressive easing can overshoot between exact endpoints. */
export function chartAnimationProgress(
  animation: Partial<ChartAnimation> | null | undefined,
  frame: number,
  index = 0,
): number {
  const normalized = normalizeChartAnimation(animation);
  if (normalized.type === 'none') return 1;
  const pointIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const localFrame =
    (Number.isFinite(frame) ? frame : 0) -
    normalized.delayFrames -
    pointIndex * normalized.staggerFrames;
  if (localFrame <= 0) return 0;
  if (localFrame >= normalized.durationFrames) return 1;
  const progress = localFrame / normalized.durationFrames;
  return normalized.curve
    ? cubicBezierProgress(progress, normalized.curve)
    : easedProgress(progress, normalized.easing);
}

/** Validate authored values before normalization so mistakes cannot silently become defaults. */
export function chartAnimationErrors(animation: unknown): string[] {
  if (animation === undefined) return [];
  if (!animation || typeof animation !== 'object' || Array.isArray(animation))
    return ['Chart animation must be an object.'];
  const value = animation as Record<string, unknown>;
  const errors: string[] = [];
  if (
    value.type !== undefined &&
    (typeof value.type !== 'string' || !Object.hasOwn(CHART_ANIMATION_LABELS, value.type))
  )
    errors.push('Chart animation has an unknown type.');
  for (const [name, minimum, maximum] of [
    ['durationFrames', 1, 1500],
    ['delayFrames', 0, 1500],
    ['staggerFrames', 0, 100],
  ] as const) {
    const frames = value[name];
    if (
      frames !== undefined &&
      (typeof frames !== 'number' ||
        !Number.isInteger(frames) ||
        frames < minimum ||
        frames > maximum)
    )
      errors.push(`Chart animation ${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  if (
    value.easing !== undefined &&
    (typeof value.easing !== 'string' ||
      !CHART_ANIMATION_EASINGS.includes(value.easing as EasingPreset))
  )
    errors.push('Chart animation has an unknown easing.');
  if (value.replayOnUpdate !== undefined && typeof value.replayOnUpdate !== 'boolean')
    errors.push('Chart animation replayOnUpdate must be a boolean.');
  if (value.updateMode !== undefined && !['replay', 'morph'].includes(String(value.updateMode)))
    errors.push('Chart animation updateMode must be replay or morph.');
  if (value.curve !== undefined && !validCurve(value.curve))
    errors.push('Chart animation curve must contain x1, y1, x2 and y2 from 0 to 1.');
  return errors;
}
