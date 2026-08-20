import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE_ZOOM,
  MIN_STAGE_ZOOM,
  captureStageZoomAnchor,
  nextStageZoom,
  scrollForStageZoom,
} from './stageZoom';

describe('stage zoom', () => {
  it('zooms in and out within a safe range', () => {
    expect(nextStageZoom(1, 'in')).toBeGreaterThan(1);
    expect(nextStageZoom(1, 'out')).toBeLessThan(1);
    expect(nextStageZoom(MAX_STAGE_ZOOM, 'in')).toBe(MAX_STAGE_ZOOM);
    expect(nextStageZoom(MIN_STAGE_ZOOM, 'out')).toBe(MIN_STAGE_ZOOM);
  });

  it('keeps the logical point under the pointer stable', () => {
    const anchor = captureStageZoomAnchor(0.5, 300, 200, 120, 80);
    const scroll = scrollForStageZoom(anchor, 1);
    expect((scroll.left + 120) / 1).toBeCloseTo(anchor.logicalX);
    expect((scroll.top + 80) / 1).toBeCloseTo(anchor.logicalY);
  });
});
