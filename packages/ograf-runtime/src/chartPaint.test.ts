import { describe, expect, it, vi } from 'vitest';
import { createDefaultGradient, createShaderPaint } from '@ograf-editor/scene-model';
import { drawChartPaint } from './chartPaint';

function fixture() {
  const stops = vi.fn();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: stops })),
    createRadialGradient: vi.fn(() => ({ addColorStop: stops })),
    createConicGradient: vi.fn(() => ({ addColorStop: stops })),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  };
  return {
    context,
    stops,
    canvas: { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement,
    mask: { width: 640, height: 360 } as HTMLCanvasElement,
  };
}
describe('standard chart mark paint', () => {
  it.each([
    [0, 0],
    [0, 360],
    [640, 0],
  ])('defers %s by %s coverage without poisoning a later valid frame', (width, height) => {
    const { canvas, mask, context } = fixture();
    mask.width = width!;
    mask.height = height!;
    context.drawImage.mockImplementation((source: unknown) => {
      const input = source as HTMLCanvasElement;
      if (input.width <= 0 || input.height <= 0) throw new Error('zero-size canvas');
    });
    expect(() => drawChartPaint(canvas, mask, createDefaultGradient('radial'))).not.toThrow();
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.createRadialGradient).not.toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalled();
    mask.width = 640;
    mask.height = 360;
    drawChartPaint(canvas, mask, '#ffffff');
    expect(context.drawImage).toHaveBeenCalledWith(mask, 0, 0);
    expect([canvas.width, canvas.height]).toEqual([640, 360]);
  });
  it('clips a solid fill to exact provider coverage', () => {
    const { canvas, mask, context } = fixture();
    drawChartPaint(canvas, mask, '#2676ef');
    expect(context.fillStyle).toBe('#2676ef');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(context.drawImage).toHaveBeenCalledWith(mask, 0, 0);
    expect(context.globalCompositeOperation).toBe('source-over');
  });
  it.each(['linear', 'radial', 'conic'] as const)(
    'uses standard %s gradient stops including alpha',
    (type) => {
      const { canvas, mask, context, stops } = fixture();
      const paint = createDefaultGradient(type);
      paint.angle = 90;
      drawChartPaint(canvas, mask, paint);
      expect(stops).toHaveBeenCalledWith(0, 'rgba(255, 255, 255, 0.34)');
      expect(stops).toHaveBeenCalledWith(1, 'rgba(0, 19, 63, 0.42)');
      expect(context.drawImage).toHaveBeenCalledWith(mask, 0, 0);
      if (type === 'linear')
        expect(context.createLinearGradient.mock.calls[0] as number[]).toHaveLength(4);
    },
  );
  it('leaves shader painting to the shared native shader compositor', () => {
    const { canvas, mask, context } = fixture();
    drawChartPaint(canvas, mask, createShaderPaint());
    expect(context.fillRect).not.toHaveBeenCalled();
  });
});
