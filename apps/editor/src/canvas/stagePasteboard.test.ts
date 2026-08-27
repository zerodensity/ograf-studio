import { describe, expect, it } from 'vitest';
import {
  getCenteredStageScroll,
  getStagePasteboardLayout,
  INFINITE_STAGE_MEASURE_PX,
  recenterStageCamera,
} from './stagePasteboard';

describe('stage pasteboard geometry', () => {
  it('places the scaled frame at the centre of the virtual camera plane', () => {
    expect(getStagePasteboardLayout(1920, 1080, 0.5)).toEqual({
      frameWidth: 960,
      frameHeight: 540,
      frameLeft: (INFINITE_STAGE_MEASURE_PX - 960) / 2,
      frameTop: (INFINITE_STAGE_MEASURE_PX - 540) / 2,
      measureWidth: INFINITE_STAGE_MEASURE_PX,
      measureHeight: INFINITE_STAGE_MEASURE_PX,
    });
  });

  it('centers the composition in the visible viewport', () => {
    const layout = getStagePasteboardLayout(1920, 1080, 0.5);

    expect(getCenteredStageScroll(layout, 1040, 620)).toEqual({
      left: (INFINITE_STAGE_MEASURE_PX - 1040) / 2,
      top: (INFINITE_STAGE_MEASURE_PX - 620) / 2,
    });
  });

  it('recenters indefinitely without changing the frame position on screen', () => {
    const layout = getStagePasteboardLayout(1920, 1080, 0.5);
    const before = {
      scroll: { left: 90_000, top: 110_000 },
      origin: { x: 99_520, y: 99_730 },
    };
    const after = recenterStageCamera(layout, 1000, 600, before.scroll, before.origin);

    expect(after.origin.x - after.scroll.left).toBe(before.origin.x - before.scroll.left);
    expect(after.origin.y - after.scroll.top).toBe(before.origin.y - before.scroll.top);
  });
});
