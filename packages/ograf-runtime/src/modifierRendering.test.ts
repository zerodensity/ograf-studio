import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerModifier,
  createLayerVisualRule,
  createLayerOfKind,
  createLayerLoopClip,
  modifierProperty,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledModifiers } from './modifierRendering';
import {
  applyCompiledLayerVisualState,
  interpolateCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from './loopRendering';
import { prepareModifierTextElement, applyModifierTextFit } from './modifierTextRendering';
import { resolveBoundElement } from './renderElement';
import { expandRuntimeCollections } from './runtimeCollections';
import { RuntimeVisualRules } from './runtimeVisualRules';

function lowerThird() {
  const name = createLayerOfKind('text');
  const plate = createLayerOfKind('rectangle');
  const logo = createLayerOfKind('ellipse');
  name.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 50, width: 500, height: 50 })),
  ];
  plate.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 90, y: 40, width: 700, height: 70 })),
  ];
  logo.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 40, height: 40 }))];
  name.modifiers = [createLayerModifier('max-text-width', { maxWidth: 300 }, { id: 'fit' })];
  plate.modifiers = [
    createLayerModifier('auto-size', {
      source: { kind: 'layer', layerId: name.id },
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 10,
      paddingBottom: 10,
    }),
  ];
  logo.modifiers = [
    createLayerModifier('auto-follow', {
      source: { kind: 'layer', layerId: plate.id },
      sourceAnchorX: 1,
      offsetX: 12,
    }),
  ];
  // Deliberately reverse dependency order relative to painting.
  const composition = createComposition({
    layers: [logo, plate, name],
    backgroundColor: 'transparent',
  });
  return { name, plate, logo, composition };
}
function render(descriptor: ReturnType<typeof compileDescriptor>, frame = 0, data = {}) {
  const states = new Map(
    descriptor.layers.map((layer) => [
      layer.id,
      sampleCompiledLayerVisualState(layer, frame, undefined, data),
    ]),
  );
  applyCompiledAutoLayout(descriptor, states, data);
  applyCompiledModifiers(descriptor, states, data);
  return states;
}

