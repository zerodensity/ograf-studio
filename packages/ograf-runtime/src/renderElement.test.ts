import { describe, expect, it, vi } from 'vitest';
import {
  applyTextStrokeStyle,
  calculateTextSqueezeScale,
  findFittedFontSize,
  lottieBackingSizeForLayer,
} from './renderElement';

describe('text squeeze scaling', () => {
  it('calculates independent horizontal and vertical glyph scales', () => {
    expect(
      calculateTextSqueezeScale({
        boxWidth: 600,
        boxHeight: 120,
        naturalWidth: 300,
        naturalHeight: 80,
      }),
    ).toEqual({ scaleX: 2, scaleY: 1.5, degenerate: false });
  });
});

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
  it('uses two browser measurements when live text already fits at its authored size', () => {
    const fits = vi.fn((fontSize: number) => fontSize <= 80);
    expect(
      findFittedFontSize({ mode: 'shrink-to-fit', authoredFontSize: 80, minFontSize: 40, fits }),
    ).toEqual({ fontSize: 79.9, ratio: 79.9 / 80, degenerate: false });
    expect(fits.mock.calls).toEqual([[40], [80]]);
  });

  it('keeps the one-decimal font-size contract on the authored-size fast path', () => {
    const fits = vi.fn(() => true);
    const result = findFittedFontSize({
      mode: 'shrink-to-fit',
      authoredFontSize: 32.37,
      minFontSize: 12,
      fits,
    });
    expect(result).toEqual({ fontSize: 32.3, ratio: 32.3 / 32.37, degenerate: false });
    expect(fits.mock.calls).toEqual([[12], [32.37]]);
  });

  it('retains the binary-search result when authored text overflows', () => {
    const fits = vi.fn((fontSize: number) => fontSize <= 52.35);
    const result = findFittedFontSize({
      mode: 'shrink-to-fit',
      authoredFontSize: 80,
      minFontSize: 40,
      fits,
    });
    expect(result).toEqual({ fontSize: 52.3, ratio: 52.3 / 80, degenerate: false });
    expect(fits.mock.calls[0]).toEqual([40]);
    expect(fits.mock.calls[1]).toEqual([80]);
    expect(fits).toHaveBeenCalledTimes(18);
  });

  it('keeps overflow at the legibility floor visible to validation', () => {
    const fits = vi.fn(() => false);
    expect(
      findFittedFontSize({ mode: 'shrink-to-fit', authoredFontSize: 40, minFontSize: 20, fits }),
    ).toEqual({ fontSize: 20, ratio: 0.5, degenerate: true });
    expect(fits.mock.calls).toEqual([[20]]);
  });

  it.each([
    [28, 12, 28],
    [80, 40, 100],
    [32.37, 12.15, 100],
    [80, 100, 100],
    [0.5, 12, 1],
    [80, 40, 52.35],
    [40, 20, 0],
  ])(
    'preserves legacy quantized pixels for authored %s, floor %s and limit %s',
    (authoredFontSize, minFontSize, limit) => {
      const fits = (size: number) => size <= limit;
      const authored = Math.max(0.1, authoredFontSize);
      const floor = Math.min(authored, Math.max(1, minFontSize));
      let lower = floor;
      if (fits(floor) && lower !== authored) {
        // Keep the complete legacy search for both fitting and genuinely overflowing input.
        let upper = authored;
        lower = floor;
        for (let step = 0; step < 16; step++) {
          const candidate = (lower + upper) / 2;
          if (fits(candidate)) lower = candidate;
          else upper = candidate;
        }
      }
      const fontSize = Math.max(0.1, Math.floor(lower * 10) / 10);
      const expected = { fontSize, ratio: fontSize / authored, degenerate: !fits(floor) };
      expect(
        findFittedFontSize({ mode: 'shrink-to-fit', authoredFontSize, minFontSize, fits }),
      ).toEqual(expected);
    },
  );

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

describe('Lottie backing size', () => {
  it('uses the maximum lifecycle, property-track, and local-loop dimensions', () => {
    expect(
      lottieBackingSizeForLayer({
        keyframes: [
          { transform: { width: 1, height: 1 } },
          { transform: { width: 320, height: 90 } },
        ],
        animationTracks: {
          width: [{ value: 400.2 }],
          height: [{ value: 120.1 }],
        },
        loop: {
          tracks: {
            width: [{ value: 384 }],
            height: [{ value: 144.4 }],
          },
        },
      }),
    ).toEqual({ width: 401, height: 145 });
  });

  it('caps pathological authored maxima to a bounded backing allocation', () => {
    const size = lottieBackingSizeForLayer({
      keyframes: [{ transform: { width: 1_000_000_000, height: 1_000_000_000 } }],
      animationTracks: {},
      loop: null,
    });
    expect(size).toEqual({ width: 4096, height: 4096 });
  });
});
