import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_ANIMATION,
  isRollingTextAnimation,
  normalizeTextAnimation,
  sampleTextCountAnimation,
  sampleTextCountRoll,
  textAnimationErrors,
  TEXT_ANIMATION_LABELS,
  TEXT_ANIMATION_TYPES,
} from './textAnimation';
import type { TextAnimation } from './types';

function countAnimation(
  type: 'count-up' | 'count-down' = 'count-up',
  countFrom: number | null = null,
): TextAnimation {
  return { ...DEFAULT_TEXT_ANIMATION, type, countFrom, countRoll: 'up', durationFrames: 20 };
}

describe('rolling text animation model', () => {
  it('exposes standalone rolling effects and backward-compatible counter options', () => {
    for (const type of ['roll-up', 'roll-down'] as const) {
      expect(isRollingTextAnimation(type)).toBe(true);
      expect(TEXT_ANIMATION_TYPES).toContain(type);
      expect(TEXT_ANIMATION_LABELS[type]).toBe(type === 'roll-up' ? 'Roll up' : 'Roll down');
      expect(normalizeTextAnimation({ type }).type).toBe(type);
      expect(textAnimationErrors({ type })).toEqual([]);
    }
    expect(isRollingTextAnimation('count-up')).toBe(false);
    expect(normalizeTextAnimation({ type: 'count-up' }).countRoll).toBe('none');
    for (const countRoll of ['none', 'up', 'down'] as const) {
      expect(normalizeTextAnimation({ countRoll }).countRoll).toBe(countRoll);
      expect(textAnimationErrors({ countRoll })).toEqual([]);
    }
    for (const countRoll of [null, 'sideways', 1, true]) {
      expect(normalizeTextAnimation({ countRoll } as Partial<TextAnimation>).countRoll).toBe(
        'none',
      );
      expect(textAnimationErrors({ countRoll })).toContain(
        'Text animation countRoll must be none, up or down.',
      );
    }
  });

  it.each([
    ['count-up', '100', '87', '88', 0.5],
    ['count-down', '100', '113', '112', 0.5],
    ['count-up', '-100', '-113', '-112', 0.5],
    ['count-down', '-100', '-87', '-88', 0.5],
    ['count-up', '12.50', '10.93', '10.94', 0.75],
    ['count-down', '12.50', '14.07', '14.06', 0.75],
    ['count-up', '-12.50', '-14.07', '-14.06', 0.75],
    ['count-down', '-12.50', '-10.93', '-10.94', 0.75],
  ] as const)('samples adjacent units for %s to %s', (type, source, from, to, progress) => {
    expect(sampleTextCountRoll(source, countAnimation(type), 10)).toEqual({
      from,
      to,
      progress,
    });
  });

  it('keeps numeric direction independent of the chosen visual roll direction', () => {
    for (const type of ['count-up', 'count-down'] as const) {
      const animation = countAnimation(type);
      const expected = sampleTextCountRoll('100', animation, 10);
      for (const countRoll of ['none', 'up', 'down'] as const)
        expect(sampleTextCountRoll('100', { ...animation, countRoll }, 10)).toEqual(expected);
    }
  });

  it('starts each integer boundary at zero progress and clamps to the authored target', () => {
    expect(sampleTextCountRoll('8', countAnimation(), 10)).toEqual({
      from: '7',
      to: '8',
      progress: 0,
    });
    expect(sampleTextCountRoll('8', countAnimation('count-down'), 10)).toEqual({
      from: '9',
      to: '8',
      progress: 0,
    });
    expect(sampleTextCountRoll('8', countAnimation('count-up', 9), 10)).toEqual({
      from: '8',
      to: '8',
      progress: 0,
    });
    expect(sampleTextCountRoll('8', countAnimation('count-down', 7), 10)).toEqual({
      from: '8',
      to: '8',
      progress: 0,
    });
  });

  it('carries and borrows across digit boundaries and crosses zero without a negative zero', () => {
    expect(sampleTextCountRoll('10', countAnimation('count-up', 7), 10)).toEqual({
      from: '9',
      to: '10',
      progress: 0.625,
    });
    expect(sampleTextCountRoll('10', countAnimation('count-down', 13), 10)).toEqual({
      from: '11',
      to: '10',
      progress: 0.625,
    });
    expect(sampleTextCountRoll('4', countAnimation('count-up', -4), 5)).toEqual({
      from: '0',
      to: '1',
      progress: 0.625,
    });
    expect(sampleTextCountRoll('-4', countAnimation('count-down', 4), 5)).toEqual({
      from: '0',
      to: '-1',
      progress: 0.625,
    });
  });

  it.each([
    ['USD $1,234.50', '', 'USD $1,080.18', 'USD $1,080.19', 0.75],
    ['1.234,50 €', 'de-DE', '1.080,18 €', '1.080,19 €', 0.75],
    ['1\u202f234,50 €', 'fr-FR', '1\u202f080,18 €', '1\u202f080,19 €', 0.75],
    ["1'234.50 CHF", 'de-CH', "1'080.18 CHF", "1'080.19 CHF", 0.75],
    ['1,23,456', 'en-IN', '1,08,024', '1,08,025', 0],
    ['+100%', '', '+87%', '+88%', 0.5],
    ['−001.20', '', '−001.35', '−001.34', 0],
    ['0008', '', '0007', '0008', 0],
    ['.50', '', '.37', '.38', 0.5],
  ])('preserves the parser formatting for %s', (source, language, from, to, progress) => {
    expect(sampleTextCountRoll(source, countAnimation(), 10, language)).toEqual({
      from,
      to,
      progress,
    });
  });

  it('samples the same frames after backward seeks and finishes with the exact authored source', () => {
    for (const type of ['count-up', 'count-down'] as const) {
      const animation = countAnimation(type);
      const middle = sampleTextCountRoll('−001.20', animation, 10);
      for (const frame of [20, 200, Infinity])
        expect(sampleTextCountRoll('−001.20', animation, frame)).toEqual({
          from: '−001.20',
          to: '−001.20',
          progress: 1,
        });
      expect(sampleTextCountRoll('−001.20', animation, 10)).toEqual(middle);
      const start = sampleTextCountRoll('−001.20', animation, 0);
      for (const frame of [-20, -Infinity, NaN])
        expect(sampleTextCountRoll('−001.20', animation, frame)).toEqual(start);
    }
  });

  it('does not change the existing rounded counter sampler', () => {
    expect(sampleTextCountAnimation('100', countAnimation(), 10)).toBe('88');
    expect(sampleTextCountAnimation('100', countAnimation('count-down'), 10)).toBe('113');
    expect(sampleTextCountRoll('100', countAnimation(), 10)?.from).toBe('87');
  });

  it('keeps finite samples at extreme magnitude and authored precision', () => {
    const huge = new Intl.NumberFormat('en-US', { useGrouping: false }).format(Number.MAX_VALUE);
    for (const source of [huge, `-${huge}`, '0.12345678901234567890']) {
      for (const type of ['count-up', 'count-down'] as const) {
        const animation = countAnimation(type);
        for (const frame of [0, 10, 20]) {
          const result = sampleTextCountRoll(source, animation, frame)!;
          expect(result).not.toBeNull();
          expect(Number.isFinite(Number(result.from))).toBe(true);
          expect(Number.isFinite(Number(result.to))).toBe(true);
          expect(Number.isFinite(result.progress)).toBe(true);
          expect(result.progress).toBeGreaterThanOrEqual(0);
          expect(result.progress).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('leaves non-counters and unsupported numeric strings to their normal text rendering', () => {
    expect(
      sampleTextCountRoll('100', { ...DEFAULT_TEXT_ANIMATION, type: 'roll-up' }, 10),
    ).toBeNull();
    for (const source of ['No result', '12:34', '1e3', '1/2', 'NaN', 'Infinity'])
      expect(sampleTextCountRoll(source, countAnimation(), 10)).toBeNull();
  });
});
