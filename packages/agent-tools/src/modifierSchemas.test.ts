import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('modifier authoring wire contract', () => {
  it('validates the typed text-path reference and permits clearing it', () => {
    const op = {
      type: 'set_layer_layout',
      layerId: 'label',
      textPath: { sourceLayerId: 'curve', startOffset: 4, alignment: 'center' },
    };
    expect(authoringOperationSchema.safeParse(op).success).toBe(true);
    expect(authoringOperationSchema.safeParse({ ...op, textPath: null }).success).toBe(true);
    expect(
      authoringOperationSchema.safeParse({
        ...op,
        textPath: { ...op.textPath, alignment: 'other' },
      }).success,
    ).toBe(false);
    expect(
      authoringOperationSchema.safeParse({ ...op, textPath: { ...op.textPath, extra: true } })
        .success,
    ).toBe(false);
  });
  it.each([
    'max-text-width',
    'auto-size',
    'auto-follow',
    'hide-empty',
    'grid-arrange',
    'radial-arrange',
    'justify',
    'look-at',
  ])('accepts the typed %s entry and exact layer-name selector', (modifierType) => {
    expect(
      authoringOperationSchema.safeParse({
        type: 'add_modifier',
        layerName: 'Presenter',
        modifierType,
        params: {},
      }).success,
    ).toBe(true);
  });
  it('admits stable numeric modifier paths on Timeline and loop operations', () => {
    expect(
      authoringOperationSchema.safeParse({
        type: 'set_property_track',
        layerId: 'label',
        property: 'modifiers.width.maxWidth',
        replace: true,
        keys: [{ frame: 0, value: 600 }],
      }).success,
    ).toBe(true);
    expect(
      authoringOperationSchema.safeParse({
        type: 'set_loop_property_track',
        layerId: 'label',
        property: 'modifiers.follow.offsetX',
        replace: true,
        keys: [
          { frame: 0, value: 0 },
          { frame: 20, value: 12 },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects unknown modifier types and unsupported patch fields', () => {
    expect(
      authoringOperationSchema.safeParse({
        type: 'add_modifier',
        layerId: 'label',
        modifierType: 'javascript',
      }).success,
    ).toBe(false);
    expect(
      authoringOperationSchema.safeParse({
        type: 'update_modifier',
        layerId: 'label',
        modifierId: 'width',
        patch: { execute: 'alert(1)' },
      }).success,
    ).toBe(false);
  });

  it('accepts Spline Path orientation and rejects out-of-range or unknown controls', () => {
    const operation = {
      type: 'set_layer_layout',
      layerName: 'Pointer',
      motionPath: {
        sourceLayerId: 'route',
        progress: 0.5,
        orientToPath: true,
        offsetX: 12,
        offsetY: -8,
        rotationOffset: 90,
      },
    };
    expect(authoringOperationSchema.safeParse(operation).success).toBe(true);
    for (const patch of [
      { progress: -0.1 },
      { progress: 1.1 },
      { rotationOffset: 361 },
      { rotationOffset: -361 },
      { orientToPath: 'yes' },
      { executable: 'script' },
    ]) {
      expect(
        authoringOperationSchema.safeParse({
          ...operation,
          motionPath: { ...operation.motionPath, ...patch },
        }).success,
      ).toBe(false);
    }
  });
});
