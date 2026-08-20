import { describe, expect, it } from 'vitest';
import { createFieldDefinition, createRectangleLayer } from '@ograf-editor/scene-model';
import { resolveEffectiveElement } from './dataBinding';

describe('resolveEffectiveElement', () => {
  it('uses the declared field default when no explicit test value exists', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('color', {
      defaultValue: '#ff0000',
    });
    layer.binding = { fieldId: field.id, targetProperty: 'fill' };
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle layer.');
    layer.element.fill = '#0000ff';

    expect(resolveEffectiveElement(layer, {}, [], [field])).toMatchObject({ fill: '#ff0000' });
    expect(resolveEffectiveElement(layer, { [field.id]: '#00ff00' }, [], [field])).toMatchObject({
      fill: '#00ff00',
    });
  });
});
