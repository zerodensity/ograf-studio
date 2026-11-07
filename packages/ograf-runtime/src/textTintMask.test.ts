import { describe, expect, it, vi } from 'vitest';
import { composeTextTint, paintTextTintGlyph } from './textTintMask';

describe('experimental text tint weight map', () => {
  it('preserves the order and remaining source weight of multiple animators', () => {
    const tint = composeTextTint([
      { color: '#ff0000', weight: 0.5 },
      { color: '#0000ff', weight: 0.25 },
    ]);
    expect(tint.weight).toBeCloseTo(0.625);
    expect(tint.rgb[0]).toBeCloseTo(153);
    expect(tint.rgb[2]).toBeCloseTo(102);
    expect(composeTextTint([])).toEqual({ rgb: [0, 0, 0], weight: 0 });
    expect(() => composeTextTint([{ color: 'invalid', weight: 1 }])).toThrow(/cannot be parsed/);
  });
  it('erases the previous tint with full glyph coverage before additive paint', () => {
    const operations: Array<[string, number, string]> = [];
    const context = {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    paintTextTintGlyph(
      context,
      () =>
        operations.push([
          context.globalCompositeOperation,
          context.globalAlpha,
          String(context.fillStyle),
        ]),
      0.5,
      { rgb: [255, 0, 0], weight: 0.25 },
    );
    expect(operations).toEqual([
      ['destination-out', 0.5, '#ffffff'],
      ['lighter', 0.5, 'rgba(255, 0, 0, 0.25)'],
    ]);
    operations.length = 0;
    paintTextTintGlyph(
      context,
      () =>
        operations.push([
          context.globalCompositeOperation,
          context.globalAlpha,
          String(context.fillStyle),
        ]),
      1,
      { rgb: [0, 0, 0], weight: 0 },
    );
    expect(operations).toEqual([['destination-out', 1, '#ffffff']]);
  });
});
