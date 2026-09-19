import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  createComposition,
  createShaderPaint,
  getElementShaderPaint,
  createLayerOfKind,
  createLayerKeyframe,
  defaultTransformForRole,
  syncCompositionShaderParameterFields,
} from '@ograf-editor/scene-model';
import { canReusePreviewForShaderParameters } from './shaderPreviewReuse';

function fixture() {
  const composition = createComposition();
  composition.layers = [createLayerOfKind('shader'), createLayerOfKind('text')];
  for (const layer of composition.layers) {
    layer.keyframes = [createLayerKeyframe(0, defaultTransformForRole(layer.element.type, 'step'))];
  }
  syncCompositionShaderParameterFields(composition);
  return compileDescriptor(composition);
}

describe('on-air shader parameter preview reuse', () => {
  it('keeps fill and outline uniform edits independent on the same text object', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected text');
    layer.element.fill = createShaderPaint();
    layer.element.strokePaint = createShaderPaint();
    layer.element.strokeWidth = 24;
    layer.keyframes = [createLayerKeyframe(0, defaultTransformForRole('text', 'step'))];
    composition.layers = [layer];
    syncCompositionShaderParameterFields(composition);
    const previous = compileDescriptor(composition);
    const next = structuredClone(previous);
    getElementShaderPaint(next.layers[0]!.element, 'stroke')!.parameters.waveFrequency = 3;
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(true);
    expect(getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency).toBe(8);
    getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency = 4;
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(true);
    if (next.layers[0]!.element.type !== 'text') throw new Error('Expected text');
    next.layers[0]!.element.content = 'Edited text';
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(false);
  });
  it('retains an instance for public parameter edits while keeping authored descriptors intact', () => {
    const previous = fixture();
    const next = structuredClone(previous);
    const shader = getElementShaderPaint(next.layers[0]!.element)!;
    if (shader.type !== 'shader') throw new Error('Expected shader');
    shader.parameters.waveFrequency = 4.5;
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(true);
    expect(getElementShaderPaint(previous.layers[0]!.element)).toMatchObject({
      parameters: { waveFrequency: 8 },
    });
    expect(getElementShaderPaint(next.layers[0]!.element)).toMatchObject({
      parameters: { waveFrequency: 4.5 },
    });
    const another = structuredClone(next);
    getElementShaderPaint(another.layers[0]!.element)!.parameters.waveFrequency = 6;
    expect(canReusePreviewForShaderParameters(next, another)).toBe(true);
  });

  it('rebuilds for source, renderer settings, poses, visibility or binding changes', () => {
    const previous = fixture();
    const next = structuredClone(previous);
    getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency = 4.5;
    const mutations = [
      (copy: typeof next) => {
        if (getElementShaderPaint(copy.layers[0]!.element))
          getElementShaderPaint(copy.layers[0]!.element)!.fragmentSource += '\n// edited';
      },
      (copy: typeof next) => {
        if (getElementShaderPaint(copy.layers[0]!.element))
          getElementShaderPaint(copy.layers[0]!.element)!.resolutionScale = 0.5;
      },
      (copy: typeof next) => {
        if (getElementShaderPaint(copy.layers[0]!.element))
          getElementShaderPaint(copy.layers[0]!.element)!.speed = 2;
      },
      (copy: typeof next) => {
        copy.layers[0]!.keyframes[0]!.transform.width += 10;
      },
      (copy: typeof next) => {
        copy.layers[0]!.isVisible = false;
      },
      (copy: typeof next) => {
        copy.layers[0]!.bindings[0]!.dataKey = 'renamed';
      },
      (copy: typeof next) => {
        copy.width += 100;
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(next);
      mutate(copy);
      expect(canReusePreviewForShaderParameters(previous, copy)).toBe(false);
    }
  });

  it('does not swallow unbound, mapped or invalid parameter edits', () => {
    for (const bindingMode of ['missing', 'mapped', 'nested'] as const) {
      const previous = fixture();
      const binding = previous.layers[0]!.bindings.find(
        (item) => item.targetProperty === 'fill.parameters.waveFrequency',
      )!;
      if (bindingMode === 'missing')
        previous.layers[0]!.bindings = previous.layers[0]!.bindings.filter(
          (item) => item !== binding,
        );
      if (bindingMode === 'mapped') binding.valueMap = { low: 1, high: 2 };
      if (bindingMode === 'nested') binding.sourcePath = ['frequency'];
      const next = structuredClone(previous);
      getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency = 4.5;
      expect(canReusePreviewForShaderParameters(previous, next)).toBe(false);
    }
    const previous = fixture();
    const next = structuredClone(previous);
    getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency = false;
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(false);
  });

  it('preserves ordinary authoring rebuilds and does not hide simultaneous text changes', () => {
    const previous = fixture();
    expect(canReusePreviewForShaderParameters(previous, previous)).toBe(true);
    expect(canReusePreviewForShaderParameters(previous, structuredClone(previous))).toBe(false);
    const next = structuredClone(previous);
    if (next.layers[1]!.element.type !== 'text') throw new Error('Expected layers');
    getElementShaderPaint(next.layers[0]!.element)!.parameters.waveFrequency = 4.5;
    next.layers[1]!.element.content = 'Changed headline';
    expect(canReusePreviewForShaderParameters(previous, next)).toBe(false);
  });
});
