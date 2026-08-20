import { createLayerEffects } from './factory';
import type { LayerEffects } from './types';

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
  };
}

function colorWithOpacity(color: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

export function layerEffectsToCssFilter(effects: LayerEffects): string {
  const filters: string[] = [];
  if (effects.blur > 0) filters.push(`blur(${effects.blur}px)`);
  if (effects.dropShadowEnabled) {
    filters.push(
      `drop-shadow(${effects.dropShadowOffsetX}px ${effects.dropShadowOffsetY}px ${effects.dropShadowBlur}px ${colorWithOpacity(effects.dropShadowColor, effects.dropShadowOpacity)})`,
    );
  }
  return filters.length > 0 ? filters.join(' ') : 'none';
}