describe('compiled smart lower-third modifiers', () => {
  it('resolves text -> background -> logo independently of paint order', () => {
    const { composition, name, plate, logo } = lowerThird();
    const states = render(compileDescriptor(composition));
    expect(states.get(name.id)!.transform).toMatchObject({ width: 300, height: 50 });
    expect(states.get(name.id)!.textFit).toMatchObject({ scaleX: 0.6, scaleY: 1 });
    expect(states.get(plate.id)!.transform).toMatchObject({ width: 320, height: 70, x: 90, y: 40 });
    expect(states.get(logo.id)!.transform.x).toBe(422);
    expect(
      composition.layers.find((layer) => layer.id === plate.id)!.keyframes[0]!.transform.width,
    ).toBe(700);
  });

  it('samples numeric modifier keys, loop keys and data with data precedence', () => {
    const { composition, name } = lowerThird();
    const field = createFieldDefinition('number', { key: 'maximum', defaultValue: 250 });
    composition.dataFields = [field];
    const property = modifierProperty('fit', 'maxWidth');
    name.animationTracks[property] = [
      { id: 'a', frame: 0, value: 100, easing: 'linear' },
      { id: 'b', frame: 10, value: 300, easing: 'linear' },
    ];
    name.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: {
        [property]: [{ id: 'loop', frame: 0, value: 180, easing: 'linear' }],
      },
    });
    name.bindings = [{ fieldId: field.id, targetProperty: property }];
    const layer = compileDescriptor(composition).layers.find((entry) => entry.id === name.id)!;
    expect(sampleCompiledLayerVisualState(layer, 5).modifiers?.[0]?.params).toMatchObject({
      maxWidth: 200,
    });
    expect(sampleCompiledLayerVisualState(layer, 5, 2).modifiers?.[0]?.params).toMatchObject({
      maxWidth: 180,
    });
    expect(
      sampleCompiledLayerVisualState(layer, 5, 2, { maximum: 240 }).modifiers?.[0]?.params,
    ).toMatchObject({ maxWidth: 240 });
  });

  it('interpolates direct lifecycle targets without jumping through intermediate frame keys', () => {
    const { composition, name } = lowerThird();
    const property = modifierProperty('fit', 'maxWidth');
    name.animationTracks[property] = [
      { id: 'a', frame: 0, value: 100, easing: 'linear' },
      { id: 'intermediate', frame: 5, value: 900, easing: 'linear' },
      { id: 'b', frame: 10, value: 300, easing: 'linear' },
    ];
    const descriptor = compileDescriptor(composition),
      layer = descriptor.layers.find((entry) => entry.id === name.id)!;
    const direct = interpolateCompiledLayerVisualState(
      layer,
      sampleCompiledLayerVisualState(layer, 0),
      sampleCompiledLayerVisualState(layer, 10),
      0.5,
      10,
    );
    expect(direct.modifiers?.[0]?.params).toMatchObject({ maxWidth: 200 });
  });

  it('evaluates frame changes and backward seeks from source data without accumulated geometry', () => {
    const { composition, name, plate } = lowerThird();
    const property = modifierProperty('fit', 'maxWidth');
    name.animationTracks[property] = [
      { id: 'a', frame: 0, value: 200, easing: 'linear' },
      { id: 'b', frame: 10, value: 400, easing: 'linear' },
    ];
    const descriptor = compileDescriptor(composition);
    for (const frame of [10, 3, 0, 10, 0])
      expect(render(descriptor, frame).get(plate.id)!.transform.width).toBe(220 + frame * 20);
  });

  it('keeps hidden state separate from zero opacity and collapses only hidden flow members', () => {
    const panel = createLayerOfKind('rectangle'),
      first = createLayerOfKind('rectangle'),
      second = createLayerOfKind('rectangle');
    const field = createFieldDefinition('text', { key: 'subtitle', defaultValue: '' });
    panel.autoLayout = {
      ...panel.autoLayout,
      direction: 'horizontal',
      gap: 10,
      collapseHidden: true,
    };
    for (const layer of [panel, first, second])
      layer.keyframes = [
        createLayerKeyframe(0, createDefaultTransform({ width: 100, height: 30, opacity: 0 })),
      ];
    first.parentId = panel.id;
    second.parentId = panel.id;
    first.modifiers = [
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: field.id, sourcePath: [] },
      }),
    ];
    const descriptor = compileDescriptor(
      createComposition({ layers: [panel, first, second], dataFields: [field] }),
    );
    let states = render(descriptor);
    expect(states.get(first.id)!.isVisible).toBe(false);
    expect(states.get(second.id)!.transform.x).toBe(
      panel.keyframes[0]!.transform.x + panel.autoLayout.paddingLeft,
    );
    states = render(descriptor, 0, { subtitle: 'Visible even at opacity zero' });
    expect(states.get(first.id)!.isVisible).toBe(true);
    expect(states.get(second.id)!.transform.x).toBe(
      panel.keyframes[0]!.transform.x + panel.autoLayout.paddingLeft + 110,
    );
  });

  it('gates a complete referenced group using resolved bound content', () => {
    const { composition, name, plate, logo } = lowerThird();
    plate.groupId = 'strip';
    logo.groupId = 'strip';
    const field = createFieldDefinition('text', { key: 'presenter', defaultValue: 'Name' });
    composition.dataFields = [field];
    name.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    name.modifiers!.push(
      createLayerModifier('hide-empty', {
        source: { kind: 'layer', layerId: name.id, property: 'content' },
        target: { kind: 'group', groupId: 'strip' },
      }),
    );
    const descriptor = compileDescriptor(composition);
    expect(render(descriptor, 0, { presenter: '   ' }).get(plate.id)!.isVisible).toBe(false);
    expect(render(descriptor, 0, { presenter: 'Name' }).get(plate.id)!.isVisible).toBe(true);
    expect(render(descriptor, 0, { presenter: '' }).get(logo.id)!.isVisible).toBe(false);
  });

  it('does not replace authored text sizing, paint or runs and does not enlarge short text', () => {
    const { composition, name } = lowerThird();
    if (name.element.type !== 'text') throw new Error('fixture');
    name.element.autoFit = 'fixed';
    name.element.runs = [{ text: name.element.content, fontWeight: 700 }];
    const descriptor = compileDescriptor(composition),
      layer = descriptor.layers.find((entry) => entry.id === name.id)!;
    const prepared = resolveBoundElement(layer, {});
    expect(prepared).toMatchObject({
      autoFit: 'auto-size',
      runs: name.element.runs,
      color: name.element.color,
    });
    expect('fill' in prepared ? prepared.fill : undefined).toBe(name.element.fill);
    expect(name.element.autoFit).toBe('fixed');
    expect(prepareModifierTextElement(name.element, [])).toBe(name.element);
    layer.keyframes[0]!.transform.width = 100;
    layer.animationTracks.width = [];
    expect(render(descriptor).get(name.id)!.textFit).toMatchObject({ scaleX: 1, scaleY: 1 });
  });

  it('writes visibility and text scale before composing effects without touching authored opacity', () => {
    const content = { style: {}, dataset: { ografTextBaseline: '3' } };
    const host = { style: {}, querySelectorAll: () => [content] } as unknown as HTMLElement;
    applyModifierTextFit(host, { scaleX: 0.5, scaleY: 1, fontSize: 64 });
    expect(content.style).toMatchObject({
      transform: 'scale(0.5, 1) translateY(3px)',
      whiteSpace: 'pre',
    });
    const layer = compileDescriptor(lowerThird().composition).layers[0]!;
    const state = sampleCompiledLayerVisualState(layer, 0);
    state.isVisible = false;
    applyCompiledLayerVisualState(host, state);
    expect(host.style.display).toBe('none');
    expect(host.style.opacity).toBe('1');
  });

  it('compiles only referenced group and field identities and clones modifier settings', () => {
    const { composition, name, plate, logo } = lowerThird();
    const field = createFieldDefinition('text', {
      key: 'caption',
      defaultValue: 'Default caption',
    });
    const other = createFieldDefinition('text', {
      key: 'unused',
      defaultValue: 'Unneeded metadata',
    });
    composition.dataFields = [field, other];
    plate.groupId = 'strip';
    logo.groupId = 'strip';
    name.groupId = 'other-group';
    name.modifiers!.push(
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: field.id, sourcePath: [] },
        target: { kind: 'group', groupId: 'strip' },
      }),
    );
    const descriptor = compileDescriptor(composition);
    expect(descriptor.layers.find((entry) => entry.id === plate.id)!.groupId).toBe('strip');
    expect(descriptor.layers.find((entry) => entry.id === name.id)!.groupId).toBeUndefined();
    expect(descriptor.modifierDataKeys).toEqual({ [field.id]: 'caption' });
    expect(descriptor.modifierDataDefaults).toEqual({ [field.id]: 'Default caption' });
    descriptor.layers.find((entry) => entry.id === name.id)!.modifiers![0]!.enabled = false;
    expect(name.modifiers![0]!.enabled).toBe(true);
  });

  it('preserves published cross-layer visual rule identities while evaluating modifiers', () => {
    const { composition, name, plate, logo } = lowerThird();
    const field = createFieldDefinition('text', { key: 'mode', defaultValue: 'hide' });
    composition.dataFields = [field];
    logo.visualRules = [
      createLayerVisualRule({
        fieldId: field.id,
        operator: 'equals',
        value: 'hide',
        actions: [
          { type: 'visibility', visible: false, targetLayerId: plate.id },
          { type: 'property', targetProperty: 'content', value: '', targetLayerId: name.id },
        ],
      }),
    ];
    logo.modifiers!.push(
      createLayerModifier('hide-empty', {
        source: { kind: 'layer', layerId: name.id, property: 'content' },
      }),
    );
    const descriptor = compileDescriptor(composition);
    const rules = new RuntimeVisualRules(descriptor.layers, descriptor.frameRate);
    rules.update({ mode: 'hide' }, 0);
    rules.publish(Number.POSITIVE_INFINITY);
    const states = render(descriptor, 0, { mode: 'hide' });
    expect(states.get(plate.id)!.isVisible).toBe(false);
    expect(states.get(logo.id)!.isVisible).toBe(false);
  });

  it('remaps group/layer references per collection row and reads its own field item', () => {
    const { composition, name, plate, logo } = lowerThird();
    for (const layer of composition.layers) layer.groupId = 'row';
    const field = createFieldDefinition('array', {
      key: 'people',
      defaultValue: [],
      items: createFieldDefinition('object', {
        key: 'person',
        properties: [createFieldDefinition('text', { key: 'name' })],
      }),
    });
    composition.dataFields = [field];
    name.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    name.modifiers!.push(
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: field.id, sourcePath: ['name'] },
        target: { kind: 'group', groupId: 'row' },
      }),
    );
    composition.runtimeCollections = [
      {
        id: 'people-list',
        name: 'People',
        fieldId: field.id,
        prototypeLayerIds: composition.layers.map((layer) => layer.id),
        offsetPerItem: { x: 0, y: 100 },
        capacity: 2,
        overflow: 'truncate',
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];
    const descriptor = expandRuntimeCollections(compileDescriptor(composition));
    const data = { people: [{ name: '' }, { name: 'Second person' }] };
    const states = render(descriptor, 0, data);
    const firstPlate = `people-list::0::${plate.id}`,
      secondPlate = `people-list::1::${plate.id}`;
    expect(states.get(firstPlate)!.isVisible).toBe(false);
    expect(states.get(secondPlate)!.isVisible).toBe(true);
    const secondLogo = descriptor.layers.find(
      (entry) => entry.id === `people-list::1::${logo.id}`,
    )!;
    expect(secondLogo.modifiers![0]!.params).toMatchObject({
      source: { kind: 'layer', layerId: secondPlate },
    });
    expect(descriptor.layers.find((entry) => entry.id === secondPlate)!.groupId).toBe(
      'people-list::1::group::row',
    );
  });
});
