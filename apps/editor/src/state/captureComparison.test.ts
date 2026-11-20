import { describe, expect, it } from 'vitest';
import { comparePixels } from './captureComparison';

const picture = (...pixels: Array<[number, number, number, number]>) =>
  new Uint8ClampedArray(pixels.flat());

describe('capture comparison', () => {
  it('scores the same picture as no difference and shows it black', () => {
    const same = picture([10, 200, 30, 255], [0, 0, 0, 0]);
    const result = comparePixels(same, same.slice());
    expect(result.meanDifference).toBe(0);
    expect(result.differingFraction).toBe(0);
    expect([...result.difference]).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('scores by the largest channel distance and counts pixels past a tenth of the range', () => {
    const result = comparePixels(
      picture([255, 0, 0, 255], [100, 100, 100, 255], [50, 50, 50, 255], [0, 0, 0, 255]),
      picture([0, 0, 0, 255], [100, 110, 100, 255], [50, 50, 90, 255], [0, 0, 0, 255]),
    );
    expect(result.differingFraction).toBe(0.5);
    expect(result.meanDifference).toBeCloseTo((255 + 10 + 40 + 0) / (255 * 4), 6);
    // Brighter where the pictures differ more, opaque everywhere.
    expect([...result.difference.filter((_, index) => index % 4 === 0)]).toEqual([255, 30, 120, 0]);
    expect([...result.difference.filter((_, index) => index % 4 === 3)]).toEqual([
      255, 255, 255, 255,
    ]);
  });

  it('sees a see-through pixel as dark, whatever colour it carries', () => {
    const result = comparePixels(picture([255, 255, 255, 0]), picture([0, 0, 0, 255]));
    expect(result.meanDifference).toBe(0);
    const half = comparePixels(picture([200, 0, 0, 128]), picture([0, 0, 0, 255]));
    expect(half.meanDifference).toBeCloseTo((200 * 128) / 255 / 255, 6);
  });

  it('refuses pictures of different sizes', () => {
    expect(() => comparePixels(picture([0, 0, 0, 255]), new Uint8ClampedArray(8))).toThrow(
      'same size',
    );
  });
});
