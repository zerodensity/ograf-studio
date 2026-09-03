import { describe, expect, it } from 'vitest';
import { createLayerOfKind, createProject, createFieldDefinition } from './factory';
import {
  applyDesignTokenBinding,
  bindFieldDefaultToken,
  syncDesignTokenFieldDefaults,
} from './designSystem';
import type { DesignToken } from './types';

const token: DesignToken = {
  id: 'brand',
  key: 'brand',
  name: 'Brand',
  type: 'color',
  value: '#cc6622',
  description: '',
};
describe('Brand Kit gradient and shadow colors', () => {
  it('materializes linked field defaults and detaches without losing the last value', () => {
    const c = createProject().compositions[0]!;
    c.designSystem.tokens.push({ ...token });
    const field = createFieldDefinition('color');
    c.dataFields.push(field);
    bindFieldDefaultToken(c, field, token.id);
    expect(field.defaultValue).toBe(token.value);
    c.designSystem.tokens[0]!.value = '#22aaff';
    syncDesignTokenFieldDefaults(c, token.id);
    expect(field.defaultValue).toBe('#22aaff');
    bindFieldDefaultToken(c, field, null);
    c.designSystem.tokens[0]!.value = '#ff9922';
    syncDesignTokenFieldDefaults(c, token.id);
    expect(field.defaultValue).toBe('#22aaff');
    expect(field.defaultTokenId).toBeUndefined();
  });
  it('recolors a stop without flattening transparent gradients or retiming motion', () => {
    const layer = createLayerOfKind('pattern');
    if (layer.element.type !== 'pattern') throw Error();
    layer.element.fill = {
      type: 'linear',
      angle: 110,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 0 },
        { offset: 0.5, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#ffffff', opacity: 0 },
      ],
    };
    const before = structuredClone(layer);
    applyDesignTokenBinding(
      layer,
      { tokenId: token.id, targetProperty: 'fill.stops[1].color' },
      token,
    );
    const expected = structuredClone(before);
    if (expected.element.type === 'pattern' && typeof expected.element.fill !== 'string')
      expected.element.fill.stops[1]!.color = '#cc6622';
    expect(layer).toEqual(expected);
  });
  it('changes shadow hue without changing its strength, blur or enabled state', () => {
    const layer = createLayerOfKind('rectangle'),
      before = structuredClone(layer);
    applyDesignTokenBinding(layer, { tokenId: token.id, targetProperty: 'dropShadowColor' }, token);
    expect(layer).toEqual({
      ...before,
      effects: { ...before.effects, dropShadowColor: '#cc6622' },
    });
  });
  it('rejects a missing stop and wrong token types without touching the layer', () => {
    const layer = createLayerOfKind('rectangle'),
      before = structuredClone(layer);
    expect(() =>
      applyDesignTokenBinding(
        layer,
        { tokenId: token.id, targetProperty: 'fill.stops[7].color' },
        token,
      ),
    ).toThrow('existing gradient stop');
    expect(() =>
      applyDesignTokenBinding(
        layer,
        { tokenId: token.id, targetProperty: 'dropShadowColor' },
        { ...token, type: 'number', value: 3 },
      ),
    ).toThrow('color design token');
    expect(layer).toEqual(before);
  });
});
