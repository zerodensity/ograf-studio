import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyElementDataValue } from './boundPaint';
import {
  createAsset,
  createComposition,
  createFieldDefinition,
  createTextLayer,
  createRectangleLayer,
} from './factory';
import {
  TYPOGRAPHY_PROPERTIES,
  applyTypographyPresetBinding,
  createDefaultTypographyPresets,
  markTypographyOverrides,
  syncTypographyPresets,
  typographyBindingErrors,
  typographyPresetErrors,
  typographyPresetsErrors,
} from './typography';
import type { Layer, TypographyPreset } from './types';

function fixture() {
  const layer = createTextLayer();
  if (layer.element.type !== 'text') throw new Error('Expected text.');
  layer.element.content = 'Broadcast headline';
  layer.element.fontSize = 48;
  layer.element.minFontSize = 24;
  layer.animationTracks.x = [
    { id: 'x0', frame: 0, value: -100, easing: 'linear' },
    { id: 'x1', frame: 20, value: 100, easing: 'cubic-out' },
  ];
  const presets = createDefaultTypographyPresets('Brand Sans, Arial');
  const composition = createComposition({
    layers: [layer],
    designSystem: { name: 'News', tokens: [], typography: presets },
  });
  return { composition, layer, presets, headline: presets[0]! };
}

