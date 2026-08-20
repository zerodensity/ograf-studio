import { describe, expect, it } from 'vitest';
import { colorPickerValue, transparencyCheckerboardStyle } from './compositionBackground';

describe('composition background appearance', () => {
  it('normalizes supported colors for the native picker', () => {
    expect(colorPickerValue('#A1B2C3')).toBe('#a1b2c3');
    expect(colorPickerValue('#abc')).toBe('#aabbcc');
  });

  it('falls back to black for transparent or non-hex colors', () => {
    expect(colorPickerValue('transparent')).toBe('#000000');
    expect(colorPickerValue('navy')).toBe('#000000');
  });

  it('counter-scales the checkerboard to a stable screen size', () => {
    expect(transparencyCheckerboardStyle(0.5).backgroundSize).toBe('48px 48px');
    expect(transparencyCheckerboardStyle(0).backgroundSize).toBe('24px 24px');
  });
});
