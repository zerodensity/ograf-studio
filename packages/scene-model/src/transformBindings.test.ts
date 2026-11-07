import { describe, expect, it } from 'vitest';
import { createDefaultTransform, createFieldDefinition } from './factory';
import { applyLayerTransformBindings, layerTransformBindingErrors } from './transformBindings';

describe('native transform binding values', () => {
  it('replaces geometry while multiplying sampled opacity without mutating the authored pose', () => {
    const pose = createDefaultTransform({
      x: 1,
      y: 2,
      width: 30,
      height: 40,
      rotation: 5,
      opacity: 0.4,
    });
    const values = { x: 100, y: 200, width: 0, height: 60, rotation: -30, opacity: 0.5 };
    const result = applyLayerTransformBindings(
      pose,
      Object.entries(values).map(([channel, value]) => ({
        targetProperty: `layer.${channel}`,
        value,
      })),
      (binding) => binding.value,
    );
    expect(result).toMatchObject({ ...values, opacity: 0.2 });
    expect(pose).toMatchObject({ x: 1, opacity: 0.4 });
  });
  it('keeps animated fallback values for missing, nonnumeric, nonfinite or out-of-range input', () => {
    const pose = createDefaultTransform({ opacity: 0.3 });
    for (const [targetProperty, value] of [
      ['layer.x', '10'],
      ['layer.y', NaN],
      ['layer.width', -1],
      ['layer.height', Infinity],
      ['layer.rotation', null],
      ['layer.opacity', 2],
    ] as const)
      expect(applyLayerTransformBindings(pose, [{ targetProperty }], () => value)).toBe(pose);
    expect(
      applyLayerTransformBindings(
        pose,
        [{ targetProperty: 'layer.opacity', valueMap: { off: 0, on: 1 } }],
        () => 'off',
      ).opacity,
    ).toBe(0);
  });
  it('validates nested scalar/collection schemas and numeric mappings', () => {
    const x = createFieldDefinition('number', { key: 'x', defaultValue: 10 });
    const object = createFieldDefinition('object', { properties: [x], defaultValue: { x: 20 } });
    expect(
      layerTransformBindingErrors(
        { fieldId: object.id, targetProperty: 'layer.x', sourcePath: ['x'] },
        object,
      ),
    ).toEqual([]);
    const rows = createFieldDefinition('array', {
      items: object,
      defaultValue: [{ x: 10 }, { x: -1 }],
    });
    expect(
      layerTransformBindingErrors(
        { fieldId: rows.id, targetProperty: 'layer.width', sourcePath: ['x'] },
        rows,
      ).join(' '),
    ).toContain('zero or greater');
    const text = createFieldDefinition('text', { defaultValue: 'on' });
    expect(
      layerTransformBindingErrors({ fieldId: text.id, targetProperty: 'layer.opacity' }, text)
        .length,
    ).toBeGreaterThan(0);
    expect(
      layerTransformBindingErrors(
        { fieldId: text.id, targetProperty: 'layer.opacity', valueMap: { on: 1, off: 0 } },
        text,
      ),
    ).toEqual([]);
  });
});
