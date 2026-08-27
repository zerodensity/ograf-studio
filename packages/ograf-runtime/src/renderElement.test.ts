import { describe, expect, it } from 'vitest';
import { applyTextStrokeStyle, findFittedFontSize } from './renderElement';

describe('text stroke rendering', () => {
  it('paints the outline behind the glyph fill with portable authored values', () => {
    const style = {} as CSSStyleDeclaration;

    applyTextStrokeStyle(style, '#101820', 4);

    expect(style.webkitTextStrokeColor).toBe('#101820');
    expect(style.webkitTextStrokeWidth).toBe('4px');
    expect(style.paintOrder).toBe('stroke fill');
  });

  it('retains stroke colour and paint order at zero width for later animation', () => {
    const style = {} as CSSStyleDeclaration;

    applyTextStrokeStyle(style, '#ffcc00', 0);

    expect(style.webkitTextStrokeColor).toBe('#ffcc00');
    expect(style.webkitTextStrokeWidth).toBe('0px');
    expect(style.paintOrder).toBe('stroke fill');
  });
});

describe('text fitting', () => {
  it('keeps shrink-to-fit below the authored size and above its legibility floor', () => {
    const result = findFittedFontSize({
      mode: 'shrink-to-fit',
      authoredFontSize: 80,
      minFontSize: 40,
      fits: (fontSize) => fontSize <= 52.35,
    });

    expect(result.fontSize).toBe(52.3);
    expect(result.ratio).toBeCloseTo(52.3 / 80);
    expect(result.degenerate).toBe(false);
  });

  it('allows fit-to-width to grow beyond the authored size and fill the limiting axis', () => {
    const result = findFittedFontSize({
      mode: 'fit-to-width',
      authoredFontSize: 48,
      minFontSize: 24,
      fits: (fontSize) => fontSize <= 137.65,
    });

    expect(result.fontSize).toBe(137.6);
    expect(result.ratio).toBeGreaterThan(1);
    expect(result.degenerate).toBe(false);
  });

  it('marks an unfit result at the mode floor as degenerate', () => {
    expect(
      findFittedFontSize({
        mode: 'fit-to-width',
        authoredFontSize: 48,
        minFontSize: 24,
        fits: () => false,
      }),
    ).toEqual({ fontSize: 0.1, ratio: 0.1 / 48, degenerate: true });
  });
});
