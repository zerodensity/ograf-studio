import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createDefaultTransform,
  createLayerKeyframe,
  createProject,
  polygonBounds,
  transformBoundsPolygon,
} from '@ograf-editor/scene-model';
import { canvasInsertion } from './canvasInsertion';

describe('canvas insertion', () => {
  it('uses the centre of the visible viewport in composition coordinates', () => {
    const composition = createProject().compositions[0]!;
    const root = {
      querySelector: (selector: string) => ({
        getBoundingClientRect: () =>
          selector.includes('viewport')
            ? { left: 100, top: 50, width: 800, height: 400 }
            : { left: 200, top: 100, width: 960, height: 540 },
      }),
    } as unknown as Element;
    // At 50% zoom, the visible centre is (600, 300) composition pixels.
    expect(canvasInsertion(root, composition, 'text', [], 0)).toMatchObject({ x: 400, y: 268 });
    expect(
      canvasInsertion(root, composition, 'pattern', [], 0, { width: 800, height: 200 }),
    ).toMatchObject({ x: 200, y: 200 });
  });

  it('places a second chart alongside an existing chart when the canvas has room', () => {
    const composition = createProject().compositions[0]!;
    const first = createChartLayer();
    first.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 640, y: 360, width: 640, height: 360 })),
    ];
    composition.layers.push(first);
    const second = canvasInsertion(null, composition, 'chart', [], 0);
    expect(
      second.x >= 1280 || second.x + 640 <= 640 || second.y >= 720 || second.y + 360 <= 360,
    ).toBe(true);
    expect(second.x).toBeGreaterThanOrEqual(0);
    expect(second.y).toBeGreaterThanOrEqual(0);
    expect(second.x + 640).toBeLessThanOrEqual(composition.width);
    expect(second.y + 360).toBeLessThanOrEqual(composition.height);
    expect(first.keyframes[0]!.transform.x).toBe(640);
  });

  it('keeps the expected centered placement if there is no room, and ignores hidden charts', () => {
    const composition = createProject().compositions[0]!;
    composition.width = 640;
    composition.height = 360;
    const first = createChartLayer();
    first.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0, width: 640, height: 360 })),
    ];
    composition.layers.push(first);
    expect(canvasInsertion(null, composition, 'chart', [], 0)).toEqual({ x: 0, y: 0 });
    first.isVisible = false;
    expect(canvasInsertion(null, composition, 'chart', [], 0)).toEqual({ x: 0, y: 0 });
  });

  it('avoids the rotated bounds around a chart’s actual origin at the current frame', () => {
    const composition = createProject().compositions[0]!;
    const first = createChartLayer();
    const pose = createDefaultTransform({
      x: 450,
      y: 360,
      width: 640,
      height: 360,
      rotation: 45,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    first.keyframes = [createLayerKeyframe(0, pose)];
    composition.layers.push(first);
    const actual = polygonBounds(transformBoundsPolygon(pose), pose)!;
    const second = canvasInsertion(null, composition, 'chart', [], 0);
    expect(
      second.x + 640 <= actual.x ||
        second.x >= actual.x + actual.width ||
        second.y + 360 <= actual.y ||
        second.y >= actual.y + actual.height,
    ).toBe(true);
  });

  it('uses the currently displayed frame when placing beside an animated chart', () => {
    const composition = createProject().compositions[0]!;
    const first = createChartLayer();
    first.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0, width: 640, height: 360 })),
      createLayerKeyframe(12, createDefaultTransform({ x: 640, y: 360, width: 640, height: 360 })),
    ];
    composition.layers.push(first);
    expect(canvasInsertion(null, composition, 'chart', [], 0)).toEqual({ x: 640, y: 360 });
    expect(canvasInsertion(null, composition, 'chart', [], 12)).not.toEqual({ x: 640, y: 360 });
  });
});
