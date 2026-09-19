import { describe, expect, it } from 'vitest';
import { propertySchema, authoringOperationSchema } from './schemas';

describe('shader animation tool paths', () => {
  it.each([
    'fill.parameters.yaw',
    'strokePaint.parameters.enabled',
    'fill.parameters.offset.x',
    'fill.parameters.offset.y',
    'strokePaint.parameters.tint.r',
    'fill.parameters.tint.a',
  ])('accepts %s for key and loop operations', (property) => {
    expect(propertySchema.parse(property)).toBe(property);
    expect(
      authoringOperationSchema.safeParse({
        type: 'set_property_key',
        layerId: 'layer',
        property,
        frame: 4,
        value: 1,
      }).success,
    ).toBe(true);
    expect(
      authoringOperationSchema.safeParse({
        type: 'set_loop_property_track',
        layerId: 'layer',
        property,
        keys: [
          { frame: 0, value: 0 },
          { frame: 10, value: 1 },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    'fill.parameters.0bad',
    'fill.parameters.offset.z',
    'fill.parameters.tint.r.g',
    'stroke.parameters.yaw',
    'effects.fx.offsetZ',
    'dropShadowOffsetZ',
    'fill.stops[01].offset',
  ])('rejects invalid syntax %s', (property) =>
    expect(propertySchema.safeParse(property).success).toBe(false),
  );
  it.each([
    'transformOriginX',
    'transformOriginY',
    'dropShadowOpacity',
    'dropShadowOffsetX',
    'dropShadowOffsetY',
    'dropShadowBlur',
    'effects.some-fx.offsetX',
    'fill.stops[10].offset',
  ])('retains existing valid property %s', (property) =>
    expect(propertySchema.safeParse(property).success).toBe(true),
  );
});
