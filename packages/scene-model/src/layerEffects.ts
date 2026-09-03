import { createLayerEffects } from './factory';
import type { LayerEffects } from './types';
import { effectStackToCss } from './effectRendering';
import { copyEffectStack } from './effectStack';

const finiteAtLeast = (value: number | undefined, minimum: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(minimum, value!) : fallback;

export function normalizeLayerEffects(effects?: Partial<LayerEffects>): LayerEffects {
  const defaults = createLayerEffects();
  return {
    blur: finiteAtLeast(effects?.blur, 0, defaults.blur),
    dropShadowEnabled: effects?.dropShadowEnabled ?? defaults.dropShadowEnabled,
    dropShadowColor: effects?.dropShadowColor || defaults.dropShadowColor,
    dropShadowOpacity: Math.min(
      1,
      finiteAtLeast(effects?.dropShadowOpacity, 0, defaults.dropShadowOpacity),
    ),
    dropShadowOffsetX: Number.isFinite(effects?.dropShadowOffsetX)
      ? effects!.dropShadowOffsetX!
      : defaults.dropShadowOffsetX,
    dropShadowOffsetY: Number.isFinite(effects?.dropShadowOffsetY)
      ? effects!.dropShadowOffsetY!
      : defaults.dropShadowOffsetY,
    dropShadowBlur: finiteAtLeast(effects?.dropShadowBlur, 0, defaults.dropShadowBlur),
    ...(effects?.stack !== undefined ? { stack: copyEffectStack(effects.stack) } : {}),
  };
}

export function layerEffectsToCssFilter(effects: LayerEffects): string {
  return effectStackToCss(effects);
}
