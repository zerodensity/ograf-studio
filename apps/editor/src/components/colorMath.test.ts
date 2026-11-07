import { describe, expect, it } from 'vitest';
import { readColor } from '@ograf-editor/scene-model';
import { formatColor, hsvToRgb, rgbToHsv } from './colorMath';
describe('color picker math and output formats', () => {
  it.each([
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [42, 132, 219],
    [128, 128, 128],
  ] as [number, number, number][])('round trips RGB %s, %s, %s through HSV', (r, g, b) => {
    expect(hsvToRgb(rgbToHsv([r, g, b]))).toEqual([r, g, b]);
  });
  it('preserves explicit alpha and rgb syntax while producing compliant opaque hex', () => {
    expect(formatColor([20, 40, 60], 0.5, true, '#14283c')).toBe('#14283c80');
    expect(formatColor([20, 40, 60], 1, false, '#14283c80')).toBe('#14283c');
    expect(formatColor([20, 40, 60], 0.5, true, 'rgba(0, 0, 0, .4)')).toBe('rgba(20, 40, 60, 0.5)');
    expect(readColor(formatColor([20, 40, 60], 0.5, true, '#000000'))?.alpha).toBeCloseTo(0.502, 3);
  });
});
