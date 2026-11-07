import { describe, expect, it } from 'vitest';
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

describe('compiled automatic layout', () => {
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
