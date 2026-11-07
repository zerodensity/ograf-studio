import { describe, expect, it, vi } from 'vitest';
import type { ChartMarkPose } from '@ograf-editor/scene-model';
import { chartMarkBounds, drawChartMarkPose } from './markAnimation';

const pose: ChartMarkPose = {
  x: 10,
  y: -20,
  rotation: 90,
  opacity: 0.25,
  scale: 0.5,
  clipLeft: 0.2,
  clipRight: 0.3,
  clipTop: 0.1,
  clipBottom: 0,
  blur: 4,
};

describe('per-mark canvas animation drawing', () => {
  it('finds positive and negative bar bounds from their actual baseline', () => {
    expect(chartMarkBounds({ x: 30, y: 80, base: 20, width: 10, height: 60 })).toEqual({
      x: 25,
      y: 20,
      width: 10,
      height: 60,
    });
    expect(
      chartMarkBounds({ x: 30, y: 80, base: 90, width: 60, height: 10, horizontal: true }),
    ).toEqual({ x: 30, y: 75, width: 60, height: 10 });
  });

  it('pivots each slice about its own sector bounds, including wraparound and full circles', () => {
    const bounds = chartMarkBounds({
      x: 100,
      y: 100,
      innerRadius: 0,
      outerRadius: 50,
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    expect(bounds.x).toBeCloseTo(100);
    expect(bounds.y).toBeCloseTo(100);
    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(50);
    const crossing = chartMarkBounds({
      x: 0,
      y: 0,
      innerRadius: 20,
      outerRadius: 50,
      startAngle: Math.PI * 1.75,
      endAngle: Math.PI * 2.25,
    });
    expect(crossing.x).toBeCloseTo(Math.SQRT1_2 * 20);
    expect(crossing.width + crossing.x).toBeCloseTo(50);
    expect(crossing.y).toBeCloseTo(-Math.SQRT1_2 * 50);
    expect(
      chartMarkBounds({ x: 100, y: 100, outerRadius: 50, startAngle: 0, endAngle: Math.PI * 2 }),
    ).toEqual({ x: 50, y: 50, width: 100, height: 100 });
  });

  it('applies mark-local transform, normalized clip and alpha while always restoring context', () => {
    const ctx = {
      globalAlpha: 0.8,
      filter: 'contrast(2)',
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    };
    const failure = new Error('test drawing failure');
    expect(() =>
      drawChartMarkPose(
        ctx as unknown as CanvasRenderingContext2D,
        { x: 100, y: 200, width: 80, height: 40 },
        pose,
        () => {
          expect(ctx.globalAlpha).toBeCloseTo(0.2);
          expect(ctx.filter).toBe('contrast(2) blur(4px)');
          throw failure;
        },
      ),
    ).toThrow(failure);
    expect(ctx.translate.mock.calls).toEqual([
      [150, 200],
      [-140, -220],
    ]);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
    expect(ctx.rect).toHaveBeenCalledWith(116, 204, 40, 36);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('does not clip foreground value labels to the filled bar, or touch a no-preset context', () => {
    const ctx = {
      globalAlpha: 1,
      filter: 'none',
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    };
    const draw = vi.fn();
    const bounds = { x: 0, y: 0, width: 80, height: 40 };
    drawChartMarkPose(ctx as unknown as CanvasRenderingContext2D, bounds, pose, draw, false);
    expect(ctx.clip).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledTimes(1);
    ctx.save.mockClear();
    drawChartMarkPose(ctx as unknown as CanvasRenderingContext2D, bounds, null, draw);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
