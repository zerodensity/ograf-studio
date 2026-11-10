import { describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createFieldDefinition,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { sampleCompiledLayerVisualState } from './loopRendering';
import * as modifierRendering from './modifierRendering';

describe('compiled automatic layout', () => {
  it('measures the current data for standalone Auto Size text with a clipping margin', () => {
    const headline = createLayerOfKind('text');
    if (headline.element.type !== 'text') throw new Error('Expected text');
    headline.element.autoFit = 'auto-size';
    headline.element.overflowPolicy = 'clip';
    headline.element.clipMarginX = 12;
    const field = createFieldDefinition('text', { key: 'headline', defaultValue: 'News' });
    headline.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    headline.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 50, width: 80, height: 40 })),
    ];
    const descriptor = compileDescriptor(
      createComposition({ layers: [headline], dataFields: [field] }),
    );
    const layer = descriptor.layers[0]!;
    const elements = new Map([[layer.id, { querySelector: () => null } as unknown as HTMLElement]]);
    const measure = vi
      .spyOn(modifierRendering, 'measureModifierText')
      .mockImplementation((_document, element) =>
        element.type === 'text' ? { width: element.content.length * 10, height: 30 } : null,
      );
    try {
      for (const content of ['News', 'A longer headline', 'News']) {
        const data = { headline: content };
        const state = sampleCompiledLayerVisualState(layer, 0, undefined, data);
        applyCompiledAutoLayout(descriptor, new Map([[layer.id, state]]), data, elements);
        expect(state.transform).toMatchObject({
          x: 100,
          y: 50,
          width: content.length * 10,
          height: 30,
        });
      }
      if (layer.element.type !== 'text') throw new Error('Expected compiled text');
      layer.element.clipMarginX = 0;
      const state = sampleCompiledLayerVisualState(layer, 0);
      applyCompiledAutoLayout(descriptor, new Map([[layer.id, state]]), {}, elements);
      expect(state.transform).toMatchObject({ width: 80, height: 40 });
      expect(measure).toHaveBeenCalledTimes(3);
    } finally {
      measure.mockRestore();
    }
  });

  it('consumes bound dimensions before arranging siblings', () => {
    const panel = createLayerOfKind('rectangle');
    const first = createLayerOfKind('rectangle');
    const second = createLayerOfKind('rectangle');
    first.parentId = panel.id;
    second.parentId = panel.id;
    panel.autoLayout = {
      ...panel.autoLayout,
      direction: 'horizontal',
      gap: 10,
      paddingLeft: 15,
      hugWidth: true,
    };
    panel.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, width: 400, height: 100 })),
    ];
    first.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 120, height: 30 }))];
    second.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 40, height: 30 }))];
    const width = createFieldDefinition('number', { key: 'width', defaultValue: 70 });
    first.bindings = [{ fieldId: width.id, targetProperty: 'layer.width' }];
    const descriptor = compileDescriptor(
      createComposition({ layers: [panel, first, second], dataFields: [width] }),
    );
    const states = new Map(
      descriptor.layers.map((layer) => [
        layer.id,
        sampleCompiledLayerVisualState(layer, 0, undefined, { width: 70 }),
      ]),
    );
    applyCompiledAutoLayout(descriptor, states);
    expect(states.get(first.id)!.transform.width).toBe(70);
    expect(states.get(second.id)!.transform.x).toBe(195);
    expect(states.get(panel.id)!.transform.width).toBe(135);
  });
  it('applies the authored flow identically to sampled runtime states', () => {
    const panel = createLayerOfKind('rectangle');
    const first = createLayerOfKind('text');
    const second = createLayerOfKind('ellipse');
    first.parentId = panel.id;
    second.parentId = panel.id;
    panel.autoLayout = {
      ...panel.autoLayout,
      direction: 'horizontal',
      gap: 10,
      paddingLeft: 15,
      paddingTop: 8,
      hugWidth: true,
    };
    panel.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 50, width: 400, height: 60 })),
    ];
    first.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 120, height: 30 }))];
    second.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 40, height: 40 }))];
    const descriptor = compileDescriptor(
      createComposition({ layers: [panel, first, second], backgroundColor: 'transparent' }),
    );
    const states = new Map(
      descriptor.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
    );

    applyCompiledAutoLayout(descriptor, states);

    expect(states.get(panel.id)!.transform.width).toBe(185);
    expect(states.get(first.id)!.transform).toMatchObject({ x: 115, y: 58 });
    expect(states.get(second.id)!.transform).toMatchObject({ x: 245, y: 58 });
  });
});
