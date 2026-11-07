import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerVisualRule,
  createProject,
  defaultTransformForRole,
  type Layer,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import {
  layerHasRuntimeVisualInputs,
  pointerVisualRuleTriggers,
  resolveVisualRuleElement,
  RuntimeVisualRules,
  visualRuleEffectFor,
  visualRuleLayerVisible,
} from './runtimeVisualRules';
import { resolveBoundElement } from './renderElement';
import { expandRuntimeCollections } from './runtimeCollections';

/** Layer copies, as a GraphicElement makes them, so published effects stay per test. */
function instanceLayers(layers: readonly CompiledLayer[]): CompiledLayer[] {
  return layers.map((layer) => ({ ...layer }));
}

describe('compiled visual rules', () => {
  const fixture = () => {
    const field = createFieldDefinition('text', { key: 'result', defaultValue: '' });
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        id: 'gold',
        fieldId: field.id,
        operator: 'equals',
        value: 'GOLD',
        actions: [
          { type: 'visibility', visible: true },
          { type: 'property', targetProperty: 'fill', value: '#d4af37' },
        ],
      }),
      createLayerVisualRule({
        id: 'empty',
        fieldId: field.id,
        operator: 'empty',
        actions: [{ type: 'visibility', visible: false }],
      }),
      createLayerVisualRule({
        id: 'changed',
        fieldId: field.id,
        operator: 'changed',
        actions: [{ type: 'custom-action', actionId: 'flash' }],
      }),
    ];
    return compileDescriptor(createComposition({ layers: [layer], dataFields: [field] }))
      .layers[0]!;
  };

  it('sets properties and visibility from current data', () => {
    const layer = fixture();
    expect(layer.bindings).toEqual([]);
    expect(layerHasRuntimeVisualInputs(layer)).toBe(true);
    expect(resolveVisualRuleElement(layer, { result: 'GOLD' })).toMatchObject({ fill: '#d4af37' });
    expect(visualRuleLayerVisible(layer, { result: '' })).toBe(false);
    expect(visualRuleLayerVisible(layer, { result: 'GOLD' })).toBe(true);
  });

  it('does not schedule refreshes for a completely static layer', () => {
    const layer = { ...fixture(), visualRules: [] };
    expect(layerHasRuntimeVisualInputs(layer)).toBe(false);
  });

  it('fires change rules only for real data changes', () => {
    const layers = instanceLayers([fixture()]);
    const rules = new RuntimeVisualRules(layers, 25);
    const sideEffects = (previous: Record<string, unknown>, current: Record<string, unknown>) =>
      rules.dataChanged(previous, current).flatMap((fired) => rules.run(fired));
    expect(sideEffects({ result: 'SILVER' }, { result: 'GOLD' })).toEqual([
      { type: 'custom-action', actionId: 'flash' },
    ]);
    expect(sideEffects({}, { result: 'GOLD' })).toEqual([]);
    expect(sideEffects({ result: 'GOLD' }, { result: 'GOLD' })).toEqual([]);
  });

  it('latches increased and decreased results until the next change', () => {
    const [layer] = instanceLayers([fixture()]);
    layer!.visualRules = [
      {
        id: 'up',
        name: 'Score up',
        enabled: true,
        dataKey: 'result',
        sourcePath: [],
        operator: 'increased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#00ff00' }],
      },
      {
        id: 'down',
        name: 'Score down',
        enabled: true,
        dataKey: 'result',
        sourcePath: [],
        operator: 'decreased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#ff0000' }],
      },
    ];
    const rules = new RuntimeVisualRules([layer!], 25);
    const step = (previous: number, current: number) => {
      for (const fired of rules.dataChanged({ result: previous }, { result: current }))
        rules.run(fired);
      rules.update({ result: current }, 0);
      rules.publish(0);
      return resolveBoundElement(layer!, { result: current });
    };
    expect(step(1, 2)).toMatchObject({ fill: '#00ff00' });
    expect(step(2, 2)).toMatchObject({ fill: '#00ff00' });
    expect(step(2, 1)).toMatchObject({ fill: '#ff0000' });
  });

  it('compiles pointer rules without data fields and fires them per layer', () => {
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'pointer-enter',
        fieldId: '',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#ffffff' }],
      }),
      createLayerVisualRule({
        trigger: 'click',
        fieldId: '',
        actions: [{ type: 'custom-action', actionId: 'open' }],
      }),
      createLayerVisualRule({ trigger: 'play', fieldId: '' }),
    ];
    const compiled = compileDescriptor(createComposition({ layers: [layer], dataFields: [] }))
      .layers[0]!;

    expect(compiled.visualRules).toHaveLength(3);
    expect(layerHasRuntimeVisualInputs(compiled)).toBe(true);
    expect(resolveVisualRuleElement(compiled, {})).toEqual(compiled.element);
    expect([...pointerVisualRuleTriggers(compiled)].sort()).toEqual(['click', 'pointer-enter']);
    const rules = new RuntimeVisualRules(instanceLayers([compiled]), 25);
    expect(rules.dataChanged({}, {})).toEqual([]);
    const clicked = rules.eventFired('click', {}, { hostLayerId: compiled.id });
    expect(clicked.flatMap((fired) => rules.run(fired))).toEqual([
      { type: 'custom-action', actionId: 'open' },
    ]);
    expect(rules.eventFired('click', {}, { hostLayerId: 'other' })).toEqual([]);
  });
});

