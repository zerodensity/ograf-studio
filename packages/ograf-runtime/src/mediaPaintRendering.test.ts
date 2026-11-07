import { describe, expect, it } from 'vitest';
import { mediaFitRect, waitForMediaClip } from './mediaPaintRendering';

class FakeVideo extends EventTarget {
  src = 'clip.mp4';
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
}

describe('media paint rendering geometry', () => {
  it('covers and honors the normalized focal position', () => {
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'cover', 0, 0.5),
    ).toEqual({
      x: 0,
      y: -50,
      width: 200,
      height: 200,
    });
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'cover', 1, 1),
    ).toEqual({
      x: 0,
      y: -100,
      width: 200,
      height: 200,
    });
  });

  it('resolves already decoded and intentionally blank clip sources', async () => {
    const decoded = new FakeVideo();
    decoded.readyState = 2;
    decoded.videoWidth = 1920;
    decoded.videoHeight = 1080;
    await expect(
      waitForMediaClip(decoded as unknown as HTMLVideoElement, new AbortController().signal),
    ).resolves.toBeUndefined();

    const blank = new FakeVideo();
    blank.src = '';
    await expect(
      waitForMediaClip(blank as unknown as HTMLVideoElement, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('turns decoder and disposal events into local readiness errors', async () => {
    const failed = new FakeVideo();
    const failedReady = waitForMediaClip(
      failed as unknown as HTMLVideoElement,
      new AbortController().signal,
    );
    failed.dispatchEvent(new Event('error'));
    await expect(failedReady).rejects.toThrow('could not be decoded');

    const pending = new FakeVideo();
    const controller = new AbortController();
    const pendingReady = waitForMediaClip(
      pending as unknown as HTMLVideoElement,
      controller.signal,
    );
    controller.abort();
    await expect(pendingReady).rejects.toThrow('disposed');
  });

  it('contains or stretches without cropping', () => {
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'contain', 0.5, 0.5),
    ).toEqual({
      x: 50,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(
      mediaFitRect({ width: 100, height: 50 }, { width: 300, height: 200 }, 'fill', 0.5, 0.5),
    ).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });
});
