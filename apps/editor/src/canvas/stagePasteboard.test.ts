import { describe, expect, it } from 'vitest';
import { getCenteredStageScroll, getStagePasteboardLayout } from './stagePasteboard';

describe('stage pasteboard geometry', () => {
  it('provides one scaled composition of working space around every frame edge', () => {
    expect(getStagePasteboardLayout(1920, 1080, 0.5)).toEqual({
      frameWidth: 960,
      frameHeight: 540,
      frameLeft: 960,
      frameTop: 540,
      measureWidth: 2880,
      measureHeight: 1620,
    });
  });

  it('centers the composition in the visible viewport', () => {
    const layout = getStagePasteboardLayout(1920, 1080, 0.5);

    expect(getCenteredStageScroll(layout, 1040, 620)).toEqual({ left: 920, top: 500 });
  });
});
