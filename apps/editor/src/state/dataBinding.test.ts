import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createRectangleLayer,
  createTextLayer,
} from '@ograf-editor/scene-model';
import { resolveEffectiveElement } from './dataBinding';

describe('resolveEffectiveElement', () => {
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
    layer.bindings = [
      { fieldId: content.id, targetProperty: 'content' },
      { fieldId: color.id, targetProperty: 'color' },
    ];

    expect(resolveEffectiveElement(layer, {}, [], [content, color])).toMatchObject({
      content: 'Studio headline',
      color: '#ff3366',
    });
  });

  it('maps one select field to multiple typography properties', () => {
    const layer = createTextLayer();
    const typography = createFieldDefinition('select', {
      defaultValue: 'latin',
      options: [
        { value: 'latin', label: 'Latin' },
        { value: 'arabic', label: 'Arabic' },
      ],
    });
    layer.bindings = [
      {
        fieldId: typography.id,
        targetProperty: 'fontFamily',
        valueMap: { latin: 'Arial', arabic: 'Noto Sans Arabic' },
      },
      {
        fieldId: typography.id,
        targetProperty: 'fontSize',
        valueMap: { latin: '64', arabic: '72' },
      },
      {
        fieldId: typography.id,
        targetProperty: 'lineHeight',
        valueMap: { latin: '1.1', arabic: '1.3' },
      },
    ];

    expect(resolveEffectiveElement(layer, {}, [], [typography])).toMatchObject({
      fontFamily: 'Arial',
      fontSize: 64,
      lineHeight: 1.1,
    });
    expect(
      resolveEffectiveElement(layer, { [typography.id]: 'arabic' }, [], [typography]),
    ).toMatchObject({
      fontFamily: 'Noto Sans Arabic',
      fontSize: 72,
      lineHeight: 1.3,
    });
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
