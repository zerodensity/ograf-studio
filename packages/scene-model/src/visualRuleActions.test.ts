import { describe, expect, it } from 'vitest';
import { applyElementDataValue, readElementDataValue } from './boundPaint';
import { clockTimerActionId, parseClockTimerActionId } from './clockTimer';
import { layerRuleModifiers } from './layerRuleProperties';
import {
  coerceVisualRuleSetDataValue,
  createLayerVisualRule,
  pruneVisualRuleReferences,
  remapVisualRule,
  visualRuleActionTargets,
  visualRuleFieldIds,
  visualRuleGroupMembers,
  visualRuleSetDataValue,
} from './visualRules';
import { createCornerRadii } from './cornerRadii';
import type { Composition, RectangleElement } from './types';

const rectangle = (): RectangleElement => ({
  type: 'rectangle',
  fill: '#fff',
  strokeColor: '#000',
  strokeWidth: 0,
  borderRadius: createCornerRadii(),
});

describe('set-data rule actions', () => {
  it('sets, toggles and steps a value', () => {
    expect(visualRuleSetDataValue({ mode: 'set', value: 'live' }, 'old')).toBe('live');
    expect(visualRuleSetDataValue({ mode: 'toggle' }, undefined)).toBe(true);
    expect(visualRuleSetDataValue({ mode: 'toggle' }, 'false')).toBe(true);
    expect(visualRuleSetDataValue({ mode: 'toggle' }, true)).toBe(false);
    expect(visualRuleSetDataValue({ mode: 'increase' }, undefined)).toBe(1);
    expect(visualRuleSetDataValue({ mode: 'increase', value: 2 }, '4')).toBe(6);
    expect(visualRuleSetDataValue({ mode: 'decrease', value: '0.5' }, 3)).toBe(2.5);
  });

  it('stores an authored value as the field type', () => {
    expect(coerceVisualRuleSetDataValue('number', '3.5')).toBe(3.5);
    expect(coerceVisualRuleSetDataValue('integer', '3.6')).toBe(4);
    expect(coerceVisualRuleSetDataValue('boolean', 'false')).toBe(false);
    expect(coerceVisualRuleSetDataValue('boolean', 'yes')).toBe(true);
    expect(coerceVisualRuleSetDataValue('text', 5)).toBe('5');
  });

  it('counts the changed field as one the rule uses, and follows it when copied or deleted', () => {
    const rule = createLayerVisualRule({
      trigger: 'click',
      actions: [{ type: 'set-data', fieldId: 'score', mode: 'increase' }],
    });
    expect(visualRuleFieldIds(rule)).toEqual(['score']);
    const copy = remapVisualRule(rule, { fieldIds: new Map([['score', 'score-2']]) });
    expect(copy.actions).toEqual([{ type: 'set-data', fieldId: 'score-2', mode: 'increase' }]);

    const composition = {
      layers: [{ id: 'button', element: rectangle(), visualRules: [rule] }],
      dataFields: [],
      customActions: [],
      mediaCues: [],
      keyframes: [],
    } as unknown as Composition;
    pruneVisualRuleReferences(composition);
    expect(composition.layers[0]!.visualRules).toEqual([]);
  });
});

describe('rule properties', () => {
  it('turns layer properties into offsets on top of the animation', () => {
    expect(layerRuleModifiers({ fill: '#f00' })).toBeNull();
    expect(
      layerRuleModifiers({ 'layer.offsetX': '12', 'layer.scale': 1.2, 'layer.opacity': 4 }),
    ).toEqual({ offsetX: 12, offsetY: 0, rotation: 0, scale: 1.2, opacity: 1 });
  });

  it('leaves the element alone for layer properties', () => {
    const element = rectangle();
    expect(applyElementDataValue(element, 'layer.scale', 2)).toBe(element);
    expect(readElementDataValue(element, 'layer.scale')).toBeUndefined();
  });

  it('keeps outline width numeric and sets every corner from one radius', () => {
    expect(applyElementDataValue(rectangle(), 'strokeWidth', '4')).toMatchObject({
      strokeWidth: 4,
    });
    const rounded = applyElementDataValue(rectangle(), 'cornerRadius', 12);
    expect(rounded).toMatchObject({
      borderRadius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
    });
    expect(readElementDataValue(rounded, 'cornerRadius')).toBe(12);
  });
});

describe('clock/timer action ids', () => {
  it('round-trips the layer and command', () => {
    const id = clockTimerActionId('timer:1', 'pause');
    expect(parseClockTimerActionId(id)).toEqual({ layerId: 'timer:1', command: 'pause' });
    expect(parseClockTimerActionId('show-score')).toBeNull();
  });
});

describe('group targets', () => {
  it('drive every layer of an editor group and are pruned when the group is gone', () => {
    const layers = [
      { id: 'a', groupId: 'g1' },
      { id: 'b', groupId: 'g1' },
      { id: 'c', groupId: null },
    ];
    const groups = visualRuleGroupMembers(layers);
    expect(groups.get('g1')).toEqual(['a', 'b']);
    const engine = {
      hosts: [],
      reader: { read: () => undefined, readCompare: () => null },
      resolveGroup: (id: string) => groups.get(id) ?? [],
    };
    expect(
      visualRuleActionTargets(
        engine,
        { type: 'visibility', visible: false, targetGroupId: 'g1' },
        'c',
      ),
    ).toEqual(['a', 'b']);

    const rule = createLayerVisualRule({
      trigger: 'click',
      actions: [{ type: 'visibility', visible: false, targetGroupId: 'gone' }],
    });
    const composition = {
      layers: [{ id: 'c', groupId: null, element: rectangle(), visualRules: [rule] }],
      dataFields: [],
      customActions: [],
      mediaCues: [],
      keyframes: [],
    } as unknown as Composition;
    pruneVisualRuleReferences(composition);
    expect(composition.layers[0]!.visualRules).toEqual([]);
  });
});