describe('runtime rule controller', () => {
  const scoreboard = () => {
    const home = createFieldDefinition('integer', { key: 'home', defaultValue: 0 });
    const away = createFieldDefinition('integer', { key: 'away', defaultValue: 0 });
    const status = createFieldDefinition('text', { key: 'status', defaultValue: '' });
    const button = createLayerOfKind('rectangle');
    const panel = createLayerOfKind('rectangle');
    const badge = createLayerOfKind('rectangle');
    panel.isVisible = false;
    button.visualRules = [
      createLayerVisualRule({
        id: 'home-leads',
        fieldId: home.id,
        operator: 'greater-than',
        compareFieldId: away.id,
        conditions: [{ fieldId: status.id, sourcePath: [], operator: 'one-of', value: 'LIVE, HT' }],
        actions: [
          {
            type: 'property',
            targetProperty: 'fill',
            value: '#ff0000',
            targetLayerId: badge.id,
            transitionFrames: 10,
          },
        ],
      }),
      createLayerVisualRule({
        id: 'open',
        trigger: 'click',
        delayFrames: 5,
        actions: [{ type: 'toggle-visibility', targetLayerId: panel.id, transitionFrames: 10 }],
      }),
      createLayerVisualRule({
        id: 'hover',
        trigger: 'hover',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#00ff00' }],
      }),
    ];
    const composition = createComposition({
      layers: [button, panel, badge],
      dataFields: [home, away, status],
    });
    composition.frameRate = 25;
    const layers = instanceLayers(compileDescriptor(composition).layers);
    const byId = (id: string) => layers.find((layer) => layer.id === id)!;
    return {
      layers,
      button: byId(button.id),
      panel: byId(panel.id),
      badge: byId(badge.id),
      badgeFill: (badge.element as { fill: unknown }).fill,
    };
  };

  it('drives another layer from a field-to-field comparison with a guard', () => {
    const { layers, badge } = scoreboard();
    const rules = new RuntimeVisualRules(layers, 25);
    const at = (data: Record<string, unknown>) => {
      rules.update(data, Number.NEGATIVE_INFINITY);
      rules.publish(Number.POSITIVE_INFINITY);
      return resolveBoundElement(badge, data);
    };
    expect(at({ home: 2, away: 1, status: 'live' })).not.toMatchObject({ fill: '#ff0000' });
    expect(at({ home: 2, away: 1, status: 'LIVE' })).toMatchObject({ fill: '#ff0000' });
    expect(at({ home: 1, away: 2, status: 'LIVE' })).not.toMatchObject({ fill: '#ff0000' });
    expect(rules.targeted.has(badge.id)).toBe(true);
    expect([...rules.dataKeysFor(badge.id)].sort()).toEqual(['away', 'home', 'status']);
  });

  it('animates a colour change over the transition frames', () => {
    const { layers, badge, badgeFill } = scoreboard();
    const rules = new RuntimeVisualRules(layers, 25);
    const leading = { home: 2, away: 1, status: 'LIVE' };
    rules.update({ home: 0, away: 0, status: 'LIVE' }, Number.NEGATIVE_INFINITY);
    rules.update(leading, 1000);
    expect(rules.publish(1200)).toBe(true);
    const halfway = visualRuleEffectFor(badge, leading)?.properties.fill;
    expect(halfway).not.toBe('#ff0000');
    expect(halfway).not.toBe(badgeFill);
    expect(rules.publish(1400)).toBe(false);
    expect(visualRuleEffectFor(badge, leading)?.properties.fill).toBe('#ff0000');
  });

  it('delays and fades a toggle aimed at another layer', () => {
    const { layers, button, panel } = scoreboard();
    const rules = new RuntimeVisualRules(layers, 25);
    rules.update({}, Number.NEGATIVE_INFINITY);
    const [fired] = rules.eventFired('click', {}, { hostLayerId: button.id });
    expect(rules.delayMs(fired!)).toBe(200);
    rules.run(fired!);
    rules.update({}, 0);
    rules.publish(200);
    expect(visualRuleEffectFor(panel, {})).toMatchObject({ visibility: true });
    expect(visualRuleEffectFor(panel, {})?.contentOpacity).toBeCloseTo(0.5, 1);
    rules.publish(400);
    expect(visualRuleEffectFor(panel, {})).toMatchObject({ visibility: true });
    expect(visualRuleEffectFor(panel, {})?.contentOpacity).toBeUndefined();

    rules.run(fired!);
    rules.update({}, 1000);
    rules.publish(2000);
    expect(visualRuleLayerVisible(panel, {})).toBe(false);
  });

  it('holds hover results only while hovered', () => {
    const { layers, button } = scoreboard();
    const rules = new RuntimeVisualRules(layers, 25);
    const refresh = () => {
      rules.update({}, 0);
      rules.publish(0);
      return resolveBoundElement(button, {});
    };
    expect(refresh()).not.toMatchObject({ fill: '#00ff00' });
    rules.hoverChanged(button.id, true, {});
    expect(refresh()).toMatchObject({ fill: '#00ff00' });
    rules.hoverChanged(button.id, false, {});
    expect(refresh()).not.toMatchObject({ fill: '#00ff00' });
  });

  it('matches step and custom-action triggers by event id', () => {
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({ id: 'any-step', trigger: 'step' }),
      createLayerVisualRule({ id: 'step-two', trigger: 'step', eventId: 'step-2' }),
      createLayerVisualRule({ id: 'flash', trigger: 'custom-action', eventId: 'flash' }),
    ];
    const compiled = compileDescriptor(createComposition({ layers: [layer], dataFields: [] }))
      .layers[0]!;
    const rules = new RuntimeVisualRules(instanceLayers([compiled]), 25);
    const ids = (fired: ReturnType<RuntimeVisualRules['eventFired']>) =>
      fired.map((entry) => entry.rule.id);
    expect(ids(rules.eventFired('step', {}, { eventId: 'step-1' }))).toEqual(['any-step']);
    expect(ids(rules.eventFired('step', {}, { eventId: 'step-2' }))).toEqual([
      'any-step',
      'step-two',
    ]);
    expect(ids(rules.eventFired('custom-action', {}, { eventId: 'flash' }))).toEqual(['flash']);
    expect(ids(rules.eventFired('custom-action', {}, { eventId: 'other' }))).toEqual([]);
  });

  it('reads each runtime collection row and drives that row’s sibling', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const rows = createFieldDefinition('array', {
      key: 'rows',
      constraints: { minItems: 0, maxItems: 2 },
      items: createFieldDefinition('object', {
        key: 'row',
        properties: [createFieldDefinition('number', { key: 'change' })],
        defaultValue: { change: 0 },
      }),
    });
    const plate: Layer = createLayerOfKind('rectangle');
    const arrow: Layer = createLayerOfKind('rectangle');
    plate.visualRules = [
      createLayerVisualRule({
        fieldId: rows.id,
        sourcePath: ['change'],
        operator: 'less-than',
        value: 0,
        actions: [
          { type: 'property', targetProperty: 'fill', value: '#ff0000', targetLayerId: arrow.id },
        ],
      }),
    ];
    for (const layer of [plate, arrow]) {
      layer.keyframes = composition.keyframes.map((keyframe, index) =>
        createLayerKeyframe(
          computeKeyframeFrames(composition)[index]!.frame,
          defaultTransformForRole(layer.element.type, keyframe.role),
        ),
      );
    }
    composition.layers = [plate, arrow];
    composition.dataFields = [rows];
    composition.runtimeCollections = [
      {
        id: 'collection',
        name: 'Rows',
        fieldId: rows.id,
        prototypeLayerIds: [plate.id, arrow.id],
        offsetPerItem: { x: 0, y: 50 },
        capacity: 2,
        overflow: 'truncate',
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];
    const layers = instanceLayers(expandRuntimeCollections(compileDescriptor(composition)).layers);
    const [, firstArrow, , secondArrow] = layers;
    const data = { rows: [{ change: 3 }, { change: -2 }] };
    const rules = new RuntimeVisualRules(layers, 25);
    rules.update(data, Number.NEGATIVE_INFINITY);
    rules.publish(Number.POSITIVE_INFINITY);
    expect(resolveBoundElement(firstArrow!, data)).not.toMatchObject({ fill: '#ff0000' });
    expect(resolveBoundElement(secondArrow!, data)).toMatchObject({ fill: '#ff0000' });
  });

  it('lets a state rule take back what an event set', () => {
    const status = createFieldDefinition('text', { key: 'status', defaultValue: '' });
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'click',
        actions: [{ type: 'visibility', visible: false }],
      }),
      createLayerVisualRule({
        fieldId: status.id,
        operator: 'equals',
        value: 'SHOW',
        actions: [{ type: 'visibility', visible: true }],
      }),
    ];
    const compiled = instanceLayers(
      compileDescriptor(createComposition({ layers: [layer], dataFields: [status] })).layers,
    );
    const target = compiled[0]!;
    const rules = new RuntimeVisualRules(compiled, 25);
    for (const fired of rules.eventFired('click', {}, { hostLayerId: target.id })) rules.run(fired);
    rules.update({ status: '' }, 0);
    rules.publish(0);
    expect(visualRuleLayerVisible(target, { status: '' })).toBe(false);
    rules.dataChanged({ status: '' }, { status: 'SHOW' });
    rules.update({ status: 'SHOW' }, 0);
    rules.publish(0);
    expect(visualRuleLayerVisible(target, { status: 'SHOW' })).toBe(true);
  });
});
