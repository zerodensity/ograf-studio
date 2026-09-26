import { describe, expect, it } from 'vitest';
import { createTextElement } from './factory';
import { applyElementDataValue } from './boundPaint';

describe('text data bindings', () => {
  it.each([
    ['fontSize', '72', 72],
    ['fontWeight', 700, 700],
    ['strokeWidth', '2', 2],
    ['lineHeight', '1.5', 1.5],
    ['letterSpacing', '-2', -2],
    ['baselineShift', '-5', -5],
    ['minFontSize', 12, 12],
  ])('keeps %s numeric', (property, input, expected) => {
    expect(applyElementDataValue(createTextElement(), property!, input)).toHaveProperty(
      property!,
      expected,
    );
  });

  it.each([NaN, Infinity, '', 'bad', null, true, {}, -10])(
    'ignores invalid font sizes: %s',
    (value) => {
      const text = createTextElement();
      expect(applyElementDataValue(text, 'fontSize', value)).toBe(text);
    },
  );

  it('keeps runtime line height consistent with the editor minimum', () => {
    const text = createTextElement();
    expect(applyElementDataValue(text, 'lineHeight', 0.49)).toBe(text);
    expect(applyElementDataValue(text, 'lineHeight', 0.5)).toHaveProperty('lineHeight', 0.5);
  });

  it.each([
    ['textAlign', 'center'],
    ['verticalAlign', 'middle'],
    ['textTransform', 'uppercase'],
    ['overflowPolicy', 'ellipsis'],
    ['autoFit', 'fixed'],
  ])('validates %s choices', (property, value) => {
    const text = createTextElement();
    expect(applyElementDataValue(text, property!, value)).toHaveProperty(property!, value);
    expect(applyElementDataValue(text, property!, 'invalid')).toBe(text);
  });
});
