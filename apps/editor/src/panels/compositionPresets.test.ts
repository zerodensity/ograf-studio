import { describe, expect, it } from 'vitest';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from './compositionPresets';

describe('composition presets', () => {
  it('offers the requested rates for both Full HD and UHD', () => {
    for (const [width, height] of [
      [1920, 1080],
      [3840, 2160],
    ]) {
      const rates = COMPOSITION_PRESETS.filter(
        (preset) => preset.width === width && preset.height === height,
      ).map((preset) => Number(preset.frameRate.toFixed(3)));
      expect(rates).toEqual([25, 29.97, 30, 50, 59.94, 60]);
    }
  });

  it('contains no resolution below Full HD', () => {
    expect(
      COMPOSITION_PRESETS.every((preset) => preset.width >= 1920 && preset.height >= 1080),
    ).toBe(true);
  });

  it('matches displayed fractional rates to their exact broadcast values', () => {
    const ntsc = COMPOSITION_PRESETS.find((preset) => preset.label.includes('29.97'))!;
    expect(matchesCompositionPreset(ntsc, ntsc.width, ntsc.height, 29.97)).toBe(true);
  });
});
