import { describe, expect, it } from 'vitest';
import type { CompiledLayer, CompiledLayerVisualRule } from '@ograf-editor/ograf-types';
import { createCornerRadii, createLayerEffects } from '@ograf-editor/scene-model';
import { sampleCompiledLayerVisualState } from './loopRendering';
import { publishRuntimeVisualRuleEffect, RuntimeVisualRules } from './runtimeVisualRules';

function layer(visualRules: CompiledLayerVisualRule[] = []): CompiledLayer {
  return {
    id: 'button',
    isVisible: true,
    element: {
      type: 'rectangle',
      fill: '#fff',
      strokeColor: 'transparent',
      strokeWidth: 0,
      borderRadius: createCornerRadii(),
    },
    effects: createLayerEffects(),
    keyframes: [
      {
        id: 'base',
        frame: 0,
        easing: 'linear',
        transform: {
          x: 100,
          y: 50,
          width: 200,
          height: 80,
          rotation: 5,
          opacity: 0.8,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        },
      },
    ],
    animationTracks: {},
    ...(visualRules.length ? { visualRules } : {}),
  } as CompiledLayer;
}

const bigRule = (transitionFrames?: number): CompiledLayerVisualRule => ({
  id: 'big',
  name: 'Big',
  enabled: true,
  trigger: 'data',
  dataKey: 'big',
  sourcePath: [],
  operator: 'equals',
  value: true,
  actions: [
    {
      type: 'property',
      targetProperty: 'layer.offsetX',
      value: 30,
      ...(transitionFrames ? { transitionFrames } : {}),
    },
    { type: 'property', targetProperty: 'layer.scale', value: 1.5 },
    { type: 'property', targetProperty: 'layer.opacity', value: 0.5 },
  ],
});

describe('layer properties driven by rules', () => {
  it('offsets the animated pose while the rule holds', () => {
    const compiled = layer([bigRule()]);
    const on = sampleCompiledLayerVisualState(compiled, 0, undefined, { big: true });
    expect(on.transform).toMatchObject({ x: 130, y: 50, rotation: 5, opacity: 0.4 });
    expect(on.paintTracks.scale?.[0]?.value).toBe(1.5);

    const off = sampleCompiledLayerVisualState(compiled, 0, undefined, { big: false });
    expect(off.transform).toMatchObject({ x: 100, opacity: 0.8 });
    expect(off.paintTracks.scale).toBeUndefined();
  });

  it('uses the effect published for a layer that another layer drives', () => {
    const compiled = layer();
    publishRuntimeVisualRuleEffect(compiled, {
      properties: { 'layer.rotation': 15, 'layer.offsetY': -10 },
      transitionFrames: {},
    });
    expect(sampleCompiledLayerVisualState(compiled, 0).transform).toMatchObject({
      y: 40,
      rotation: 20,
    });
  });

  it('animates from no change when a rule starts', () => {
    const compiled = layer([bigRule(10)]);
    const rules = new RuntimeVisualRules([compiled], 50);
    rules.update({ big: false }, 0);
    rules.update({ big: true }, 0);
    rules.publish(100); // halfway through 10 frames at 50 fps
    const x = sampleCompiledLayerVisualState(compiled, 0).transform.x;
    expect(x).toBeGreaterThan(100);
    expect(x).toBeLessThan(130);
    rules.publish(1000);
    expect(sampleCompiledLayerVisualState(compiled, 0).transform.x).toBe(130);
  });

  it('uses legacy OTS panel, spine and foot geometry without changing source rules', () => {
    for (const [property, values] of [
      ['height', [531, 261, 396, 531]],
      ['height', [389, 119, 254, 389]],
      ['y', [556, 286, 421, 556]],
    ] as const) {
      const compiled = layer(
        values.map((value, index) => ({
          id: `count-${index}`,
          name: 'Story count layout',
          enabled: true,
          trigger: 'data',
          dataKey: 'count',
          sourcePath: [],
          operator: 'equals',
          value: index,
          actions: [{ type: 'property', targetProperty: property, value }],
        })),
      );
      for (let count = 0; count < values.length; count++)
        expect(
          sampleCompiledLayerVisualState(compiled, 0, undefined, { count }).transform[property],
        ).toBe(values[count]);
      expect(compiled.element).not.toHaveProperty(property);
    }
  });

  it('keeps timeline channels and additive offsets while replacing only selected geometry', () => {
    const compiled = layer([
      {
        ...bigRule(),
        actions: [
          { type: 'property', targetProperty: 'layer.height', value: 261 },
          { type: 'property', targetProperty: 'y', value: 286 },
          { type: 'property', targetProperty: 'layer.offsetY', value: 12 },
        ],
      },
    ]);
    compiled.animationTracks.x = [
      { id: 'a', frame: 0, value: 100, easing: 'linear' },
      { id: 'b', frame: 10, value: 200, easing: 'linear' },
    ];
    expect(
      sampleCompiledLayerVisualState(compiled, 5, undefined, { big: true }).transform,
    ).toMatchObject({ x: 150, y: 298, height: 261, width: 200, rotation: 5, opacity: 0.8 });
    expect(
      sampleCompiledLayerVisualState(compiled, 5, undefined, { big: false }).transform,
    ).toMatchObject({ x: 150, y: 50, height: 80 });
  });

  it('animates size from the current authored pose and releases back to it', () => {
    const compiled = layer([
      {
        ...bigRule(),
        actions: [{ type: 'property', targetProperty: 'height', value: 300, transitionFrames: 10 }],
      },
    ]);
    const rules = new RuntimeVisualRules([compiled], 50, () => ({
      ...compiled.keyframes[0]!.transform,
      height: 100,
    }));
    rules.update({ big: false }, 0);
    rules.update({ big: true }, 0);
    rules.publish(100);
    expect(sampleCompiledLayerVisualState(compiled, 0).transform.height).toBe(200);
    rules.publish(200);
    expect(sampleCompiledLayerVisualState(compiled, 0).transform.height).toBe(300);
    rules.update({ big: false }, 200);
    rules.publish(300);
    expect(sampleCompiledLayerVisualState(compiled, 0).transform.height).toBe(200);
    rules.publish(400);
    expect(sampleCompiledLayerVisualState(compiled, 0).transform.height).toBe(80);
  });

  it('uses published geometry for rules targeting other objects', () => {
    const compiled = layer();
    publishRuntimeVisualRuleEffect(compiled, {
      properties: { 'layer.width': 0, 'layer.height': 119 },
      transitionFrames: {},
    });
    expect(sampleCompiledLayerVisualState(compiled, 0).transform).toMatchObject({
      width: 0,
      height: 119,
    });
    expect(
      sampleCompiledLayerVisualState(compiled, 0, undefined, {}, { skipRulePose: true }).transform,
    ).toMatchObject({ width: 200, height: 80 });
  });
});