describe('combined typography presets', () => {
  it('creates independent Headline, Body and Caption presets with stable IDs', () => {
    const a = createDefaultTypographyPresets(),
      b = createDefaultTypographyPresets('Brand Sans');
    expect(a.map((preset) => preset.name)).toEqual(['Headline', 'Body', 'Caption']);
    expect(a.map((preset) => preset.id)).toEqual(b.map((preset) => preset.id));
    expect(a[0]!.properties.fontFamily).toBe('Arial');
    expect(b.every((preset) => preset.properties.fontFamily === 'Brand Sans')).toBe(true);
    expect(typographyPresetsErrors(a)).toEqual([]);
    a[0]!.properties.fontSize = 100;
    expect(createDefaultTypographyPresets()[0]!.properties.fontSize).toBe(64);
    expect(TYPOGRAPHY_PROPERTIES).toHaveLength(7);
  });

  it('materializes typography without touching palette, content, runs, layout, keys or assets', () => {
    const { composition, layer, headline } = fixture();
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.color = '#223344';
    layer.element.fill = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#223344', opacity: 0.5 },
        { offset: 1, color: '#556677', opacity: 1 },
      ],
    };
    layer.element.runs = [{ text: 'Broadcast headline', color: '#ff0000', fontFamily: 'Run Font' }];
    layer.element.verticalAlign = 'middle';
    layer.element.baselineShift = 3;
    layer.designTokenBindings = [
      { tokenId: 'font', targetProperty: 'fontFamily' },
      { tokenId: 'size', targetProperty: 'fontSize' },
      { tokenId: 'color', targetProperty: 'color' },
      { tokenId: 'outline', targetProperty: 'strokeColor' },
    ];
    composition.assets.push(
      createAsset({
        kind: 'font',
        fontFamily: 'Brand Sans',
        dataUri: 'data:font/woff2;base64,AA==',
      }),
    );
    const before = structuredClone(composition);
    expect(applyTypographyPresetBinding(composition, layer, headline)).toEqual([]);
    expect(layer.typographyBinding).toEqual({ presetId: headline.id });
    expect(layer.element).toMatchObject(headline.properties);
    expect(layer.element.minFontSize).toBe(32);
    expect(layer.element).toMatchObject({
      color: '#223344',
      fill: before.layers[0]!.element.type === 'text' && before.layers[0]!.element.fill,
      content: 'Broadcast headline',
      runs: [{ text: 'Broadcast headline', color: '#ff0000', fontFamily: 'Run Font' }],
      verticalAlign: 'middle',
      baselineShift: 3,
    });
    expect(layer.keyframes).toEqual(before.layers[0]!.keyframes);
    expect(layer.animationTracks).toEqual(before.layers[0]!.animationTracks);
    expect(layer.constraints).toEqual(before.layers[0]!.constraints);
    expect(layer.effects).toEqual(before.layers[0]!.effects);
    expect(layer.designTokenBindings).toEqual([
      { tokenId: 'color', targetProperty: 'color' },
      { tokenId: 'outline', targetProperty: 'strokeColor' },
    ]);
    expect(composition.assets).toEqual(before.assets);
  });

  it('updates data-bound font defaults without removing bindings or changing text data', () => {
    const { composition, layer, headline } = fixture();
    const family = createFieldDefinition('text', { key: 'font', defaultValue: 'Arial' });
    const size = createFieldDefinition('number', { key: 'size', defaultValue: 48 });
    const text = createFieldDefinition('text', { key: 'title', defaultValue: 'Operator headline' });
    composition.dataFields.push(family, size, text);
    layer.bindings = [
      { fieldId: family.id, targetProperty: 'fontFamily' },
      { fieldId: size.id, targetProperty: 'fontSize' },
      { fieldId: text.id, targetProperty: 'content' },
    ];
    const bindings = structuredClone(layer.bindings);
    expect(applyTypographyPresetBinding(composition, layer, headline)).toEqual([
      { fieldId: family.id, sourcePath: [] },
      { fieldId: size.id, sourcePath: [] },
    ]);
    expect(family.defaultValue).toBe(headline.properties.fontFamily);
    expect(size.defaultValue).toBe(headline.properties.fontSize);
    expect(size.type).toBe('number');
    expect(text.defaultValue).toBe('Operator headline');
    expect(layer.bindings).toEqual(bindings);
    // Playback data retains its later precedence over the materialized authoring default.
    expect(applyElementDataValue(layer.element, 'fontSize', 90)).toMatchObject({ fontSize: 90 });
  });

  it('preserves mapped controls while updating their active authored typography output', () => {
    const { composition, layer, headline } = fixture();
    const mode = createFieldDefinition('text', { defaultValue: 'large' });
    composition.dataFields.push(mode);
    layer.bindings = [
      { fieldId: mode.id, targetProperty: 'fontSize', valueMap: { large: 48, small: 24 } },
    ];
    applyTypographyPresetBinding(composition, layer, headline);
    expect(mode.defaultValue).toBe('large');
    expect(layer.bindings[0]!.valueMap).toEqual({ large: 64, small: 24 });
  });

  it('honors per-property overrides and reset without creating or destroying keys', () => {
    const { composition, layer, headline } = fixture();
    applyTypographyPresetBinding(composition, layer, headline);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fontSize = 90;
    layer.element.minFontSize = 45;
    markTypographyOverrides(layer, ['fontSize', 'content', 'color', 'fontSize', 'fontSize.extra']);
    expect(layer.typographyBinding!.overrides).toEqual(['fontSize']);
    const tracks = structuredClone(layer.animationTracks);
    headline.properties.fontSize = 80;
    headline.properties.fontFamily = 'New Brand Sans';
    syncTypographyPresets(composition);
    expect(layer.element).toMatchObject({
      fontSize: 90,
      minFontSize: 45,
      fontFamily: 'New Brand Sans',
    });
    layer.typographyBinding!.overrides = [];
    syncTypographyPresets(composition);
    expect(layer.element).toMatchObject({ fontSize: 80, minFontSize: 40 });
    expect(layer.animationTracks).toEqual(tracks);
  });

  it('clears old property overrides when explicitly selecting a different preset', () => {
    const { composition, layer, headline, presets } = fixture();
    applyTypographyPresetBinding(composition, layer, headline);
    markTypographyOverrides(layer, ['fontSize']);
    applyTypographyPresetBinding(composition, layer, presets[1]!);
    expect(layer.typographyBinding).toEqual({ presetId: presets[1]!.id });
    expect(layer.element).toMatchObject(presets[1]!.properties);
  });

  it('keeps independent later primitive token links during synchronization', () => {
    const { composition, layer, headline } = fixture();
    applyTypographyPresetBinding(composition, layer, headline);
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.fontFamily = 'Independent Font';
    layer.designTokenBindings.push({ tokenId: 'independent-font', targetProperty: 'fontFamily' });
    headline.properties.fontFamily = 'Updated Master Font';
    headline.properties.lineHeight = 1.5;
    syncTypographyPresets(composition);
    expect(layer.element).toMatchObject({ fontFamily: 'Independent Font', lineHeight: 1.5 });
    expect(layer.designTokenBindings).toEqual([
      { tokenId: 'independent-font', targetProperty: 'fontFamily' },
    ]);
    applyTypographyPresetBinding(composition, layer, headline);
    expect(layer.element.fontFamily).toBe('Updated Master Font');
    expect(layer.designTokenBindings).toEqual([]);
  });

  it('synchronizes component prototypes and their scoped bound defaults', () => {
    const { composition, headline } = fixture();
    const layer = createTextLayer();
    const field = createFieldDefinition('number', { defaultValue: 48 });
    layer.typographyBinding = { presetId: headline.id };
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fontSize' }];
    composition.components.push({
      id: 'component',
      name: 'Headline',
      layers: [layer],
      dataFields: [field],
    });
    expect(syncTypographyPresets(composition)).toEqual([{ fieldId: field.id, sourcePath: [] }]);
    expect(layer.element).toMatchObject(headline.properties);
    expect(field.defaultValue).toBe(64);
  });

  it('supports Immer drafts without structuredClone failures', () => {
    const { composition, headline } = fixture();
    const size = createFieldDefinition('number', { defaultValue: 48 });
    composition.dataFields.push(size);
    composition.layers[0]!.bindings = [{ fieldId: size.id, targetProperty: 'fontSize' }];
    const next = produce(composition, (draft) => {
      applyTypographyPresetBinding(draft, draft.layers[0]!, headline);
      draft.designSystem.typography![0]!.properties.fontSize = 80;
      syncTypographyPresets(draft);
    });
    expect(next.layers[0]!.element).toMatchObject({ fontSize: 80, minFontSize: 40 });
    expect(next.dataFields[0]!.defaultValue).toBe(80);
    expect(composition.dataFields[0]!.defaultValue).toBe(48);
  });
});

