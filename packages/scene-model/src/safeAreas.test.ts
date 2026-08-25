import { describe, expect, it } from 'vitest';
import { getEbuR95SafeAreas } from './safeAreas';

describe('EBU R 95 safe areas', () => {
  it('matches the published 1920x1080 16:9 raster geometry', () => {
    expect(getEbuR95SafeAreas({ width: 1920, height: 1080 })).toEqual({
      actionSafe: { x: 67, y: 38, width: 1786, height: 1004 },
      titleSafe: { x: 96, y: 54, width: 1728, height: 972 },
    });
  });

  it('matches the published 3840x2160 16:9 raster geometry', () => {
    expect(getEbuR95SafeAreas({ width: 3840, height: 2160 })).toEqual({
      actionSafe: { x: 134, y: 76, width: 3572, height: 2008 },
      titleSafe: { x: 192, y: 108, width: 3456, height: 1944 },
    });
  });
});
