import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
} from '@ograf-editor/scene-model';
import { compileCustomActions, compileDataSchema } from './compileDataSchema';

describe('compileDataSchema', () => {
  it('is an empty object schema when there are no fields', () => {
    expect(compileDataSchema(createComposition())).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('maps each field type to its JSON Schema type', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('text', { key: 'a' }),
        createFieldDefinition('textarea', { key: 'b' }),
        createFieldDefinition('number', { key: 'c' }),
        createFieldDefinition('boolean', { key: 'd' }),
        createFieldDefinition('color', { key: 'e' }),
        createFieldDefinition('gradient', { key: 'f' }),
        createFieldDefinition('image-url', { key: 'g' }),
      ],
    });
    const { properties } = compileDataSchema(composition);
    expect(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v.type]))).toEqual({
      a: 'string',
      b: 'string',
      c: 'number',
      d: 'boolean',
      e: 'string',
      f: 'object',
      g: 'string',
    });
    expect(properties.f!.properties?.stops?.minItems).toBe(2);
  });

  it('tags image-url fields with format: uri and leaves others unformatted', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('image-url', { key: 'logo' }),
        createFieldDefinition('text', { key: 'title' }),
      ],
    });
    const { properties } = compileDataSchema(composition);
    expect(properties.logo!.format).toBe('uri');
    expect(properties.title!.format).toBeUndefined();
  });

  it('keys properties by field key (not id) and carries label + default', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('text', { key: 'headline', label: 'Headline', defaultValue: 'Hi' }),
      ],
    });
    const { properties } = compileDataSchema(composition);
    expect(properties.headline).toEqual({ type: 'string', title: 'Headline', default: 'Hi' });
  });

  it('lists only required fields in required[]', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('text', { key: 'must', required: true }),
        createFieldDefinition('text', { key: 'optional', required: false }),
      ],
    });
    expect(compileDataSchema(composition).required).toEqual(['must']);
  });
});

describe('compileCustomActions', () => {
  it('exposes the public actionId as id', () => {
    const composition = createComposition({
      customActions: [createCustomActionDefinition({ actionId: 'pulse', name: 'Pulse' })],
    });
    expect(compileCustomActions(composition)).toEqual([{ id: 'pulse', name: 'Pulse' }]);
  });

  it('omits an empty description rather than emitting an empty string', () => {
    const composition = createComposition({
      customActions: [
        createCustomActionDefinition({ actionId: 'a', name: 'A', description: '' }),
        createCustomActionDefinition({ actionId: 'b', name: 'B', description: 'Does a thing' }),
      ],
    });
    const [a, b] = compileCustomActions(composition);
    expect(a).not.toHaveProperty('description');
    expect(b!.description).toBe('Does a thing');
  });
});
