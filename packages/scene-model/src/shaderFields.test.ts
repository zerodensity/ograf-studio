import { getElementShaderPaint } from './shader';
import { describe, expect, it } from 'vitest';
import { createComposition, createFieldDefinition, createLayerOfKind } from './factory';
import { syncCompositionShaderParameterFields, syncShaderParameterFields } from './shaderFields';
import { normalizeDataConnection } from './dataConnections';

const source = `#pragma ograf amount slider min(0) max(2) step(0.1)
const float amount = 0.5;
#pragma ograf tint color
const vec3 tint = vec3(0.1, 0.2, 0.3);
#pragma ograf enabled toggle
const bool enabled = true;
#pragma ograf offset vector2 min(-1) max(1) step(0.1)
const vec2 offset = vec2(0.0, 0.5);
void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(tint * amount + vec3(offset, 0.0), enabled ? 1.0 : 0.0);
}`;

function fixture() {
  const composition = createComposition();
  const layer = createLayerOfKind('shader');
  const shader = getElementShaderPaint(layer.element)!;
  shader.fragmentSource = source;
  composition.layers = [layer];
  syncShaderParameterFields(composition, layer);
  return { composition, layer };
}

describe('source-defined shader fields', () => {
  it('retires only connection mappings whose generated shader controls were actually removed', () => {
    const { composition, layer } = fixture();
    const amount = composition.dataFields[0]!;
    const tint = composition.dataFields[1]!;
    const ordinary = createFieldDefinition('text', { key: 'headline' });
    composition.dataFields.push(ordinary);
    composition.dataConnections = [
      normalizeDataConnection({
        mappings: [
          { fieldId: amount.id, sourcePath: 'amount' },
          { fieldId: tint.id, sourcePath: 'tint' },
          { fieldId: ordinary.id, sourcePath: 'headline' },
          { fieldId: 'unrelated-invalid-import', sourcePath: 'invalid' },
        ],
      }),
    ];
    getElementShaderPaint(layer.element)!.fragmentSource = source.replace(
      '#pragma ograf amount slider min(0) max(2) step(0.1)',
      '',
    );
    syncShaderParameterFields(composition, layer);
    expect(composition.dataConnections[0]!.mappings.map((m) => m.fieldId)).toEqual([
      tint.id,
      ordinary.id,
      'unrelated-invalid-import',
    ]);
    composition.layers = [];
    syncCompositionShaderParameterFields(composition);
    expect(composition.dataConnections[0]!.mappings.map((m) => m.fieldId)).toEqual([
      ordinary.id,
      'unrelated-invalid-import',
    ]);
  });

  it('creates stable typed fields and preserves exact color defaults', () => {
    const { composition, layer } = fixture();
    expect(composition.dataFields.map((field) => field.type)).toEqual([
      'number',
      'color',
      'boolean',
      'object',
    ]);
    expect(getElementShaderPaint(layer.element)).toMatchObject({
      parameters: {
        amount: 0.5,
        tint: [0.1, 0.2, 0.3],
        enabled: true,
        offset: [0, 0.5],
      },
    });
    expect(composition.dataFields[1]!.defaultValue).toBe('#1a334d');
    expect(composition.dataFields[3]).toMatchObject({
      defaultValue: { x: 0, y: 0.5 },
      properties: [
        { key: 'x', type: 'number', constraints: { minimum: -1, maximum: 1, step: 0.1 } },
        { key: 'y', type: 'number' },
      ],
    });
    expect(layer.bindings.map((binding) => binding.targetProperty)).toEqual([
      'fill.parameters.amount',
      'fill.parameters.tint',
      'fill.parameters.enabled',
      'fill.parameters.offset',
    ]);
    const before = structuredClone(composition);
    syncCompositionShaderParameterFields(composition);
    expect(composition).toEqual(before);
  });

  it('keeps source controls and ordinary Data defaults synchronized without renaming fields', () => {
    const { composition, layer } = fixture();
    const shader = getElementShaderPaint(layer.element)!;
    const amount = composition.dataFields[0]!;
    amount.key = 'background_amount';
    amount.label = 'Intensity';
    amount.defaultValue = 0.8;
    syncShaderParameterFields(composition, layer);
    expect(shader.parameters.amount).toBe(0.8);
    shader.parameters.amount = 1.2;
    syncShaderParameterFields(composition, layer);
    expect(amount).toMatchObject({
      key: 'background_amount',
      label: 'Intensity',
      defaultValue: 1.2,
    });
    amount.defaultValue = 'wrong type';
    expect(() => syncShaderParameterFields(composition, layer)).toThrow(/finite.*number/);
  });

  it('reconciles source changes and only removes generated fields that are unused', () => {
    const { composition, layer } = fixture();
    const shader = getElementShaderPaint(layer.element)!;
    const user = createFieldDefinition('text', { key: 'headline', defaultValue: 'News' });
    composition.dataFields.push(user);
    const other = createLayerOfKind('text');
    const removed = composition.dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'tint',
    )!;
    other.bindings = [{ fieldId: removed.id, targetProperty: 'content' }];
    composition.layers.push(other);
    shader.fragmentSource = `#pragma ograf amount toggle
const bool amount = false;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(amount ? 1.0 : 0.0); }`;
    syncShaderParameterFields(composition, layer);
    expect(shader.parameters).toEqual({ amount: false });
    expect(layer.bindings).toHaveLength(1);
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      expect.any(String),
      removed.key,
      'headline',
    ]);
    expect(composition.dataFields[0]).toMatchObject({ type: 'boolean', defaultValue: false });
    expect(composition.dataFields).toContain(user);
  });

  it('assigns independent fields to copies and removes orphan generated fields after deletion', () => {
    const { composition, layer } = fixture();
    const duplicate = structuredClone(layer);
    duplicate.id = 'copied-shader';
    composition.layers.push(duplicate);
    syncCompositionShaderParameterFields(composition);
    expect(composition.dataFields).toHaveLength(8);
    expect(duplicate.bindings.map((binding) => binding.fieldId)).not.toEqual(
      layer.bindings.map((binding) => binding.fieldId),
    );
    composition.layers = [duplicate];
    syncCompositionShaderParameterFields(composition);
    expect(composition.dataFields).toHaveLength(4);
    expect(
      composition.dataFields.every(
        (field) => field.generatedShaderParameter?.layerId === duplicate.id,
      ),
    ).toBe(true);
  });

  it('accepts reordered vector object defaults while preserving internal axes', () => {
    const { composition, layer } = fixture();
    const offset = composition.dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'offset',
    )!;
    offset.defaultValue = { y: 0.5, x: 0 };
    offset.properties.find((field) => field.key === 'x')!.exposeToOgraf = false;
    expect(() => syncCompositionShaderParameterFields(composition)).not.toThrow();
    expect(offset.defaultValue).toEqual({ x: 0, y: 0.5 });
    expect(offset.properties.find((field) => field.key === 'x')?.exposeToOgraf).toBe(false);
    expect(getElementShaderPaint(layer.element)!.parameters.offset).toEqual([0, 0.5]);
    offset.defaultValue = { y: 0.5, x: 0, z: 1 };
    expect(() => syncCompositionShaderParameterFields(composition)).toThrow(
      /outside its declared range/,
    );
  });
});
