import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@ograf-editor/ograf-runtime', async () => ({
  ...(await import('../../../../packages/ograf-runtime/src/loopRendering')),
  ...(await import('../../../../packages/ograf-runtime/src/runtimeVisualRules')),
  ...(await import('../../../../packages/ograf-runtime/src/buildRuntimeTimeline')),
}));
import {
  createComposition,
  createFieldDefinition,
  createLayerVisualRule,
  createRectangleLayer,
  createLayerKeyframe,
  createDefaultTransform,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { sampleCompiledLayerVisualState } from '@ograf-editor/ograf-runtime';
import { editorRuntimeData } from './masterTimeline';
import { useTestDataStore } from '../state/testDataStore';

beforeEach(() => useTestDataStore.getState().resetAll());

describe('Studio geometry rules in the shared timeline sampler', () => {
  it('publishes group targets and releases back to the authored size', () => {
    const field = createFieldDefinition('integer', { key: 'count', defaultValue: 3 });
    const controller = createRectangleLayer();
    const panel = createRectangleLayer();
    const spine = createRectangleLayer();
    panel.name = 'Panel';
    spine.name = 'Spine';
    panel.groupId = spine.groupId = 'parts';
    for (const layer of [panel, spine])
      layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ height: 531 }))];
    controller.visualRules = [
      createLayerVisualRule({
        fieldId: field.id,
        operator: 'equals',
        value: 1,
        actions: [
          { type: 'property', targetGroupId: 'parts', targetProperty: 'height', value: 261 },
        ],
      }),
    ];
    const composition = createComposition({
      layers: [controller, panel, spine],
      dataFields: [field],
    });
    const descriptor = compileDescriptor(composition);
    for (const [count, height] of [
      [3, 531],
      [1, 261],
      [3, 531],
    ]) {
      useTestDataStore.getState().setValue(field.id, count!);
      const data = editorRuntimeData(composition, descriptor.layers);
      for (const source of [panel, spine]) {
        const compiled = descriptor.layers.find((layer) => layer.id === source.id)!;
        expect(sampleCompiledLayerVisualState(compiled, 0, undefined, data).transform.height).toBe(
          height,
        );
      }
    }
  });

  it('retains simulated event geometry until reset', () => {
    const panel = createRectangleLayer();
    panel.keyframes = [createLayerKeyframe(0, createDefaultTransform({ height: 531 }))];
    const composition = createComposition({ layers: [panel] });
    const descriptor = compileDescriptor(composition);
    useTestDataStore.setState({
      visualRuleStateOverrides: {
        [panel.id]: { properties: { 'layer.height': 119 }, transitionFrames: {} },
      },
    });
    let data = editorRuntimeData(composition, descriptor.layers);
    expect(
      sampleCompiledLayerVisualState(descriptor.layers[0]!, 0, undefined, data).transform.height,
    ).toBe(119);
    useTestDataStore.getState().resetVisualRuleSimulation();
    data = editorRuntimeData(composition, descriptor.layers);
    expect(
      sampleCompiledLayerVisualState(descriptor.layers[0]!, 0, undefined, data).transform.height,
    ).toBe(531);
  });
});
