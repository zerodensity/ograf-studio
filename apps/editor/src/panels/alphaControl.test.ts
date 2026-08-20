import { describe, expect, it } from 'vitest';
import { alphaPercentToOpacity, opacityToAlphaPercent } from './alphaControl';

describe('alpha control conversion', () => {
  it('converts between authored opacity and a percentage', () => {
    expect(opacityToAlphaPercent(0.505)).toBe(50.5);
    expect(alphaPercentToOpacity(50.5)).toBe(0.505);
  });

  it('clamps alpha to the valid object-opacity range', () => {
    expect(alphaPercentToOpacity(-20)).toBe(0);
    expect(alphaPercentToOpacity(140)).toBe(1);
    expect(opacityToAlphaPercent(2)).toBe(100);
  });
});
