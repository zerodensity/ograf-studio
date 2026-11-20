import { describe, expect, it } from 'vitest';
import { ANIMATABLE_LAYER_PROPERTIES } from '@ograf-editor/scene-model';
import { authoringOperationSchema, propertySchema } from './schemas';

describe('animatable property schema', () => {
  it('accepts every property that capabilities report as animatable', () => {
    for (const property of ANIMATABLE_LAYER_PROPERTIES)
      expect(propertySchema.safeParse(property).success, property).toBe(true);
  });

  it.each(['scale', 'clipLeft', 'clipRight', 'clipTop', 'clipBottom'])(
    'lets keyframe operations address %s',
    (property) => {
      const key = { frame: 0, value: 0.5 };
      for (const operation of [
        { type: 'set_property_key', layerId: 'panel', property, ...key },
        { type: 'set_property_track', layerId: 'panel', property, keys: [key] },
        { type: 'set_loop_property_track', layerId: 'panel', property, keys: [key] },
        {
          type: 'stagger_property_track',
          layerIds: ['panel'],
          property,
          keys: [key],
          frameOffset: 2,
        },
        { type: 'move_property_key', layerId: 'panel', property, keyframeId: 'key', frame: 4 },
        { type: 'remove_property_key', layerId: 'panel', property, keyframeId: 'key' },
        {
          type: 'set_property_key_easing',
          layerId: 'panel',
          property,
          keyframeId: 'key',
          easing: 'linear',
        },
      ])
        expect(authoringOperationSchema.safeParse(operation).success, operation.type).toBe(true);
    },
  );

  it('still rejects names that are not properties', () => {
    for (const property of ['scaleX', 'clip', 'clipLeftRight', 'skew'])
      expect(propertySchema.safeParse(property).success, property).toBe(false);
  });
});
