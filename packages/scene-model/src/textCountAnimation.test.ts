import { describe, expect, it } from 'vitest';
import { createTextElement } from './factory';
import {
  DEFAULT_TEXT_ANIMATION,
  isCountingTextAnimation,
  normalizeTextAnimation,
  parseTextAnimationNumber,
  sampleTextCountAnimation,
  textAnimationErrors,
  textAnimationVisibleText,
} from './textAnimation';
import type { TextAnimation } from './types';

function countAnimation(
  type: 'count-up' | 'count-down' = 'count-up',
  countFrom: number | null = null,
): TextAnimation {
  return { ...DEFAULT_TEXT_ANIMATION, type, countFrom, durationFrames: 20 };
}

describe('counting text animation model', () => {
  it('normalizes and validates optional finite starts without requiring them in old templates', () => {
    for (const type of ['count-up', 'count-down'] as const) {
      expect(isCountingTextAnimation(type)).toBe(true);
      expect(normalizeTextAnimation({ type }).countFrom).toBeNull();
      expect(normalizeTextAnimation({ type, countFrom: 50.25 }).countFrom).toBe(50.25);
      expect(
        normalizeTextAnimation({ type, countFrom: Number.POSITIVE_INFINITY }).countFrom,
      ).toBeNull();
      expect(textAnimationErrors({ type })).toEqual([]);
      expect(textAnimationErrors({ type, countFrom: null })).toEqual([]);
      expect(textAnimationErrors({ type, countFrom: -50.25 })).toEqual([]);
    }
    expect(isCountingTextAnimation('flip')).toBe(false);
    for (const countFrom of [NaN, Infinity, -Infinity, '50', true, {}])
      expect(textAnimationErrors({ type: 'count-up', countFrom })).toContain(
        'Text animation countFrom must be a finite number or null.',
      );
  });

  it('reports the exact numeric span for rich text rendering', () => {
    expect(parseTextAnimationNumber('Profit: +12.50%')).toEqual({
      value: 12.5,
      prefix: 'Profit: ',
      suffix: '%',
      numberStart: 8,
      numberEnd: 14,
    });
    expect(parseTextAnimationNumber('Loss: −12.50%')?.value).toBe(-12.5);
  });

  it.each([
    ['12', '', 12],
    ['-12', '', -12],
    ['−12', '', -12],
    ['+12', '', 12],
    ['USD $1,234.50', '', 1234.5],
    ['1.234,50 €', 'de-DE', 1234.5],
    ['1 234,50 €', 'fr-FR', 1234.5],
    ['1\u202f234,50 €', 'fr-FR', 1234.5],
    ['1\u00a0234,50 €', 'fr-FR', 1234.5],
    ["1'234.50 CHF", 'de-CH', 1234.5],
    ['1’234.50 CHF', 'de-CH', 1234.5],
    ['1,23,456', 'en-IN', 123456],
    ['1,234', '', 1234],
    ['1,234', 'de-DE', 1.234],
    ['1.234', '', 1.234],
    ['1.234', 'de-DE', 1234],
    ['12,5%', '', 12.5],
    ['.50', '', 0.5],
    ['−,50', 'de-DE', -0.5],
    ['0012.50', '', 12.5],
  ])('parses %s using %s conventions', (source, language, value) => {
    expect(parseTextAnimationNumber(source, language)?.value).toBe(value);
  });

  it.each([
    '',
    'No result',
    'NaN',
    'Infinity',
    '12:34',
    '01:02:03',
    '1/2',
    '1e3',
    '1.2E+3',
    '0x10',
    '12 of 34',
    '12–34',
    '12-34',
    '1 2',
    '1,2,3',
    '1.2.3',
    '1,23,456',
    '12,345,67',
    '1, 234',
    '1..2',
    '1,,2',
    '++12',
    '--12',
    '+−12',
    ',,5',
    '12.',
    '12,',
    '12-',
    '0.123456789012345678901',
  ])('keeps unsupported or malformed label %s unchanged', (source) => {
    expect(parseTextAnimationNumber(source)).toBeNull();
    expect(sampleTextCountAnimation(source, countAnimation(), 10)).toBeNull();
    expect(
      textAnimationVisibleText(
        createTextElement({ content: source, textAnimation: countAnimation() }),
        10,
      ),
    ).toBe(source);
  });

  it.each([
    ['count-up', '100', '0', '88'],
    ['count-down', '100', '200', '113'],
    ['count-up', '-100', '-200', '-113'],
    ['count-down', '-100', '0', '-88'],
    ['count-up', '0', '-1', '0'],
    ['count-down', '0', '1', '0'],
  ] as const)('samples %s to %s deterministically', (type, source, start, middle) => {
    const animation = countAnimation(type);
    expect(sampleTextCountAnimation(source, animation, -10)).toBe(start);
    expect(sampleTextCountAnimation(source, animation, 0)).toBe(start);
    expect(sampleTextCountAnimation(source, animation, 10)).toBe(middle);
    expect(sampleTextCountAnimation(source, animation, 20)).toBe(source);
    expect(sampleTextCountAnimation(source, animation, 200)).toBe(source);
    expect(sampleTextCountAnimation(source, animation, 10)).toBe(middle);
    expect(sampleTextCountAnimation(source, animation, 0)).toBe(start);
  });

  it.each([
    ['USD $1,234.50', '', 'USD $0.00', 'USD $1,080.19'],
    ['1.234,50 €', 'de-DE', '0,00 €', '1.080,19 €'],
    ['1\u202f234,50 €', 'fr-FR', '0,00 €', '1\u202f080,19 €'],
    ["1'234.50 CHF", 'de-CH', '0.00 CHF', "1'080.19 CHF"],
    ['1,23,456', 'en-IN', '0', '1,08,024'],
    ['+100%', '', '+0%', '+88%'],
    ['−001.20', '', '−002.40', '−001.35'],
    ['0008', '', '0000', '0007'],
    ['001,234', '', '000,000', '001,080'],
    ['.50', '', '-.50', '.38'],
    ['12,5%', '', '0,0%', '10,9%'],
  ])('preserves formatted label %s during the entrance', (source, language, start, middle) => {
    expect(sampleTextCountAnimation(source, countAnimation(), 0, language)).toBe(start);
    expect(sampleTextCountAnimation(source, countAnimation(), 10, language)).toBe(middle);
    expect(sampleTextCountAnimation(source, countAnimation(), 20, language)).toBe(source);
  });

  it('uses explicit starts and clamps starts that oppose the chosen direction', () => {
    expect(sampleTextCountAnimation('100', countAnimation('count-up', 50), 0)).toBe('50');
    expect(sampleTextCountAnimation('100', countAnimation('count-down', 150), 0)).toBe('150');
    expect(sampleTextCountAnimation('100', countAnimation('count-up', 150), 0)).toBe('100');
    expect(sampleTextCountAnimation('100', countAnimation('count-down', 50), 0)).toBe('100');
    expect(sampleTextCountAnimation('-100', countAnimation('count-up', -150), 0)).toBe('-150');
    expect(sampleTextCountAnimation('-100', countAnimation('count-down', -50), 0)).toBe('-50');
  });

  it('is monotonic for each direction and never invents a negative zero', () => {
    for (const source of ['100.00', '-100.00', '0.00']) {
      for (const type of ['count-up', 'count-down'] as const) {
        const samples = Array.from({ length: 21 }, (_, frame) => {
          const result = sampleTextCountAnimation(source, countAnimation(type), frame)!;
          expect(result).not.toBe('-0.00');
          return Number(result);
        });
        for (let frame = 1; frame < samples.length; frame++) {
          if (type === 'count-up')
            expect(samples[frame]!).toBeGreaterThanOrEqual(samples[frame - 1]!);
          else expect(samples[frame]!).toBeLessThanOrEqual(samples[frame - 1]!);
        }
      }
    }
    expect(sampleTextCountAnimation('0.00', countAnimation(), 19)).toBe('0.00');
    expect(sampleTextCountAnimation('-0.01', countAnimation('count-down', 0), 0)).toBe('0.00');
  });

  it('keeps non-counting effects out of the numeric sampler', () => {
    expect(sampleTextCountAnimation('100', DEFAULT_TEXT_ANIMATION, 10)).toBeNull();
  });

  it('uses rich text source and language in visible-text samples', () => {
    const element = createTextElement({
      content: 'stale content',
      runs: [{ text: 'Gain: ' }, { text: '1.234,50', fontWeight: 700 }, { text: ' €' }],
      language: 'de-DE',
      textAnimation: countAnimation(),
    });
    expect(textAnimationVisibleText(element, 10)).toBe('Gain: 1.080,19 €');
    expect(textAnimationVisibleText(element, 20)).toBe('Gain: 1.234,50 €');
  });
});
