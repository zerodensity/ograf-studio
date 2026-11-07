import { describe, expect, it } from 'vitest';
import { authoringOperationSchema } from './schemas';

describe('reset property animation operation schema', () => {
  it.each([
    'x',
    'opacity',
    'blur',
    'fill.stops[0].offset',
    'fill.parameters.temperature',
    'effects.glow.radius',
    'modifiers.fit.padding',
    'scale',
    'clipLeft',
    'clipRight',
    'clipTop',
    'clipBottom',
  ])('accepts an explicit playhead time for %s by ID or name', (property) => {
    for (const selector of [{ layerId: 'panel' }, { layerName: 'Panel' }])
      expect(
        authoringOperationSchema.parse({
          type: 'reset_property_animation',
          ...selector,
          property,
          frame: 25,
        }),
      ).toMatchObject({ property, frame: 25, ...selector });
  });

  it('allows an explicit fractional held-loop time without changing the integer playhead contract', () => {
    expect(
      authoringOperationSchema.safeParse({
        type: 'reset_property_animation',
        layerId: 'panel',
        property: 'x',
        frame: 25,
        loopElapsedFrames: 13.5,
      }).success,
    ).toBe(true);
    for (const loopElapsedFrames of [-1, Infinity, NaN])
      expect(
        authoringOperationSchema.safeParse({
          type: 'reset_property_animation',
          layerId: 'panel',
          property: 'x',
          frame: 25,
          loopElapsedFrames,
        }).success,
      ).toBe(false);
  });

  it.each([undefined, -1, 1.5, Infinity, NaN])(
    'requires a finite nonnegative integer frame: %s',
    (frame) => {
      expect(
        authoringOperationSchema.safeParse({
          type: 'reset_property_animation',
          layerId: 'panel',
          property: 'x',
          frame,
        }).success,
      ).toBe(false);
    },
  );

  it('rejects unsupported channel names and leaves existing reveal-operation schemas unchanged', () => {
    for (const property of ['unknown', 'fill.parameters.0bad', 'effects.fx.offsetZ'])
      expect(
        authoringOperationSchema.safeParse({
          type: 'reset_property_animation',
          layerId: 'panel',
          property,
          frame: 0,
        }).success,
      ).toBe(false);
    expect(
      authoringOperationSchema.safeParse({
        type: 'set_property_key',
        layerId: 'panel',
        property: 'clipLeft',
        frame: 0,
        value: 0,
      }).success,
    ).toBe(false);
  });
});
