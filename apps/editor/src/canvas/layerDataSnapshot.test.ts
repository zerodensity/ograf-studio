import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createLayerOfKind,
  createLayerVisualRule,
  type LayerBinding,
} from '@ograf-editor/scene-model';
import { editorVisualRuleEffects, resolveEffectiveElement } from '../state/dataBinding';
import {
  EMPTY_LAYER_RULE_EFFECT,
  stableLayerBindingValues,
  stableLayerRuleEffect,
} from './layerDataSnapshot';

const binding = (fieldId: string, targetProperty = 'content'): LayerBinding => ({
  fieldId,
  targetProperty,
});

describe('per-layer live data snapshots', () => {
  it('retains unbound and unchanged bound snapshots while unrelated quotes change', () => {
    const empty = {};
    expect(stableLayerBindingValues(empty, [], { quote: 20 })).toBe(empty);
    const previous = { label: 'Bitcoin' };
    expect(
      stableLayerBindingValues(previous, [binding('label')], { label: 'Bitcoin', quote: 21 }),
    ).toBe(previous);
    const changed = stableLayerBindingValues(previous, [binding('label')], {
      label: 'Ethereum',
      quote: 22,
    });
    expect(changed).not.toBe(previous);
    expect(changed).toEqual({ label: 'Ethereum' });
    expect(previous).toEqual({ label: 'Bitcoin' });
  });

  it('retains object/array identity until the referenced value actually changes', () => {
    const items = [{ id: 'btc', price: 20 }];
    const previous = { feed: items };
    const bindings = [binding('feed', 'items'), binding('feed', 'another-target')];
    expect(stableLayerBindingValues(previous, bindings, { feed: items, other: true })).toBe(
      previous,
    );
    const nextItems = [{ id: 'btc', price: 21 }];
    expect(stableLayerBindingValues(previous, bindings, { feed: nextItems })).toEqual({
      feed: nextItems,
    });
  });

  it('drops removed overrides and follows a retargeted binding without keeping stale data', () => {
    const previous = { old: 'old override' };
    expect(stableLayerBindingValues(previous, [binding('old')], {})).toEqual({});
    expect(
      stableLayerBindingValues(previous, [binding('new')], {
        old: 'old override',
        new: 'new override',
      }),
    ).toEqual({ new: 'new override' });
    expect(stableLayerBindingValues(previous, [], previous)).toEqual({});
  });
});

describe('stable effective Rules output', () => {
  it('retains equivalent results but responds to visibility, property and transition changes', () => {
    const previous = {
      visibility: true,
      properties: { color: '#ffffff' },
      transitionFrames: { color: 8 },
    };
    expect(stableLayerRuleEffect(previous, structuredClone(previous))).toBe(previous);
    for (const changed of [
      { ...previous, visibility: false },
      { ...previous, properties: { color: '#ff0000' } },
      { ...previous, transitionFrames: { color: 12 } },
    ])
      expect(stableLayerRuleEffect(previous, changed)).toBe(changed);
    expect(stableLayerRuleEffect(previous, undefined)).toBe(EMPTY_LAYER_RULE_EFFECT);
  });

  it('still applies a different object’s data Rule when the target has no direct binding', () => {
    const source = createLayerOfKind('rectangle'),
      target = createLayerOfKind('text');
    const field = createFieldDefinition('number', { key: 'movement', defaultValue: 0 });
    source.visualRules = [
      createLayerVisualRule({
        fieldId: field.id,
        operator: 'greater-than',
        value: 0,
        actions: [
          { type: 'property', targetLayerId: target.id, targetProperty: 'color', value: '#ff0000' },
        ],
      }),
    ];
    const layers = [source, target],
      fields = [field];
    const values = { [field.id]: 1 };
    const effect = stableLayerRuleEffect(
      EMPTY_LAYER_RULE_EFFECT,
      editorVisualRuleEffects(layers, fields, values, {}).get(target.id),
    );
    const ownValues = stableLayerBindingValues({}, target.bindings, values);
    expect(ownValues).toEqual({});
    expect(resolveEffectiveElement(target, ownValues, [], fields, [], effect)).toMatchObject({
      color: '#ff0000',
    });
    const unchanged = editorVisualRuleEffects(
      layers,
      fields,
      { ...values, unrelated: 'fresh' },
      {},
    ).get(target.id);
    expect(stableLayerRuleEffect(effect, unchanged)).toBe(effect);
    const released = stableLayerRuleEffect(
      effect,
      editorVisualRuleEffects(layers, fields, { [field.id]: -1 }, {}).get(target.id),
    );
    expect(resolveEffectiveElement(target, {}, [], fields, [], released)).toEqual(target.element);
  });
});
