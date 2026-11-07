import { createTextElement } from './factory';
import { createDefaultGradient } from './paint';
import { textAnimatorPaintErrors, textAnimationErrors } from './textAnimation';
import { describe, expect, it } from 'vitest';
import {
  normalizeTextPropertyAnimator,
  textAnimatorOffset,
  textAnimatorOrder,
  textAnimatorWeight,
} from './textAnimators';
describe('deterministic text property animators', () => {
  it('repeats seeded random rises exactly across backwards seeks', () => {
    const a = normalizeTextPropertyAnimator({
      id: 'rise',
      order: 'random',
      seed: 42,
      durationFrames: 24,
      properties: { y: 40, opacity: 0 },
    });
    const ranks = textAnimatorOrder(12, a.order, a.seed);
    expect(new Set(ranks).size).toBe(12);
    expect(ranks).not.toEqual(textAnimatorOrder(12, 'forward', 42));
    const sample = (frame: number) =>
      ranks.map((rank, i) => textAnimatorWeight(a, i, ranks.length, rank, frame));
    const first = sample(9);
    sample(22);
    expect(sample(9)).toEqual(first);
    expect(sample(24).every((v) => v === 0)).toBe(true);
    expect(textAnimatorOrder(12, 'random', 42)).toEqual(ranks);
    expect(textAnimatorOrder(12, 'random', 43)).not.toEqual(ranks);
  });
  it('supports keyframed range offset and all selection shapes', () => {
    const a = normalizeTextPropertyAnimator({
      id: 'range',
      offsetKeyframes: [
        { frame: 0, value: 0 },
        { frame: 10, value: 0.5 },
      ],
      durationFrames: 10,
    });
    expect(textAnimatorOffset(a, 5)).toBe(0.25);
    for (const shape of ['square', 'ramp', 'triangle', 'round'] as const)
      expect(textAnimatorWeight({ ...a, shape }, 1, 4, 1, 0)).toBeGreaterThanOrEqual(0);
  });
  it('allows parseable gradients and rolling while rejecting unsupported color paints', () => {
    const animator = normalizeTextPropertyAnimator({
      id: 'color',
      properties: { color: '#ff0000' },
    });
    const text = createTextElement({
      fill: createDefaultGradient('linear'),
      textAnimation: { ...createTextElement().textAnimation, animators: [animator] },
    });
    expect(textAnimatorPaintErrors(text)).toHaveLength(0);
    if (typeof text.fill !== 'string' && text.fill?.type === 'linear')
      text.fill.stops[0]!.color = 'var(--unresolved)';
    expect(textAnimatorPaintErrors(text)).toHaveLength(1);
    text.fill = {
      type: 'shader',
      name: 'test',
      fragmentSource: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1.);}',
      speed: 1,
      resolutionScale: 1,
      parameters: {},
    };
    expect(textAnimatorPaintErrors(text)).toHaveLength(1);
    expect(textAnimationErrors({ ...text.textAnimation, type: 'roll-up' })).toEqual([]);
    text.fill = '#ffffff';
    expect(textAnimatorPaintErrors(text)).toEqual([]);
  });
});
