import { describe, expect, it } from 'vitest';
import { applyElementDataValue, readElementDataValue } from './boundPaint';
import { createLayerOfKind } from './factory';
import {
  applyLayerRuleGeometry,
  layerRuleModifiers,
  layerRulePropertyValueError,
} from './layerRuleProperties';
import {
  collectVisualRuleStates,
  createLayerVisualRule,
  applyVisualRuleEventActions,
  releaseVisualRuleOverrides,
} from './visualRules';

describe('Rules geometry channels', () => {
  it('reads legacy geometry as real pose overrides and keeps offsets separate', () => {
    const layer = createLayerOfKind('rectangle');
    const pose = {
      x: 10,
      y: 20,
      width: 500,
      height: 531,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    };
    const modifiers = layerRuleModifiers({ height: '261', 'layer.y': 286, 'layer.offsetY': 12 });
    expect(applyLayerRuleGeometry(pose, modifiers)).toMatchObject({ height: 261, y: 286 });
    expect(modifiers?.offsetY).toBe(12);
    expect(pose.height).not.toBe(261);
    expect(applyElementDataValue(layer.element, 'height', 261)).toBe(layer.element);
    expect(readElementDataValue(layer.element, 'layer.height')).toBeUndefined();
  });

  it.each([undefined, null, '', ' ', true, [], {}, NaN, Infinity, -1])(
    'rejects invalid sizes: %s',
    (value) => {
      expect(layerRulePropertyValueError('height', value)).not.toBeNull();
      expect(layerRuleModifiers({ 'layer.height': value })?.geometry).toBeUndefined();
    },
  );

  it('allows zero dimensions and negative coordinates', () => {
    expect(layerRuleModifiers({ 'layer.width': 0, height: '0', x: -20 })?.geometry).toEqual({
      width: 0,
      height: 0,
      x: -20,
    });
  });

  it('canonicalizes aliases before rule ordering and event release', () => {
    const first = createLayerVisualRule({
      fieldId: 'count',
      value: 1,
      actions: [{ type: 'property', targetProperty: 'layer.height', value: 531 }],
    });
    const second = createLayerVisualRule({
      fieldId: 'count',
      value: 1,
      actions: [{ type: 'property', targetProperty: 'height', value: 261 }],
    });
    const engine = {
      hosts: [{ layerId: 'panel', rules: [first, second] }],
      reader: { read: () => 1, readCompare: () => null },
    };
    const state = collectVisualRuleStates(engine, {});
    expect(state.get('panel')?.properties).toEqual({ 'layer.height': 261 });
    const clicked = applyVisualRuleEventActions(
      engine,
      new Map(),
      [{ type: 'property', targetProperty: 'height', value: 396 }],
      'panel',
      () => true,
    );
    expect(clicked.get('panel')?.properties).toEqual({ 'layer.height': 396 });
    const releaseEngine = {
      ...engine,
      reader: {
        read: (_condition: unknown, _host: string, data: { count: number }) => data.count,
        readCompare: () => null,
      },
    };
    expect(
      releaseVisualRuleOverrides(
        releaseEngine,
        clicked,
        { data: { count: 0 } },
        { data: { count: 1 } },
      ).size,
    ).toBe(0);
  });
});
