import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createRectangleLayer,
  createTextLayer,
} from '@ograf-editor/scene-model';
import {
  bindableProperties,
  propertyAcceptsField,
  propertyAcceptsFieldType,
  resolveEffectiveElement,
} from './dataBinding';

describe('resolveEffectiveElement', () => {
  it('offers font family as a text-layer binding target', () => {
    const layer = createTextLayer();
    expect(bindableProperties(layer.element)).toContainEqual({
      value: 'fontFamily',
      label: 'Font family',
      fieldTypes: ['select'],
      selectValues: 'font-family',
    });
  });

  it('uses select options to distinguish fonts, colors and enumerated properties', () => {
    const properties = bindableProperties(createTextLayer().element);
    const property = (value: string) => properties.find((candidate) => candidate.value === value)!;
    const fonts = createFieldDefinition('select', {
      options: [
        { value: 'Arial, sans-serif', label: 'Arial' },
        { value: 'Inter', label: 'Inter' },
      ],
    });
    const colors = createFieldDefinition('select', {
      options: [
        { value: '#ff0000', label: 'Red' },
        { value: '#0000ff', label: 'Blue' },
      ],
    });
    const alignment = createFieldDefinition('select', {
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
      ],
    });

    expect(propertyAcceptsField(property('fontFamily'), fonts)).toBe(true);
    expect(propertyAcceptsField(property('dropShadowColor'), fonts)).toBe(false);
    expect(propertyAcceptsField(property('fontFamily'), colors)).toBe(false);
    expect(propertyAcceptsField(property('dropShadowColor'), colors)).toBe(true);
    expect(propertyAcceptsField(property('textAlign'), alignment)).toBe(true);
    expect(propertyAcceptsField(property('textAlign'), fonts)).toBe(false);
    expect(propertyAcceptsField(property('fontFamily'), alignment)).toBe(false);
  });

  it('matches binding targets to compatible field types', () => {
    const properties = bindableProperties(createTextLayer().element);
    const property = (value: string) => properties.find((candidate) => candidate.value === value)!;
    expect(propertyAcceptsFieldType(property('fontFamily'), 'select')).toBe(true);
    expect(propertyAcceptsFieldType(property('fontFamily'), 'number')).toBe(false);
    expect(propertyAcceptsFieldType(property('fontSize'), 'number')).toBe(true);
    expect(propertyAcceptsFieldType(property('fontSize'), 'duration-ms')).toBe(false);
    expect(propertyAcceptsFieldType(property('fontSize'), 'percentage')).toBe(false);
    expect(propertyAcceptsFieldType(property('fontSize'), 'color')).toBe(false);
    expect(propertyAcceptsFieldType(property('color'), 'color')).toBe(true);
    expect(propertyAcceptsFieldType(property('color'), 'text')).toBe(false);
    expect(propertyAcceptsFieldType(property('strokeColor'), 'text')).toBe(false);
  });

  it('allows color selects for shape fills without accepting font selects', () => {
    const fill = bindableProperties(createRectangleLayer().element).find(
      (property) => property.value === 'fill',
    )!;
    const colors = createFieldDefinition('select', {
      options: [{ value: '#ff0000', label: 'Red' }],
    });
    const fonts = createFieldDefinition('select', {
      options: [{ value: 'Inter', label: 'Inter' }],
    });

    expect(propertyAcceptsField(fill, colors)).toBe(true);
    expect(propertyAcceptsField(fill, fonts)).toBe(false);
  });

  it('uses the declared field default when no explicit test value exists', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('color', {
      defaultValue: '#ff0000',
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle layer.');
    layer.element.fill = '#0000ff';

    expect(resolveEffectiveElement(layer, {}, [], [field])).toMatchObject({ fill: '#ff0000' });
    expect(resolveEffectiveElement(layer, { [field.id]: '#00ff00' }, [], [field])).toMatchObject({
      fill: '#00ff00',
    });
  });

  it('applies multiple independent bindings to one layer in order', () => {
    const layer = createTextLayer();
    const content = createFieldDefinition('text', { defaultValue: 'Studio headline' });
    const color = createFieldDefinition('color', { defaultValue: '#ff3366' });
    const font = createFieldDefinition('select', {
      defaultValue: 'Inter',
      options: [{ value: 'Inter', label: 'Inter' }],
    });
    layer.bindings = [
      { fieldId: content.id, targetProperty: 'content' },
      { fieldId: color.id, targetProperty: 'color' },
      { fieldId: font.id, targetProperty: 'fontFamily' },
    ];

    expect(resolveEffectiveElement(layer, {}, [], [content, color, font])).toMatchObject({
      content: 'Studio headline',
      color: '#ff3366',
      fontFamily: 'Inter',
    });
  });

  it('maps one font-set field to different families per text role', () => {
    const field = createFieldDefinition('select', {
      defaultValue: 'latin',
      options: [
        { value: 'latin', label: 'Latin' },
        { value: 'arabic', label: 'Arabic' },
      ],
    });
    const headline = createTextLayer();
    const body = createTextLayer();
    headline.bindings = [
      {
        fieldId: field.id,
        targetProperty: 'fontFamily',
        valueMap: { latin: 'frabk', arabic: 'verdana' },
      },
    ];
    body.bindings = [
      {
        fieldId: field.id,
        targetProperty: 'fontFamily',
        valueMap: { latin: 'verdana', arabic: 'frabk' },
      },
    ];

    expect(resolveEffectiveElement(headline, {}, [], [field])).toHaveProperty(
      'fontFamily',
      'frabk',
    );
    expect(resolveEffectiveElement(body, {}, [], [field])).toHaveProperty('fontFamily', 'verdana');
    expect(resolveEffectiveElement(headline, { [field.id]: 'arabic' }, [], [field])).toHaveProperty(
      'fontFamily',
      'verdana',
    );
    expect(resolveEffectiveElement(body, { [field.id]: 'arabic' }, [], [field])).toHaveProperty(
      'fontFamily',
      'frabk',
    );
  });

  it('previews the first runtime collection item through a nested source path', () => {
    const layer = createTextLayer();
    const field = createFieldDefinition('array', {
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name' })],
        defaultValue: { name: '' },
      }),
      defaultValue: [{ name: 'Ada' }, { name: 'Lin' }],
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    expect(resolveEffectiveElement(layer, {}, [], [field])).toMatchObject({ content: 'Ada' });
    expect(
      resolveEffectiveElement(layer, { [field.id]: [{ name: 'Grace' }] }, [], [field]),
    ).toMatchObject({ content: 'Grace' });
  });
});
