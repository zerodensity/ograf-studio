import { describe, expect, it } from 'vitest';
import { MAX_REPEAT_COUNT, clampRepeatCount, repeaterCopyRects } from './repeaterLayout';

describe('repeater layout', () => {
  const card = { x: 100, y: 600, width: 300, height: 340 };

  it('places each extra copy one selection-width plus gap further along', () => {
    expect(repeaterCopyRects(card, 3, 'horizontal', 24)).toEqual([
      { index: 2, x: 424, y: 600, width: 300, height: 340 },
      { index: 3, x: 748, y: 600, width: 300, height: 340 },
    ]);
    expect(repeaterCopyRects(card, 2, 'vertical', 10)).toEqual([
      { index: 2, x: 100, y: 950, width: 300, height: 340 },
    ]);
  });

  it('treats a negative gap as touching, like the repeater itself', () => {
    expect(repeaterCopyRects(card, 2, 'horizontal', -50)[0]!.x).toBe(400);
  });

  it('keeps the copy count between 2 and the maximum', () => {
    expect(clampRepeatCount(1)).toBe(2);
    expect(clampRepeatCount(4.6)).toBe(5);
    expect(clampRepeatCount(Number.NaN)).toBe(2);
    expect(clampRepeatCount(500)).toBe(MAX_REPEAT_COUNT);
  });
});
