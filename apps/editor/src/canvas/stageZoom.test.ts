import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE_ZOOM,
  MIN_STAGE_ZOOM,
  captureStageZoomAnchor,
  nextStageZoom,
  scrollForStageZoom,
  stageZoomDirectionForWheel,
} from './stageZoom';

describe('stage zoom', () => {
  it('zooms in and out within a safe range', () => {
    expect(nextStageZoom(1, 'in')).toBeGreaterThan(1);
    expect(nextStageZoom(1, 'out')).toBeLessThan(1);
    expect(nextStageZoom(MAX_STAGE_ZOOM, 'in')).toBe(MAX_STAGE_ZOOM);
    expect(nextStageZoom(MIN_STAGE_ZOOM, 'out')).toBe(MIN_STAGE_ZOOM);
  });

  it('maps an unmodified vertical mouse wheel directly to canvas zoom', () => {
    expect(stageZoomDirectionForWheel(-120)).toBe('in');
    expect(stageZoomDirectionForWheel(120)).toBe('out');
    expect(stageZoomDirectionForWheel(0)).toBeNull();
    expect(stageZoomDirectionForWheel(Number.NaN)).toBeNull();
  });

  it('keeps the logical point under the pointer stable', () => {
    const origin = { x: 100_000, y: 100_000 };
    const anchor = captureStageZoomAnchor(0.5, 99_800, 99_700, 120, 80, origin.x, origin.y);
    const scroll = scrollForStageZoom(anchor, 1, origin.x, origin.y);
    expect((scroll.left + 120 - origin.x) / 1).toBeCloseTo(anchor.logicalX);
    expect((scroll.top + 80 - origin.y) / 1).toBeCloseTo(anchor.logicalY);
  });
});
