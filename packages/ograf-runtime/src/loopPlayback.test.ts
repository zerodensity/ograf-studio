import { describe, expect, it } from 'vitest';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import {
  createLayerLoopClip,
  getLoopFrameAtElapsed,
  timedLoopElapsedFrames,
} from '@ograf-editor/scene-model';
import { LoopPlaybackController } from './loopPlayback';

const fixture = (groupId = 'headlines') =>
  ({
    id: groupId,
    loop: {
      ...createLayerLoopClip({ durationFrames: 348 }),
      frameRate: 25,
      holdDataKey: 'holdSeconds',
      timing: {
        groupId,
        holdFieldId: 'hold',
        holdRanges: [
          { startFrame: 0, endFrame: 100 },
          { startFrame: 116, endFrame: 216 },
          { startFrame: 232, endFrame: 332 },
        ],
      },
    },
  }) as CompiledLayer;

describe('independent loop playback', () => {
  it('stretches only holds and preserves every retract/reveal frame', () => {
    const { loop } = fixture();
    expect(timedLoopElapsedFrames(loop!, 100, 25, 4)).toBe(100);
    expect(timedLoopElapsedFrames(loop!, 50, 25, 2)).toBe(100);
    expect(timedLoopElapsedFrames(loop!, 57, 25, 2)).toBe(107);
    expect(timedLoopElapsedFrames(loop!, 66, 25, 2)).toBe(116);
    expect(timedLoopElapsedFrames(loop!, 116, 25, 2)).toBe(216);
    expect(timedLoopElapsedFrames(loop!, 198, 25, 2)).toBe(348);
    expect(timedLoopElapsedFrames(loop!, 7, 25, 0)).toBe(107);
    for (const frame of [0, 2, 100, 107, 116, 216, 223, 232, 332, 339, 348, 740]) {
      const runtime = timedLoopElapsedFrames(loop!, frame, 25, 2, true);
      expect(timedLoopElapsedFrames(loop!, runtime, 25, 2)).toBeCloseTo(frame);
    }
  });

  it('changes hold duration without jumping the current authored position', () => {
    const layer = fixture();
    const playback = new LoopPlaybackController();
    expect(playback.sample(layer, 50, { holdSeconds: 4 }, 50)).toBe(50);
    expect(playback.sample(layer, 50, { holdSeconds: 2 }, 50)).toBe(50);
    expect(playback.sample(layer, 75, { holdSeconds: 2 }, 75)).toBe(100);
    expect(playback.sample(layer, 82, { holdSeconds: 2 }, 82)).toBe(107);
  });

  it('pauses one group while another keeps running, then resumes without a jump', () => {
    const layer = fixture();
    const crawl = fixture('crawl');
    const playback = new LoopPlaybackController();
    playback.sample(layer, 50, { holdSeconds: 4 }, 50);
    playback.sample(crawl, 50, { holdSeconds: 4 }, 50);
    expect(playback.control('pause', 'headlines', 50)).toBe(true);
    expect(playback.sample(layer, 150, { holdSeconds: 4 }, 150)).toBe(50);
    expect(playback.sample(crawl, 150, { holdSeconds: 4 }, 150)).toBe(150);
    playback.control('resume', 'headlines', 150);
    expect(playback.sample(layer, 175, { holdSeconds: 4 }, 175)).toBe(75);
    expect(playback.groups().find((group) => group.groupId === 'headlines')?.paused).toBe(false);
  });

  it('next plays a single sequential change while paused and parks on the next headline', () => {
    const layer = fixture();
    const playback = new LoopPlaybackController();
    playback.sample(layer, 40, { holdSeconds: 4 }, 40);
    playback.control('pause', 'headlines', 40);
    playback.control('next', 'headlines', 40);
    expect(playback.sample(layer, 47, { holdSeconds: 4 }, 47)).toBe(107);
    playback.control('next', 'headlines', 47);
    expect(playback.sample(layer, 56, { holdSeconds: 4 }, 56)).toBe(116);
    expect(playback.sample(layer, 156, { holdSeconds: 4 }, 156)).toBe(116);
    playback.control('next', 'headlines', 156);
    expect(playback.sample(layer, 172, { holdSeconds: 4 }, 172)).toBe(232);
    playback.control('next', 'headlines', 172);
    expect(
      getLoopFrameAtElapsed(layer.loop!, playback.sample(layer, 188, { holdSeconds: 4 }, 188)!),
    ).toBe(0);
    expect(playback.groups()[0]?.paused).toBe(true);
  });

  it('legacy clips remain unchanged and failed group commands do not affect them', () => {
    const layer = fixture();
    delete layer.loop!.timing;
    const playback = new LoopPlaybackController();
    expect(playback.sample(layer, 82, {}, 82)).toBe(82);
    expect(playback.control('pause', 'missing', 82)).toBe(false);
    expect(playback.groups()).toEqual([]);
  });

  it('inherits paused transport across a same-instance data snapshot', () => {
    const layer = fixture();
    const original = new LoopPlaybackController();
    original.sample(layer, 50, { holdSeconds: 4 }, 50);
    original.control('pause', 'headlines', 50);
    const updated = new LoopPlaybackController();
    updated.inherit(original);
    expect(updated.sample(layer, 150, { holdSeconds: 2 }, 150)).toBe(50);
    updated.control('resume', 'headlines', 150);
    expect(updated.sample(layer, 175, { holdSeconds: 2 }, 175)).toBe(100);
    expect(original.groups()[0]?.paused).toBe(true);
  });
});
