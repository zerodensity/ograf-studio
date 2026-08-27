import { describe, expect, it } from 'vitest';
import { createLottieElement } from './factory';
import { inspectLottieAnimationData, lottieFrameAtTime, parseLottieJson } from './lottie';

const animation = {
  v: '5.13.0',
  fr: 30,
  ip: 10,
  op: 70,
  w: 320,
  h: 180,
  layers: [],
};

describe('Lottie documents', () => {
  it('parses a self-contained Bodymovin document and rejects external image paths', () => {
    expect(parseLottieJson(JSON.stringify(animation))).toEqual(animation);
    expect(
      inspectLottieAnimationData({
        ...animation,
        assets: [{ id: 'image_0', p: 'images/logo.png' }],
      }).errors.join(' '),
    ).toMatch(/External Lottie image asset/);
  });

  it('derives a stable looping frame from absolute elapsed time and speed', () => {
    const element = createLottieElement({ animationData: animation });
    expect(lottieFrameAtTime(element, 0)).toBe(10);
    expect(lottieFrameAtTime(element, 2_500)).toBe(25);
    expect(lottieFrameAtTime({ ...element, speed: 2 }, 2_500)).toBe(40);
    expect(lottieFrameAtTime({ ...element, speed: 0 }, 99_000)).toBe(10);
  });
});
