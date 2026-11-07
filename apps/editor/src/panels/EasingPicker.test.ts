import { describe, expect, it } from 'vitest';
import { easingThumbnail, feelPreset } from './EasingPicker';
import { LAYER_MOTION_FEELS } from './layerMotionFeels';

describe('designer easing picker', () => {
  it('maps Snappy entering and leaving to the same presets as Animate In / Out', () => {
    const snappy = LAYER_MOTION_FEELS.find((feel) => feel.label === 'Snappy')!;
    expect(feelPreset(snappy, 'out')).toBe(snappy.in);
    expect(feelPreset(snappy, 'in')).toBe(snappy.out);
    expect(feelPreset(snappy, 'in-out')).toBe('expo-in-out');
  });
  it('generates a finite path for every offered curve', () => {
    for (const feel of LAYER_MOTION_FEELS)
      for (const direction of ['in', 'out', 'in-out'] as const) {
        const path = easingThumbnail(feelPreset(feel, direction));
        expect(path).toMatch(/^M /);
        expect(path).not.toMatch(/NaN|Infinity/);
      }
  });
  it('draws the custom curve rather than the selected fallback preset', () => {
    const custom = easingThumbnail('linear', { x1: 0.8, y1: 0, x2: 1, y2: 0.2 });
    expect(custom).not.toBe(easingThumbnail('linear'));
    expect(custom).not.toMatch(/NaN|Infinity/);
  });
});
