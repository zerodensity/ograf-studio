import { describe, expect, it } from 'vitest';
import { createComposition, createFieldDefinition, createLayerOfKind } from './factory';
import { applyStylePack, removeStylePack, STYLE_TOKEN_KEYS } from './stylePacks';
import { syncDesignToken } from './designSystem';
import { readColor } from './stylePackColorLinks';

function fixture() {
  const c = createComposition();
  const colors = [
    ['accent-custom', '#ff602b'],
    ['face-light', '#808080'],
    ['face-dark', '#404040'],
  ] as const;
  for (const [id, value] of colors)
    c.designSystem.tokens.push({
      id,
      key: `station.${id}`,
      name: id,
      type: 'color',
      value,
      description: '',
    });
  const fields = colors.map(([id, value]) =>
    createFieldDefinition('color', { key: id, defaultValue: value, defaultTokenId: id }),
  );
  c.dataFields.push(...fields);
  const accent = createLayerOfKind('rectangle'),
    badge = createLayerOfKind('rectangle'),
    face = createLayerOfKind('rectangle');
  accent.semantics.role = 'accent';
  badge.semantics.role = 'container';
  face.semantics.role = 'container';
  for (const layer of [accent, badge]) {
    if (layer.element.type === 'rectangle') layer.element.fill = '#ff602b';
    layer.bindings = [{ fieldId: fields[0]!.id, targetProperty: 'fill' }];
    layer.designTokenBindings = [{ tokenId: 'accent-custom', targetProperty: 'fill' }];
  }
  if (face.element.type === 'rectangle')
    face.element.fill = {
      type: 'linear',
      angle: 45,
      stops: [
        { offset: 0, color: '#808080', opacity: 0.7 },
        { offset: 1, color: '#404040', opacity: 1 },
      ],
    };
  face.bindings = fields
    .slice(1)
    .map((field, i) => ({ fieldId: field.id, targetProperty: `fill.stops[${i}].color` }));
  face.designTokenBindings = ['face-light', 'face-dark'].map((tokenId, i) => ({
    tokenId,
    targetProperty: `fill.stops[${i}].color` as const,
  }));
  c.layers.push(accent, badge, face);
  const componentFace = structuredClone(face);
  componentFace.id = 'component-face';
  const componentField = structuredClone(fields[1]!);
  componentField.id = 'component-color';
  c.components.push({
    id: 'component',
    name: 'Face',
    layers: [componentFace],
    dataFields: [componentField],
  });
  return { c, fields, accent, badge, face };
}

describe('pack palettes and existing color controls', () => {
  it('updates shared bound colors and keeps gradient shading, alpha and component colors', () => {
    const { c, fields, accent, badge, face } = fixture();
    applyStylePack(c, 'sports');
    expect(fields[0]!.defaultValue).toBe('#00E5FF');
    expect(accent.element).toMatchObject({ fill: '#00E5FF' });
    expect(badge.element).toMatchObject({ fill: '#00E5FF' });
    expect(face.element).toMatchObject({
      fill: {
        type: 'linear',
        angle: 45,
        stops: [
          { offset: 0, opacity: 0.7, color: '#13232A' },
          { offset: 1, opacity: 1, color: '#0A1215' },
        ],
      },
    });
    expect(fields[1]!.defaultValue).toBe('#13232A');
    expect(fields[2]!.defaultValue).toBe('#0A1215');
    expect(c.components[0]!.layers[0]!.element).toEqual(face.element);
  });
  it('propagates parent swatch edits and lets existing custom swatches still work', () => {
    const { c, fields, face } = fixture();
    applyStylePack(c, 'sports');
    const parent = c.designSystem.tokens.find((t) => t.key === STYLE_TOKEN_KEYS.surface)!;
    parent.value = '#804020';
    syncDesignToken(c, parent.id);
    expect(fields[1]!.defaultValue).toBe('#804020');
    expect(fields[2]!.defaultValue).toBe('#402010');
    const custom = c.designSystem.tokens.find((t) => t.id === 'face-light')!;
    custom.value = '#abcdef';
    syncDesignToken(c, custom.id);
    expect(fields[1]!.defaultValue).toBe('#abcdef');
    expect(face.element).toMatchObject({
      fill: { stops: [{ color: '#abcdef' }, { color: '#402010' }] },
    });
  });
  it('does not accumulate tint changes and restores custom palettes, fields and components exactly', () => {
    const { c } = fixture(),
      before = structuredClone(c);
    applyStylePack(c, 'news');
    const first = structuredClone(c.layers);
    applyStylePack(c, 'sports');
    applyStylePack(c, 'news');
    expect(c.layers).toEqual(first);
    removeStylePack(c);
    expect(c).toEqual(before);
  });
  it('updates a color field without a token and preserves embedded gradient alpha', () => {
    const c = createComposition(),
      field = createFieldDefinition('color', { key: 'accent', defaultValue: '#aa3300' }),
      layer = createLayerOfKind('rectangle');
    c.dataFields.push(field);
    c.layers.push(layer);
    layer.semantics.role = 'accent';
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
    applyStylePack(c, 'sports');
    expect(field.defaultValue).toBe('#00E5FF');
    const parent = c.designSystem.tokens.find((t) => t.key === STYLE_TOKEN_KEYS.accent)!;
    parent.value = '#ff0000';
    syncDesignToken(c, parent.id);
    expect(field.defaultValue).toBe('#ff0000');
    removeStylePack(c);
    expect(field.defaultValue).toBe('#aa3300');
    if (layer.element.type !== 'rectangle') throw Error('Expected rectangle');
    layer.bindings = [];
    layer.element.fill = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: 'rgba(255, 255, 255, 0.5)', opacity: 0.2 },
        { offset: 1, color: '#ffffff', opacity: 0 },
      ],
    };
    applyStylePack(c, 'sports');
    expect(readColor(layer.element.fill.stops[0]!.color)?.alpha).toBe(0.5);
    expect(layer.element.fill.stops[0]!.opacity).toBe(0.2);
  });
});
