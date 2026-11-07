import { describe, expect, it } from 'vitest';
import { createDefaultGradient } from '@ograf-editor/scene-model';
import { tintGradientCss } from './textGradientTint';
describe('gradient text animator tint', () => {
  it('tints each sampled stop without changing stop offsets, alpha, or the source paint', () => {
    const paint = createDefaultGradient('linear');
    paint.stops[0]!.color = '#ff000080';
    paint.stops[0]!.opacity = 0.4;
    paint.stops[0]!.offset = 0.2;
    paint.stops[1]!.color = '#0000ff';
    paint.stops[1]!.opacity = 0.7;
    paint.stops[1]!.offset = 0.8;
    const original = structuredClone(paint);
    const css = tintGradientCss(paint, [{ color: '#00ff00', weight: 0.5 }]);
    expect(css).toContain('rgba(128, 128, 0, 0.5019607843137255)');
    expect(css).toContain('rgba(0, 128, 128, 1)');
    expect(css).toContain('20%');
    expect(css).toContain('80%');
    expect(css).toContain('40%');
    expect(css).toContain('70%');
    expect(paint).toEqual(original);
    expect(tintGradientCss(paint, [{ color: '#00ff00', weight: 0.5 }])).toBe(css);
  });
  it('composes multiple color animators in authored order', () => {
    const paint = createDefaultGradient();
    paint.stops[0]!.color = '#000000';
    const css = tintGradientCss(paint, [
      { color: '#ff0000', weight: 1 },
      { color: '#0000ff', weight: 0.5 },
    ]);
    expect(css).toContain('rgba(128, 0, 128, 1)');
  });
});
