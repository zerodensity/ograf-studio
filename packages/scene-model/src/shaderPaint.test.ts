import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createShaderElement,
} from './factory';
import {
  createShaderPaint,
  getElementFill,
  getElementShaderPaint,
  getElementShaderPaints,
  hasElementShaderPaint,
  isShaderPaint,
} from './shader';
import { shaderParameterTarget } from './shaderParameters';
import { createDefaultGradient, isGradientPaint, paintToCss, validatePaint } from './paint';
import { applyElementDataValue } from './boundPaint';
import { getLayerAnimatableProperties, getPaintAtFrame } from './layerAnimation';
import { syncShaderParameterFields } from './shaderFields';
import { migrateProject } from './migrations';
import { layerMaskErrors, maskSourceSupportsMode } from './masking';
import { svgMaskSourceContent } from './svgPaint';
import type { Element } from './types';

describe('shader paint model', () => {
  it('keeps text fill and outline parameters independent while preserving existing fill field identities', () => {
    const composition = createComposition();
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected editable text.');
    text.element.content = 'Editable headline';
    text.element.fill = createShaderPaint({ parameters: { waveFrequency: 3 } });
    composition.layers = [text];
    syncShaderParameterFields(composition, text);
    const fillFields = structuredClone(composition.dataFields);
    text.element.strokePaint = createShaderPaint({ parameters: { waveFrequency: 12 } });
    text.element.strokeWidth = 8;
    syncShaderParameterFields(composition, text);
    expect(
      composition.dataFields.filter(
        (field) => field.generatedShaderParameter?.paintSlot === 'fill',
      ),
    ).toEqual(fillFields);
    expect(composition.dataFields).toHaveLength(6);
    expect(new Set(composition.dataFields.map((field) => field.key)).size).toBe(6);
    expect(getElementShaderPaints(text.element).map(({ slot }) => slot)).toEqual([
      'fill',
      'stroke',
    ]);
    expect(shaderParameterTarget('waveFrequency', 'stroke')).toBe(
      'strokePaint.parameters.waveFrequency',
    );
    const resolved = applyElementDataValue(text.element, 'strokePaint.parameters.waveFrequency', 7);
    expect(getElementShaderPaint(resolved)?.parameters.waveFrequency).toBe(3);
    expect(getElementShaderPaint(resolved, 'stroke')?.parameters.waveFrequency).toBe(7);
    const outlineField = composition.dataFields.find(
      (field) =>
        field.generatedShaderParameter?.paintSlot === 'stroke' &&
        field.generatedShaderParameter.name === 'waveFrequency',
    )!;
    outlineField.defaultValue = 11;
    syncShaderParameterFields(composition, text);
    expect(text.element.strokePaint.parameters.waveFrequency).toBe(11);
    expect(text.element.fill.parameters.waveFrequency).toBe(3);
    delete text.element.strokePaint;
    syncShaderParameterFields(composition, text);
    expect(composition.dataFields).toEqual(fillFields);
    expect(
      text.bindings.every((binding) => binding.targetProperty.startsWith('fill.parameters.')),
    ).toBe(true);
    expect(hasElementShaderPaint(text.element)).toBe(true);
    expect(text.element.content).toBe('Editable headline');
  });

  it('normalizes and preserves a stroke-only text shader through project migration', () => {
    const project = createProject();
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text.');
    text.element.strokePaint = createShaderPaint({ parameters: { waveFrequency: 4 } });
    text.element.content = 'Still text';
    text.element.strokeWidth = 6;
    project.compositions[0]!.layers = [text];
    const migrated = migrateProject(project);
    const result = migrated.compositions[0]!.layers[0]!;
    expect(result.element).toMatchObject({
      type: 'text',
      content: 'Still text',
      color: '#ffffff',
      strokeWidth: 6,
      strokePaint: { type: 'shader', parameters: { waveFrequency: 4 } },
    });
    expect(getElementShaderPaint(result.element)).toBeUndefined();
    expect(hasElementShaderPaint(result.element)).toBe(true);
    expect(
      result.bindings.every((binding) =>
        binding.targetProperty.startsWith('strokePaint.parameters.'),
      ),
    ).toBe(true);
  });
  it('detaches incompatible paint links without deleting ordinary fields, tokens, or unrelated bindings', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    const color = createFieldDefinition('color', { key: 'original_fill', defaultValue: '#ff0000' });
    const token = {
      id: 'brand',
      key: 'brand',
      name: 'Brand',
      type: 'color' as const,
      value: '#00ff00',
      description: '',
    };
    composition.layers = [layer];
    composition.dataFields = [color];
    composition.designSystem.tokens = [token];
    layer.bindings = [
      { fieldId: color.id, targetProperty: 'fill' },
      { fieldId: color.id, targetProperty: 'fill.stops[0].color' },
      { fieldId: color.id, targetProperty: 'strokeColor' },
    ];
    layer.designTokenBindings = [
      { tokenId: token.id, targetProperty: 'fill' },
      { tokenId: token.id, targetProperty: 'fill.stops[0].color' },
      { tokenId: token.id, targetProperty: 'strokeColor' },
    ];
    layer.element.fill = createShaderPaint();
    syncShaderParameterFields(composition, layer);
    expect(layer.bindings.map((binding) => binding.targetProperty)).toEqual([
      'strokeColor',
      'fill.parameters.waveFrequency',
      'fill.parameters.backgroundColor',
      'fill.parameters.highlightColor',
    ]);
    expect(layer.designTokenBindings).toEqual([
      { tokenId: token.id, targetProperty: 'strokeColor' },
    ]);
    const resolved = layer.bindings.reduce<Element>(
      (element, binding) =>
        applyElementDataValue(
          element,
          binding.targetProperty,
          composition.dataFields.find((field) => field.id === binding.fieldId)!.defaultValue,
        ),
      layer.element,
    );
    expect(getElementShaderPaint(resolved)).toBeDefined();
    expect(composition.dataFields.find((field) => field.id === color.id)).toEqual(color);
    expect(composition.designSystem.tokens).toEqual([token]);
    layer.element.fill = '#ffffff';
    syncShaderParameterFields(composition, layer);
    expect(composition.dataFields).toEqual([color]);
    expect(() => applyElementDataValue(layer.element, 'fill.parameters.waveFrequency', 1)).toThrow(
      /requires a shader paint/,
    );
  });
  it('migrates legacy shader objects and binding paths while retaining identity, geometry, source and public fields', () => {
    const project = createProject({ documentVersion: 31 });
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('shader');
    layer.element = createShaderElement({
      name: '  Legacy background  ',
      speed: 0.5,
      resolutionScale: 0.5,
    });
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 14, width: 1920, height: 1080 })),
    ];
    layer.effects.blur = 2;
    composition.layers = [layer];
    syncShaderParameterFields(composition, layer);
    layer.bindings = layer.bindings.map((binding) => ({
      ...binding,
      targetProperty: binding.targetProperty.replace(/^fill\./, ''),
    }));
    composition.dataFields[0]!.key = 'existing_public_key';
    const source = structuredClone(project);
    const migrated = migrateProject(project);
    const restored = migrated.compositions[0]!.layers[0]!;
    expect(migrated.documentVersion).toBe(33);
    expect(restored.id).toBe(layer.id);
    expect(getElementShaderPaint(restored.element)?.name).toBe('Legacy background');
    expect(restored.keyframes).toEqual(layer.keyframes);
    expect(restored.effects.blur).toBe(2);
    expect(restored.element).toMatchObject({
      type: 'rectangle',
      strokeWidth: 0,
      borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
      fill: layer.element,
    });
    expect(
      restored.bindings.every((binding) => binding.targetProperty.startsWith('fill.parameters.')),
    ).toBe(true);
    expect(migrated.compositions[0]!.dataFields.map((field) => [field.id, field.key])).toEqual(
      composition.dataFields.map((field) => [field.id, field.key]),
    );
    expect(project).toEqual(source);
  });

  it('distinguishes shader and gradient paints across shape and media consumers', () => {
    const shader = createShaderPaint();
    expect(isShaderPaint(shader)).toBe(true);
    expect(isGradientPaint(shader)).toBe(false);
    expect(validatePaint(shader)).toEqual([]);
    expect(paintToCss(shader)).toBe('transparent');
    expect(getPaintAtFrame(shader, {}, 50)).toBe(shader);
    for (const kind of [
      'rectangle',
      'ellipse',
      'path',
      'pattern',
      'text',
      'image',
      'image-sequence',
      'lottie',
    ] as const) {
      const layer = createLayerOfKind(kind);
      if (layer.element.type === 'shader') throw new Error('Expected canonical object.');
      layer.element.fill = structuredClone(shader);
      expect(getElementShaderPaint(layer.element)).toEqual(shader);
      expect(getLayerAnimatableProperties(layer)).not.toContain('fill.stops[0].offset');
    }
    expect(createLayerOfKind('shader').element.type).toBe('rectangle');
  });

  it('retains legacy text color semantics and permits gradient stop animation', () => {
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    expect(getElementFill(layer.element)).toBe(layer.element.color);
    layer.element.fill = '#aa0000';
    expect(applyElementDataValue(layer.element, 'color', '#00bb00')).toMatchObject({
      color: '#00bb00',
      fill: '#00bb00',
    });
    layer.element.fill = createDefaultGradient();
    expect(getLayerAnimatableProperties(layer)).toContain('fill.stops[0].offset');
    expect(applyElementDataValue(layer.element, 'color', '#00bb00')).toMatchObject({
      color: '#00bb00',
      fill: layer.element.fill,
    });
  });

  it('binds typed shader fill parameters and clears generated fields when paint is removed', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('image');
    if (layer.element.type !== 'image') throw new Error('Expected image.');
    layer.element.fill = createShaderPaint();
    composition.layers = [layer];
    composition.dataFields.push(createFieldDefinition('number', { key: 'keep_user_field' }));
    syncShaderParameterFields(composition, layer);
    const updated = applyElementDataValue(layer.element, 'fill.parameters.waveFrequency', 4);
    expect(getElementShaderPaint(updated)?.parameters.waveFrequency).toBe(4);
    expect(composition.dataFields).toHaveLength(4);
    delete layer.element.fill;
    syncShaderParameterFields(composition, layer);
    expect(layer.bindings).toEqual([]);
    expect(composition.dataFields.map((field) => field.key)).toEqual(['keep_user_field']);
  });

  it('permits geometric mask sourcing while rejecting shader alpha-mask sourcing', () => {
    const source = createLayerOfKind('rectangle');
    if (source.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    source.element.fill = createShaderPaint();
    const target = createLayerOfKind('ellipse');
    const composition = createComposition({ layers: [source, target] });
    target.mask = { sourceLayerId: source.id, mode: 'alpha', inverted: false };
    expect(maskSourceSupportsMode(source, 'alpha')).toBe(false);
    expect(layerMaskErrors(composition).join(' ')).toContain('shader-painted');
    target.mask.mode = 'path';
    expect(layerMaskErrors(composition)).toEqual([]);
    expect(svgMaskSourceContent(source.element, 100, 100, 'shader-mask', true)).toContain(
      'fill="#ffffff"',
    );
  });
});
