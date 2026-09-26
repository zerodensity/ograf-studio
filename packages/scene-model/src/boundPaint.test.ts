import { describe, expect, it } from 'vitest';
import { createTextElement } from './factory';
import { applyElementDataValue } from './boundPaint';

describe('applyElementDataValue text properties', () => {
  it('keeps numeric text properties numeric', () => {
    const element = createTextElement();

    expect(applyElementDataValue(element, 'fontSize', '72')).toHaveProperty('fontSize', 72);
    expect(applyElementDataValue(element, 'fontWeight', 700)).toHaveProperty('fontWeight', 700);
    expect(applyElementDataValue(element, 'lineHeight', '1.2')).toHaveProperty('lineHeight', 1.2);
    expect(applyElementDataValue(element, 'letterSpacing', '-2')).toHaveProperty(
      'letterSpacing',
      -2,
    );
  });
});
