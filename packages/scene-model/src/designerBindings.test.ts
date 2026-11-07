import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyElementDataValue } from './boundPaint';
import {
  syncDesignerBindingDefaults,
  syncDesignerTransformBindingDefaults,
} from './designerBindings';
import { addEffect, effectProperty, updateEffect } from './effectStack';
import {
  createChartLayer,
  createComposition,
  createFieldDefinition,
  createImageLayer,
  createLayerOfKind,
  createRectangleLayer,
  createTextLayer,
} from './factory';
import { createDefaultGradient } from './paint';
import { getElementShaderPaint } from './shader';
import { syncShaderParameterFields } from './shaderFields';
import type { Element, FieldDefinition, Layer, LayerEffects } from './types';

function fixture(layer: Layer, field: FieldDefinition, targetProperty: string) {
  layer.bindings = [{ fieldId: field.id, targetProperty }];
  const composition = createComposition({ layers: [layer], dataFields: [field] });
  return { composition, layer, field };
}

function snapshot(layer: Layer): { element: Element; effects: LayerEffects } {
  return structuredClone({ element: layer.element, effects: layer.effects });
}

function setText(layer: Layer, content: string) {
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  layer.element.content = content;
}

describe('designer edits to data-bound properties', () => {
  it('edits bound absolute geometry defaults and the active mapping while leaving alpha authored', () => {
    const field = createFieldDefinition('object', {
      properties: [
        createFieldDefinition('number', { key: 'x', defaultValue: 10 }),
        createFieldDefinition('text', { key: 'label', defaultValue: 'Keep' }),
      ],
      defaultValue: { x: 10, label: 'Keep' },
    });
    const { composition, layer } = fixture(createRectangleLayer(), field, 'layer.x');
    layer.bindings[0]!.sourcePath = ['x'];
    const result = syncDesignerTransformBindingDefaults(composition, layer, {
      x: 40,
      opacity: 0.5,
    });
    expect(result.patch).toEqual({ opacity: 0.5 });
    expect(result.resets).toEqual([{ fieldId: field.id, sourcePath: ['x'] }]);
    expect(field.defaultValue).toEqual({ x: 40, label: 'Keep' });
    expect(field.properties[0]!.defaultValue).toBe(40);
    layer.bindings[0]!.valueMap = { '40': 100, '80': 200 };
    syncDesignerTransformBindingDefaults(
      composition,
      layer,
      { x: 300 },
      { [field.id]: { x: 80, label: 'Preview' } },
    );
    expect(layer.bindings[0]!.valueMap).toEqual({ '40': 100, '80': 300 });
    expect(field.defaultValue).toEqual({ x: 40, label: 'Keep' });
  });
  it('updates only the first collection prototype item when editing bound geometry', () => {
    const field = createFieldDefinition('array', {
      items: createFieldDefinition('object', {
        properties: [
          createFieldDefinition('number', { key: 'width', defaultValue: 20 }),
          createFieldDefinition('text', { key: 'name' }),
        ],
      }),
      defaultValue: [
        { width: 20, name: 'First' },
        { width: 30, name: 'Second' },
      ],
    });
    const { composition, layer } = fixture(createRectangleLayer(), field, 'layer.width');
    layer.bindings[0]!.sourcePath = ['width'];
    const result = syncDesignerTransformBindingDefaults(composition, layer, { width: 50 });
    expect(result.patch).toEqual({});
    expect(field.defaultValue).toEqual([
      { width: 50, name: 'First' },
      { width: 30, name: 'Second' },
    ]);
    expect(result.resets).toEqual([{ fieldId: field.id, sourcePath: ['0', 'width'] }]);
  });
  it('updates a text field default and retains its binding so shared layers receive the edit', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('text', { defaultValue: 'Old headline' }),
      'content',
    );
    const shared = createTextLayer();
    shared.bindings = structuredClone(layer.bindings);
    composition.layers.push(shared);
    const before = snapshot(layer);
    setText(layer, 'New headline');
    expect(syncDesignerBindingDefaults(composition, layer, before, ['content'])).toEqual([
      { fieldId: field.id, sourcePath: [] },
    ]);
    expect(field.defaultValue).toBe('New headline');
    expect(layer.bindings).toEqual([{ fieldId: field.id, targetProperty: 'content' }]);
    expect(applyElementDataValue(shared.element, 'content', field.defaultValue)).toMatchObject({
      content: 'New headline',
    });
  });

  it('honors explicit edits equal to authored values when the data default differs', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('text', { defaultValue: 'Different data text' }),
      'content',
    );
    const before = snapshot(layer);
    syncDesignerBindingDefaults(composition, layer, before, ['content']);
    expect(field.defaultValue).toBe(layer.element.type === 'text' && layer.element.content);
  });

  it('preserves numeric field types when editing typography', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('number', { defaultValue: 48 }),
      'fontSize',
    );
    const before = snapshot(layer);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fontSize = 96;
    syncDesignerBindingDefaults(composition, layer, before, ['fontSize']);
    expect(field).toMatchObject({ type: 'number', defaultValue: 96 });
  });

  it('synchronizes solid text paint with a color binding', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('color', { defaultValue: '#ffffff' }),
      'color',
    );
    const before = snapshot(layer);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.color = '#32aaff';
    syncDesignerBindingDefaults(composition, layer, before, ['fill']);
    expect(field.defaultValue).toBe('#32aaff');
  });

  it('changes a nested object leaf and its schema default without changing sibling defaults', () => {
    const name = createFieldDefinition('text', { key: 'name', defaultValue: 'Old' });
    const score = createFieldDefinition('integer', { key: 'score', defaultValue: 3 });
    const field = createFieldDefinition('object', {
      defaultValue: { team: { name: 'Old', score: 3 }, status: 'Live' },
      properties: [
        createFieldDefinition('object', {
          key: 'team',
          defaultValue: { name: 'Old', score: 3 },
          properties: [name, score],
        }),
        createFieldDefinition('text', { key: 'status', defaultValue: 'Live' }),
      ],
    });
    const { composition, layer } = fixture(createTextLayer(), field, 'content');
    layer.bindings[0]!.sourcePath = ['team', 'name'];
    const before = snapshot(layer);
    setText(layer, 'Home');
    expect(syncDesignerBindingDefaults(composition, layer, before, ['content'])).toEqual([
      { fieldId: field.id, sourcePath: ['team', 'name'] },
    ]);
    expect(field.defaultValue).toEqual({ team: { name: 'Home', score: 3 }, status: 'Live' });
    expect(field.properties[0]!.defaultValue).toEqual({ name: 'Home', score: 3 });
    expect(name.defaultValue).toBe('Home');
    expect(score.defaultValue).toBe(3);
  });

  it('edits only the first array prototype item and emits its absolute preview path', () => {
    const field = createFieldDefinition('array', {
      defaultValue: [
        { name: 'One', score: 1 },
        { name: 'Two', score: 2 },
      ],
      items: createFieldDefinition('object', {
        defaultValue: { name: 'One', score: 1 },
        properties: [
          createFieldDefinition('text', { key: 'name', defaultValue: 'One' }),
          createFieldDefinition('integer', { key: 'score', defaultValue: 1 }),
        ],
      }),
    });
    const { composition, layer } = fixture(createTextLayer(), field, 'content');
    layer.bindings[0]!.sourcePath = ['name'];
    const before = snapshot(layer);
    setText(layer, 'Changed');
    expect(syncDesignerBindingDefaults(composition, layer, before, ['content'])).toEqual([
      { fieldId: field.id, sourcePath: ['0', 'name'] },
    ]);
    expect(field.defaultValue).toEqual([
      { name: 'Changed', score: 1 },
      { name: 'Two', score: 2 },
    ]);
    expect(field.items!.properties[0]!.defaultValue).toBe('Changed');
  });

  it('materializes an empty array prototype from its schema defaults', () => {
    const field = createFieldDefinition('array', {
      defaultValue: [],
      items: createFieldDefinition('object', {
        defaultValue: { name: 'Sample', score: 4 },
        properties: [
          createFieldDefinition('text', { key: 'name', required: true, defaultValue: 'Sample' }),
          createFieldDefinition('integer', { key: 'score', required: true, defaultValue: 4 }),
        ],
      }),
    });
    const { composition, layer } = fixture(createTextLayer(), field, 'content');
    layer.bindings[0]!.sourcePath = ['name'];
    const before = snapshot(layer);
    setText(layer, 'First');
    syncDesignerBindingDefaults(composition, layer, before, ['content']);
    expect(field.defaultValue).toEqual([{ name: 'First', score: 4 }]);
  });

  it('changes the active preview option mapping without modifying the selector default', () => {
    const field = createFieldDefinition('select', {
      defaultValue: 'home',
      options: [
        { value: 'home', label: 'Home' },
        { value: 'away', label: 'Away' },
      ],
    });
    const { composition, layer } = fixture(createTextLayer(), field, 'color');
    layer.bindings[0]!.valueMap = { home: '#ff0000', away: '#0000ff' };
    const before = snapshot(layer);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.color = '#00ff00';
    expect(
      syncDesignerBindingDefaults(composition, layer, before, ['color'], {
        [field.id]: 'away',
      }),
    ).toEqual([]);
    expect(field.defaultValue).toBe('home');
    expect(layer.bindings[0]!.valueMap).toEqual({ home: '#ff0000', away: '#00ff00' });
  });

  it('maps incompatible text edits instead of replacing a numeric field schema/default', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('integer', { defaultValue: 2 }),
      'content',
    );
    const before = snapshot(layer);
    setText(layer, 'Goals');
    syncDesignerBindingDefaults(composition, layer, before, ['content']);
    expect(field).toMatchObject({ type: 'integer', defaultValue: 2 });
    expect(layer.bindings[0]!.valueMap).toEqual({ 2: 'Goals' });
  });

  it('keeps constrained defaults valid while allowing an unrestricted designer property edit', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('number', { defaultValue: 48, constraints: { maximum: 72 } }),
      'fontSize',
    );
    const before = snapshot(layer);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fontSize = 96;
    syncDesignerBindingDefaults(composition, layer, before, ['fontSize'], { [field.id]: 64 });
    expect(field).toMatchObject({ defaultValue: 48, constraints: { maximum: 72 } });
    expect(layer.bindings[0]!.valueMap).toEqual({ 64: 96 });
  });

  it('preserves formatting when numeric-looking text is not losslessly representable as data', () => {
    const { composition, layer, field } = fixture(
      createTextLayer(),
      createFieldDefinition('integer', { defaultValue: 2 }),
      'content',
    );
    const before = snapshot(layer);
    setText(layer, '002');
    syncDesignerBindingDefaults(composition, layer, before, ['content']);
    expect(field.defaultValue).toBe(2);
    expect(layer.bindings[0]!.valueMap).toEqual({ 2: '002' });
  });

  it('updates only the changed stop when a whole gradient editor writes its paint', () => {
    const layer = createRectangleLayer();
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    const gradient = createDefaultGradient();
    layer.element.fill = gradient;
    const first = createFieldDefinition('color', { defaultValue: '#ffffff' });
    const second = createFieldDefinition('color', { defaultValue: '#00133f' });
    layer.bindings = [
      { fieldId: first.id, targetProperty: 'fill.stops[0].color' },
      { fieldId: second.id, targetProperty: 'fill.stops[1].color' },
    ];
    const composition = createComposition({ layers: [layer], dataFields: [first, second] });
    const before = snapshot(layer);
    gradient.stops[0]!.color = '#00ff00';
    expect(syncDesignerBindingDefaults(composition, layer, before, ['fill'])).toEqual([
      { fieldId: first.id, sourcePath: [] },
    ]);
    expect(first.defaultValue).toBe('#00ff00');
    expect(second.defaultValue).toBe('#00133f');
  });

  it('serializes chart data for the exposed JSON text field', () => {
    const { composition, layer, field } = fixture(
      createChartLayer(),
      createFieldDefinition('textarea', { defaultValue: '{}' }),
      'data',
    );
    const before = snapshot(layer);
    if (layer.element.type !== 'chart') throw new Error('Expected chart.');
    layer.element.data.datasets[0]!.data[0] = 99;
    syncDesignerBindingDefaults(composition, layer, before, ['data']);
    expect(JSON.parse(String(field.defaultValue))).toEqual(layer.element.data);
  });

  it('clears an exposed image source without losing its image URL binding', () => {
    const { composition, layer, field } = fixture(
      createImageLayer(),
      createFieldDefinition('image-url', { defaultValue: 'https://example.com/photo.png' }),
      'src',
    );
    const before = snapshot(layer);
    if (layer.element.type !== 'image') throw new Error('Expected image.');
    layer.element.src = null;
    expect(syncDesignerBindingDefaults(composition, layer, before, ['src'])).toEqual([
      { fieldId: field.id, sourcePath: [] },
    ]);
    expect(field.defaultValue).toBe('');
    expect(layer.bindings[0]).toEqual({ fieldId: field.id, targetProperty: 'src' });
  });

  it('synchronizes stack effect parameters and legacy shadow colors', () => {
    const layer = createRectangleLayer();
    const glow = addEffect(layer, 'glow');
    const radius = createFieldDefinition('number', { defaultValue: 5 });
    const shadow = createFieldDefinition('color', { defaultValue: '#000000' });
    const target = effectProperty(glow, 'radius');
    layer.bindings = [
      { fieldId: radius.id, targetProperty: target },
      { fieldId: shadow.id, targetProperty: 'dropShadowColor' },
    ];
    const composition = createComposition({ layers: [layer], dataFields: [radius, shadow] });
    const before = snapshot(layer);
    updateEffect(layer, glow.id, { params: { radius: 20 } });
    layer.effects.dropShadowColor = '#ff00ff';
    syncDesignerBindingDefaults(composition, layer, before, [target, 'dropShadowColor']);
    expect(radius.defaultValue).toBe(20);
    expect(shadow.defaultValue).toBe('#ff00ff');
  });

  it('normalizes shader color and vector defaults and releases explicit generated-field previews', () => {
    const layer = createLayerOfKind('shader');
    const paint = getElementShaderPaint(layer.element)!;
    paint.fragmentSource = `#pragma ograf tint color
const vec3 tint = vec3(0.0, 0.0, 0.0);
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0, 0.0);
void mainImage(out vec4 color, in vec2 coord) { color = vec4(tint, 1.0); }`;
    const composition = createComposition({ layers: [layer] });
    syncShaderParameterFields(composition, layer);
    const before = snapshot(layer);
    paint.parameters.tint = [0.1, 0.2, 0.3];
    paint.parameters.offset = [0.3, -0.5];
    syncShaderParameterFields(composition, layer);
    const resets = syncDesignerBindingDefaults(composition, layer, before, [
      'fill.parameters.tint',
      'fill.parameters.offset',
    ]);
    expect(composition.dataFields[0]!.defaultValue).toBe('#1a334d');
    expect(composition.dataFields[1]!.defaultValue).toEqual({ x: 0.3, y: -0.5 });
    expect(resets).toHaveLength(2);
  });

  it('copies defaults safely when called with Immer drafts', () => {
    const { composition, layer, field } = fixture(
      createRectangleLayer(),
      createFieldDefinition('gradient', {
        defaultValue: createDefaultGradient(),
      }),
      'fill',
    );
    const before = snapshot(layer);
    const updated = produce(composition, (draft) => {
      const draftLayer = draft.layers[0]!;
      if (draftLayer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
      draftLayer.element.fill = createDefaultGradient('radial');
      syncDesignerBindingDefaults(draft, draftLayer, before, ['fill']);
    });
    expect(updated.dataFields[0]!.defaultValue).toMatchObject({ type: 'radial' });
    expect(field.defaultValue).toMatchObject({ type: 'linear' });
  });
});
