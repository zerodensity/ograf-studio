import { describe, expect, it } from 'vitest';
import { createTextElement } from '@ograf-editor/scene-model';
import { tickerPatchSchema } from './schemas';

const item = {
  id: 'headline',
  width: 640,
  element: createTextElement({ content: 'أخبار · NEWS' }),
};

describe('native ticker authoring schema', () => {
  it('preserves mixed-script content and both directions', () => {
    const patch = {
      items: [item],
      direction: 'right',
      textDirection: 'rtl',
      speedPixelsPerSecond: 87.5,
      entryFade: 48,
      exitFade: 64,
      fadeSoftness: 0.5,
      updatePolicy: 'next-appearance',
    };
    expect(tickerPatchSchema.parse(patch)).toEqual(patch);
  });
  it('supports explicit immediate updates and rejects unknown update policies', () => {
    expect(tickerPatchSchema.parse({ updatePolicy: 'immediate' })).toEqual({
      updatePolicy: 'immediate',
    });
    expect(tickerPatchSchema.safeParse({ updatePolicy: 'cycle' }).success).toBe(false);
  });
  it('accepts animated image and Lottie items without flattening their content', () => {
    const items = [
      { id: 'logo', width: 96, element: { type: 'image', src: 'asset:logo', fit: 'contain' } },
      {
        id: 'motion',
        width: 128,
        element: {
          type: 'lottie',
          animationData: { fr: 30, ip: 0, op: 30, w: 100, h: 100, layers: [] },
          speed: 1,
        },
        animation: { type: 'fade', durationMs: 600, delayMs: 0 },
      },
    ];
    expect(tickerPatchSchema.parse({ items }).items).toEqual(items);
  });
  it.each([-1, Infinity, NaN, 2001])(
    'rejects invalid scrolling speed %s',
    (speedPixelsPerSecond) => {
      expect(tickerPatchSchema.safeParse({ speedPixelsPerSecond }).success).toBe(false);
    },
  );
  it('rejects duplicate IDs, nested ticker and zero width', () => {
    expect(tickerPatchSchema.safeParse({ items: [item, item] }).success).toBe(false);
    expect(tickerPatchSchema.safeParse({ items: [{ ...item, width: 0 }] }).success).toBe(false);
    expect(
      tickerPatchSchema.safeParse({ items: [{ ...item, element: { type: 'ticker' } }] }).success,
    ).toBe(false);
  });
});
