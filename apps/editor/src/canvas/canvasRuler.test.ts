import { describe, expect, it } from 'vitest';
import { buildRulerTicks, guidePositionFromViewport, rulerScaleForZoom } from './canvasRuler';

describe('Photoshop-style canvas rulers', () => {
  it('keeps labelled tick spacing readable as zoom changes', () => {
    expect(rulerScaleForZoom(0.25)).toEqual({ major: 500, minor: 50 });
    expect(rulerScaleForZoom(1)).toEqual({ major: 100, minor: 10 });
    expect(rulerScaleForZoom(4)).toEqual({ major: 20, minor: 2 });
  });

  it('builds hierarchical major, medium, and minor ticks', () => {
    const ticks = buildRulerTicks(0, 100, { major: 100, minor: 10 });
    expect(ticks.find((tick) => tick.value === 0)?.kind).toBe('major');
    expect(ticks.find((tick) => tick.value === 50)?.kind).toBe('medium');
    expect(ticks.find((tick) => tick.value === 20)?.kind).toBe('minor');
  });

  it('converts viewport pointer positions back into composition pixels', () => {
    expect(
      guidePositionFromViewport(
        'vertical',
        { x: 500, y: 0 },
        { left: 100, top: 50 },
        { left: 200, top: 100 },
        { width: 1000, height: 500 },
        0.5,
      ),
    ).toBe(200);
  });
});