describe('typography validation', () => {
  it('strictly validates primitive shapes and bounded values without color or paint ownership', () => {
    const preset = createDefaultTypographyPresets()[0]!;
    expect(typographyPresetErrors(preset)).toEqual([]);
    for (const value of [
      null,
      [],
      { ...preset, id: '' },
      { ...preset, name: '' },
      { ...preset, extra: 1 },
      { ...preset, properties: {} },
      { ...preset, properties: { ...preset.properties, color: '#ffffff' } },
    ])
      expect(typographyPresetErrors(value)).not.toHaveLength(0);
    for (const [property, value] of [
      ['fontFamily', ''],
      ['fontFamily', 2],
      ['fontSize', 0],
      ['fontSize', Infinity],
      ['fontSize', 32769],
      ['fontWeight', 12.5],
      ['fontWeight', 1001],
      ['lineHeight', 0.4],
      ['lineHeight', 11],
      ['letterSpacing', NaN],
      ['letterSpacing', 1025],
      ['textAlign', 'justify'],
      ['textAlign', {}],
      ['textTransform', 'script'],
    ])
      expect(
        typographyPresetErrors({
          ...preset,
          properties: { ...preset.properties, [String(property)]: value },
        }),
      ).not.toHaveLength(0);
    expect(typographyPresetsErrors([preset, preset])).toContain(
      `Duplicate typography preset ID: ${preset.id}.`,
    );
    expect(typographyPresetsErrors(Array.from({ length: 257 }, () => preset))).not.toHaveLength(0);
    expect(() => createDefaultTypographyPresets('')).toThrow('font family');
  });

  it('validates references and unique supported overrides on text layers only', () => {
    const { layer, presets, headline, composition } = fixture();
    expect(typographyBindingErrors(layer, presets)).toEqual([]);
    layer.typographyBinding = { presetId: headline.id, overrides: ['fontSize'] };
    expect(typographyBindingErrors(layer, presets)).toEqual([]);
    layer.typographyBinding.overrides = ['fontSize', 'fontSize'];
    expect(typographyBindingErrors(layer, presets)).not.toHaveLength(0);
    const invalid = {
      ...layer,
      typographyBinding: { presetId: headline.id, overrides: ['color'] },
    } as unknown as Layer;
    expect(typographyBindingErrors(invalid, presets)).not.toHaveLength(0);
    layer.typographyBinding = { presetId: 'missing' };
    expect(typographyBindingErrors(layer, presets)).toContain(
      'Typography binding references a missing preset.',
    );
    const rectangle = createRectangleLayer();
    rectangle.typographyBinding = { presetId: headline.id };
    expect(typographyBindingErrors(rectangle, presets)).toContain(
      'Typography presets apply only to text layers.',
    );
    expect(() => applyTypographyPresetBinding(composition, rectangle, headline)).toThrow(
      'only to text',
    );
    const original = structuredClone(layer);
    expect(() =>
      applyTypographyPresetBinding(composition, layer, {
        ...headline,
        properties: { ...headline.properties, fontSize: 0 },
      } as TypographyPreset),
    ).toThrow('fontSize');
    expect(layer).toEqual(original);
  });
});
