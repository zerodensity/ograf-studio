import { describe, expect, it } from 'vitest';
import { createLayerEffects } from './factory';
import { layerEffectsToCssFilter, normalizeLayerEffects } from './layerEffects';

describe('layer effects', () => {
  it('serializes blur and drop shadow into a deterministic CSS filter', () => {
    const filter = layerEffectsToCssFilter(
      createLayerEffects({
        blur: 3,
        dropShadowEnabled: true,
        dropShadowColor: '#123456',
        dropShadowOpacity: 0.5,
        dropShadowOffsetX: 4,
        dropShadowOffsetY: -2,
        dropShadowBlur: 7,
      }),
    );
    expect(filter).toBe('blur(3px) drop-shadow(4px -2px 7px rgba(18, 52, 86, 0.5))');
  });

  it('normalizes invalid and out-of-range values', () => {
    expect(
      normalizeLayerEffects({ blur: -5, dropShadowOpacity: 4, dropShadowBlur: -1 }),
    ).toMatchObject({ blur: 0, dropShadowOpacity: 1, dropShadowBlur: 0 });
  });
});
