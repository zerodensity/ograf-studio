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
        createFieldDefinition('integer', { key: 'h' }),
        createFieldDefinition('duration-ms', { key: 'i' }),
        createFieldDefinition('percentage', { key: 'j' }),
        createFieldDefinition('file-path', { key: 'k' }),
        createFieldDefinition('select', { key: 'l' }),
        createFieldDefinition('select-multiple', { key: 'm' }),
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
      h: 'integer',
      i: 'integer',
      j: 'number',
      k: 'string',
      l: 'string',
      m: 'array',
    });
    expect(properties.f!.properties?.stops?.minItems).toBe(2);
    expect(Object.values(properties).every((property) => Boolean(property.gddType))).toBe(true);
  });

  it('emits official GDD hints, options, descriptions, and constraints', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('image-url', {
          key: 'logo',
          fileExtensions: ['png', 'svg'],
        }),
        createFieldDefinition('text', {
          key: 'title',
          description: 'Short on-air title',
          constraints: { minLength: 2, maxLength: 40, pattern: '^[A-Z]' },
        }),
        createFieldDefinition('select', {
          key: 'theme',
          options: [
            { value: 'news', label: 'News' },
            { value: 'sport', label: 'Sport' },
          ],
          defaultValue: 'news',
        }),
        createFieldDefinition('select-multiple', {
          key: 'regions',
          options: [
            { value: 'eu', label: 'Europe' },
            { value: 'na', label: 'North America' },
          ],
          defaultValue: ['eu'],
        }),
      ],
    });
    const { properties } = compileDataSchema(composition);
    expect(properties.logo).toMatchObject({
      gddType: 'file-path/image-path',
      gddOptions: { extensions: ['png', 'svg'] },
    });
    expect(properties.title).toMatchObject({
      gddType: 'single-line',
      description: 'Short on-air title',
      minLength: 2,
      maxLength: 40,
      pattern: '^[A-Z]',
    });
    expect(properties.theme).toMatchObject({
      gddType: 'select',
      enum: ['news', 'sport'],
      gddOptions: { labels: { news: 'News', sport: 'Sport' } },
    });
    expect(properties.regions).toMatchObject({
      type: 'array',
      gddType: 'select-multiple',
      items: { type: 'string', enum: ['eu', 'na'] },
      gddOptions: { labels: { eu: 'Europe', na: 'North America' } },
    });
  });

  it('keys properties by field key (not id) and carries label + default', () => {
    const composition = createComposition({
      dataFields: [
        createFieldDefinition('text', { key: 'headline', label: 'Headline', defaultValue: 'Hi' }),
      ],
    });
    const { properties } = compileDataSchema(composition);
    expect(properties.headline).toEqual({
      type: 'string',
      title: 'Headline',
      default: 'Hi',
      gddType: 'single-line',
    });
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
