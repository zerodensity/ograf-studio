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
      expect(rates).toEqual([50, 59.94]);
    }
  });

  it('has exactly four presets and leaves other dimensions or frame rates custom', () => {
    expect(COMPOSITION_PRESETS).toHaveLength(4);
    for (const [width, height, frameRate] of [
      [1920, 1080, 25],
      [1920, 1080, 60],
      [1080, 1920, 50],
      [4096, 2160, 50],
    ]) {
      expect(
        COMPOSITION_PRESETS.some((preset) =>
          matchesCompositionPreset(preset, width!, height!, frameRate!),
        ),
      ).toBe(false);
    }
  });

  it('matches displayed fractional rates to their exact broadcast values', () => {
    const ntsc = COMPOSITION_PRESETS.find((preset) => preset.label.includes('59.94'))!;
    expect(matchesCompositionPreset(ntsc, ntsc.width, ntsc.height, 59.94)).toBe(true);
  });
});
