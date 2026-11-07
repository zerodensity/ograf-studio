import type { TextPropertyAnimator } from './types';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export function normalizeTextPropertyAnimator(
  value: Partial<TextPropertyAnimator>,
): TextPropertyAnimator {
  const props = value.properties ?? {};
  return {
    id: typeof value.id === 'string' && value.id ? value.id : 'animator',
    enabled: value.enabled !== false,
    unit: value.unit === 'word' || value.unit === 'line' ? value.unit : 'character',
    start: clamp(number(value.start, 0), 0, 1),
    end: clamp(number(value.end, 1), 0, 1),
    offset: clamp(number(value.offset, 0), -1, 1),
    offsetKeyframes: Array.isArray(value.offsetKeyframes)
      ? value.offsetKeyframes
          .filter(
            (k) =>
              k && typeof k === 'object' && Number.isFinite(k.frame) && Number.isFinite(k.value),
          )
          .map((k) => ({ frame: Math.max(0, Math.round(k.frame)), value: clamp(k.value, -1, 1) }))
          .sort((a, b) => a.frame - b.frame)
      : [],
    shape:
      value.shape === 'ramp' || value.shape === 'triangle' || value.shape === 'round'
        ? value.shape
        : 'square',
    easing:
      value.easing === 'ease-in' || value.easing === 'ease-out' || value.easing === 'ease-in-out'
        ? value.easing
        : 'linear',
    order:
      value.order === 'reverse' || value.order === 'center-out' || value.order === 'random'
        ? value.order
        : 'forward',
    seed: Math.trunc(number(value.seed, 1)),
    durationFrames: Math.max(1, Math.round(number(value.durationFrames, 25))),
    properties: Object.fromEntries(
      Object.entries(props).filter(([key, val]) =>
        key === 'color'
          ? typeof val === 'string'
          : ['opacity', 'x', 'y', 'scale', 'rotation', 'blur', 'tracking'].includes(key) &&
            typeof val === 'number' &&
            Number.isFinite(val),
      ),
    ) as TextPropertyAnimator['properties'],
  };
}
export function textAnimatorOrder(
  count: number,
  order: TextPropertyAnimator['order'],
  seed: number,
): number[] {
  const indices = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  if (order === 'reverse') indices.reverse();
  if (order === 'center-out')
    indices.sort((a, b) => Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2) || a - b);
  if (order === 'random') {
    let state = seed >>> 0 || 0x9e3779b9;
    for (let i = indices.length - 1; i > 0; i--) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const j = (state >>> 0) % (i + 1);
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
  }
  const ranks: number[] = [];
  indices.forEach((index, rank) => {
    ranks[index] = rank;
  });
  return ranks;
}
function ease(t: number, kind: TextPropertyAnimator['easing']) {
  return kind === 'ease-in'
    ? t * t
    : kind === 'ease-out'
      ? 1 - (1 - t) * (1 - t)
      : kind === 'ease-in-out'
        ? t < 0.5
          ? 2 * t * t
          : 1 - 2 * (1 - t) * (1 - t)
        : t;
}
export function textAnimatorOffset(animator: TextPropertyAnimator, frame: number): number {
  const keys = animator.offsetKeyframes;
  if (!keys.length) return animator.offset;
  if (frame <= keys[0]!.frame) return keys[0]!.value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!,
      b = keys[i]!;
    if (frame <= b.frame) {
      const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      return a.value + (b.value - a.value) * ease(clamp(t, 0, 1), animator.easing);
    }
  }
  return keys.at(-1)!.value;
}
/** Sample from frame and seed only: forward, backward and repeated seeks produce identical values. */
export function textAnimatorWeight(
  animator: TextPropertyAnimator,
  index: number,
  count: number,
  rank: number,
  frame: number,
): number {
  if (!animator.enabled || count <= 0) return 0;
  const position = (index + 0.5) / count - textAnimatorOffset(animator, frame),
    lo = Math.min(animator.start, animator.end),
    hi = Math.max(animator.start, animator.end);
  if (position < lo || position > hi || hi - lo < 1e-8) return 0;
  const t = clamp((position - lo) / (hi - lo), 0, 1);
  const shape =
    animator.shape === 'ramp'
      ? t
      : animator.shape === 'triangle'
        ? 1 - Math.abs(2 * t - 1)
        : animator.shape === 'round'
          ? Math.sin(Math.PI * t)
          : 1;
  const progress = clamp((frame / animator.durationFrames) * (count + 1) - rank, 0, 1);
  return shape * (1 - ease(progress, animator.easing));
}
export function textPropertyAnimatorErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ['Text animators must be a list.'];
  if (value.length > 32) return ['At most 32 text animators are supported.'];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return [`Text animator ${index + 1} must be an object.`];
    const a = item as Partial<TextPropertyAnimator>;
    if (!a.id || typeof a.id !== 'string') return [`Text animator ${index + 1} needs an id.`];
    if (
      a.durationFrames !== undefined &&
      (!Number.isInteger(a.durationFrames) || a.durationFrames < 1)
    )
      return [`Text animator ${index + 1} duration must be a positive frame count.`];
    if (
      a.offsetKeyframes !== undefined &&
      (!Array.isArray(a.offsetKeyframes) ||
        a.offsetKeyframes.some(
          (k) => !k || !Number.isInteger(k.frame) || k.frame < 0 || !Number.isFinite(k.value),
        ))
    )
      return [`Text animator ${index + 1} offset keys are invalid.`];
    return [];
  });
}
