import { describe, expect, it } from 'vitest';
import {
  outerDockDividerPlacement,
  outerDockPlacement,
  outerHorizontalPreviewSpan,
} from './outerDockPlacement';

describe('outer-edge corner priority', () => {
  it('makes the bottom region and its resize handle full width when bottom has priority', () => {
    expect(outerDockPlacement('bottom', true)).toEqual({ gridColumn: '1 / -1', gridRow: '5' });
    expect(outerDockDividerPlacement('bottom', true)).toEqual({
      gridColumn: '1 / -1',
      gridRow: '4',
    });
    for (const zone of ['left', 'right'] as const) {
      expect(outerDockPlacement(zone, true).gridRow).toBe('1 / 4');
      expect(outerDockDividerPlacement(zone, true).gridRow).toBe('1 / 4');
    }
  });

  it('preserves full-height outer sides when a side has priority', () => {
    expect(outerDockPlacement('bottom', false)).toEqual({ gridColumn: '3', gridRow: '5' });
    expect(outerDockDividerPlacement('bottom', false)).toEqual({ gridColumn: '3', gridRow: '4' });
    for (const zone of ['left', 'right'] as const) {
      expect(outerDockPlacement(zone, false).gridRow).toBe('1 / -1');
      expect(outerDockDividerPlacement(zone, false).gridRow).toBe('1 / -1');
    }
  });

  it('previews an outer bottom drop across the full workspace, while top stays regional', () => {
    expect(outerHorizontalPreviewSpan('bottom', 1920, 0, 1615)).toEqual({ left: 0, width: 1920 });
    expect(outerHorizontalPreviewSpan('top', 1920, 300, 1315)).toEqual({ left: 300, width: 1315 });
  });
});
