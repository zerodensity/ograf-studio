import { getElementShaderPaint } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { createProject, createLayerOfKind, createShaderPaint } from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { compileDataSchema } from './compileDataSchema';
import { assembleManifest } from './assembleManifest';
import { validateManifest } from '@ograf-editor/validation';

describe('shader parameter export', () => {
  it('exports independent fill and outline schemas on editable text without renaming fill fields', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text.');
    text.element.content = 'Editable';
    text.element.fill = createShaderPaint({ parameters: { waveFrequency: 2 } });
    composition.layers = [text];
    const fillSchema = compileDataSchema(composition);
    text.element.strokePaint = createShaderPaint({ parameters: { waveFrequency: 9 } });
    text.element.strokeWidth = 5;
    const descriptor = compileDescriptor(composition);
    const schema = compileDataSchema(composition);
    const bindings = descriptor.layers[0]!.bindings!;
    expect(bindings).toHaveLength(6);
    for (const [key, property] of Object.entries(fillSchema.properties))
      expect(schema.properties[key]).toEqual(property);
    const strokeBinding = bindings.find(
      (binding) => binding.targetProperty === 'strokePaint.parameters.waveFrequency',
    )!;
    expect(schema.properties[strokeBinding.dataKey]).toMatchObject({
      type: 'number',
      default: 9,
      v_ografShaderParameter: { paintSlot: 'stroke', name: 'waveFrequency', layerId: text.id },
    });
    expect(descriptor.layers[0]!.element).toMatchObject({
      type: 'text',
      content: 'Editable',
      fill: { parameters: { waveFrequency: 2 } },
      strokePaint: { parameters: { waveFrequency: 9 } },
    });
    expect(validateManifest(assembleManifest(project, composition, descriptor)).errors).toEqual([]);
  });
  it('exports typed OGraf fields and matching bindings from pragmas without mutating source', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('shader');
    const shader = getElementShaderPaint(layer.element)!;
    shader.fragmentSource = `#pragma ograf tint color
const vec4 tint = vec4(0.1, 0.2, 0.3, 0.5);
#pragma ograf count slider min(1) max(9) step(1)
const int count = 3;
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0);
#pragma ograf enabled toggle
const bool enabled = true;
void mainImage(out vec4 c, in vec2 p) { c = enabled ? tint * float(count) + vec4(offset, 0.0, 0.0) : vec4(0.0); }`;
    shader.parameters = { count: 5 };
    composition.layers = [layer];
    const before = structuredClone(composition);
    const descriptor = compileDescriptor(composition);
    const schema = compileDataSchema(composition);
    const bindings = descriptor.layers[0]!.bindings!;
    expect(bindings).toHaveLength(4);
    for (const binding of bindings) expect(schema.properties[binding.dataKey]).toBeDefined();
    const properties = Object.values(schema.properties);
    expect(properties[0]).toMatchObject({
      type: 'string',
      gddType: 'color-rrggbbaa',
      default: '#1a334d80',
      pattern: '^#[0-9a-f]{8}$',
      v_ografShaderParameter: { layerId: layer.id, name: 'tint' },
    });
    expect(properties[1]).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 9,
      multipleOf: 1,
      default: 5,
    });
    expect(properties[2]).toMatchObject({
      type: 'object',
      default: { x: 0, y: 0 },
      properties: { x: { type: 'number', minimum: -1, maximum: 1 }, y: { type: 'number' } },
      required: ['x', 'y'],
    });
    expect(properties[3]).toMatchObject({ type: 'boolean', default: true });
    expect(getElementShaderPaint(descriptor.layers[0]!.element)).toMatchObject({
      fragmentSource: shader.fragmentSource,
      parameters: { count: 5, tint: [0.1, 0.2, 0.3, 0.5], offset: [0, 0], enabled: true },
    });
    expect(composition).toEqual(before);
    expect(validateManifest(assembleManifest(project, composition, descriptor)).errors).toEqual([]);
  });
});
