import { describe, expect, it } from 'vitest';
import {
  createProject,
  createRectangleLayer,
  createLayerKeyframe,
  createDefaultTransform,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { sampleCompiledLayerVisualState } from './loopRendering';
import { motionBlurKernel, sampleMotionBlur } from './motionBlurRendering';

describe('experimental motion blur', () => {
  it('samples the same velocity after backwards seeks and retains the setting in the export descriptor', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createRectangleLayer();
    layer.motionBlur = { enabled: true, shutterAngle: 180 };
    layer.keyframes.push(
      createLayerKeyframe(0, createDefaultTransform({ x: 0, y: 0 })),
      createLayerKeyframe(10, createDefaultTransform({ x: 100, y: 50 })),
    );
    composition.layers.push(layer);
    const compiled = compileDescriptor(composition).layers.find((item) => item.id === layer.id)!;
    expect(compiled.motionBlur).toEqual({ enabled: true, shutterAngle: 180 });
    const at = (frame: number) => sampleCompiledLayerVisualState(compiled, frame).motionBlur;
    const first = at(5);
    expect(first?.dx).toBeCloseTo(10);
    expect(first?.dy).toBeCloseTo(5);
    at(9);
    expect(at(5)).toEqual(first);
    expect(sampleCompiledLayerVisualState(compiled, 10).motionBlur).toBeUndefined();
    expect(sampleCompiledLayerVisualState(compiled, 100).motionBlur).toBeUndefined();
    const kernel = motionBlurKernel(first!);
    expect(
      kernel.kernel
        .split(' ')
        .map(Number)
        .reduce((a, b) => a + b, 0),
    ).toBe(9);
    expect(kernel.padding).toBeGreaterThan(3);
  });
  it('does not invent velocity for an externally bound coordinate and caps filter spread', () => {
    const project = createProject();
    const c = project.compositions[0]!;
    const layer = createRectangleLayer();
    layer.keyframes.push(createLayerKeyframe(0, createDefaultTransform()));
    c.layers.push(layer);
    const compiled = compileDescriptor(c).layers[0]!;
    compiled.motionBlur = { enabled: true, shutterAngle: 180 };
    compiled.bindings = [{ dataKey: 'x', targetProperty: 'x', sourcePath: [] }];
    expect(sampleMotionBlur(compiled, 5, undefined, createDefaultTransform())).toBeUndefined();
    compiled.motionPath = {
      sourceLayerId: 'path',
      progress: 0.5,
      offsetX: 0,
      offsetY: 0,
      orientToPath: false,
    };
    expect(sampleMotionBlur(compiled, 5, undefined, createDefaultTransform())).toBeUndefined();
    expect(motionBlurKernel({ dx: 1000, dy: 0, shutterAngle: 360 }).padding).toBe(43);
  });
});
