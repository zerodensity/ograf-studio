import { effectEnabled, effectParams, getEffectStack } from './effectStack';
import { escapeSvgAttribute } from './svgPaint';
import type { LayerEffects } from './types';

function colorWithOpacity(color: string, opacity: number): string {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16),
    alpha = opacity * (match[2] ? Number.parseInt(match[2], 16) / 255 : 1);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
export function effectStackToCss(effects: LayerEffects): string {
  const filters: string[] = [];
  for (const effect of getEffectStack(effects)) {
    if (!effectEnabled(effect, effects) || effect.blendOpacity === 0) continue;
    const p = effectParams(effect, effects);
    switch (effect.type) {
      case 'blur':
        if (Number(p.radius) > 0) filters.push(`blur(${p.radius}px)`);
        break;
      case 'drop-shadow':
      case 'glow':
        if (Number(p.opacity) > 0)
          filters.push(
            `drop-shadow(${effect.type === 'glow' ? 0 : p.offsetX}px ${effect.type === 'glow' ? 0 : p.offsetY}px ${p.radius}px ${colorWithOpacity(String(p.color), Number(p.opacity))})`,
          );
        break;
      case 'brightness':
      case 'contrast':
      case 'saturate':
        filters.push(`${effect.type}(${p.amount})`);
        break;
      case 'hue-rotate':
        filters.push(`hue-rotate(${p.angle}deg)`);
        break;
    }
  }
  return filters.join(' ') || 'none';
}

/** Only mixed effects need intermediate filter surfaces. Legacy/normal chains retain CSS. */
export function effectStackNeedsCompositing(effects: LayerEffects): boolean {
  return getEffectStack(effects).some(
    (effect) =>
      effectEnabled(effect, effects) &&
      effect.blendOpacity !== 0 &&
      ((effect.blendMode ?? 'normal') !== 'normal' || (effect.blendOpacity ?? 1) !== 1),
  );
}

export function effectStackPadding(effects: LayerEffects): number {
  return Math.ceil(
    getEffectStack(effects).reduce((padding, e) => {
      if (!effectEnabled(e, effects) || e.blendOpacity === 0) return padding;
      const p = effectParams(e, effects);
      return (
        padding +
        Number(p.radius ?? 0) * 3 +
        Math.max(Math.abs(Number(p.offsetX ?? 0)), Math.abs(Number(p.offsetY ?? 0)))
      );
    }, 1),
  );
}

/** The same ordered chain for SVG alpha masks and diagnostic captures. Use an sRGB filter. */
export function effectStackToSvg(effects: LayerEffects): string {
  const nodes: string[] = [];
  let previous = 'SourceGraphic';
  for (const effect of getEffectStack(effects)) {
    if (!effectEnabled(effect, effects) || effect.blendOpacity === 0) continue;
    const p = effectParams(effect, effects),
      result = `fx-${nodes.length}`,
      input = `in="${previous}" result="${result}"`;
    let node = '';
    switch (effect.type) {
      case 'blur':
        if (Number(p.radius) > 0 || (effect.blendMode ?? 'normal') !== 'normal')
          node = `<feGaussianBlur ${input} stdDeviation="${p.radius}"/>`;
        break;
      case 'drop-shadow':
      case 'glow':
        if (Number(p.opacity) > 0)
          node = `<feDropShadow ${input} dx="${effect.type === 'glow' ? 0 : p.offsetX}" dy="${effect.type === 'glow' ? 0 : p.offsetY}" stdDeviation="${p.radius}" flood-color="${escapeSvgAttribute(p.color)}" flood-opacity="${p.opacity}"/>`;
        break;
      case 'brightness':
      case 'contrast': {
        const intercept = effect.type === 'contrast' ? 0.5 - 0.5 * Number(p.amount) : 0;
        node = `<feComponentTransfer ${input}>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${p.amount}" intercept="${intercept}"/>`).join('')}</feComponentTransfer>`;
        break;
      }
      case 'saturate':
        node = `<feColorMatrix ${input} type="saturate" values="${p.amount}"/>`;
        break;
      case 'hue-rotate':
        node = `<feColorMatrix ${input} type="hueRotate" values="${p.angle}"/>`;
        break;
    }
    if (node) {
      const mode = effect.blendMode ?? 'normal';
      const opacity = effect.blendOpacity ?? 1;
      if (mode !== 'normal') {
        // Shadow/glow blending uses only their generated contribution, never a second copy
        // of SourceGraphic. Their normal path keeps the existing shadow-behind-source behavior.
        if (effect.type === 'glow' || effect.type === 'drop-shadow') {
          node = `<feColorMatrix in="${previous}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${result}-alpha"/><feGaussianBlur in="${result}-alpha" stdDeviation="${p.radius}" result="${result}-blur"/><feOffset in="${result}-blur" dx="${effect.type === 'glow' ? 0 : p.offsetX}" dy="${effect.type === 'glow' ? 0 : p.offsetY}" result="${result}-offset"/><feFlood flood-color="${escapeSvgAttribute(p.color)}" flood-opacity="${p.opacity}" result="${result}-color"/><feComposite in="${result}-color" in2="${result}-offset" operator="in" result="${result}"/>`;
        }
        node +=
          mode === 'add'
            ? `<feComposite in="${result}" in2="${previous}" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${result}-blend"/>`
            : `<feBlend in="${result}" in2="${previous}" mode="${mode}" result="${result}-blend"/>`;
      }
      const blended = mode === 'normal' ? result : `${result}-blend`;
      if (opacity !== 1)
        node += `<feComposite in="${blended}" in2="${previous}" operator="arithmetic" k1="0" k2="${opacity}" k3="${1 - opacity}" k4="0" result="${result}-mix"/>`;
      nodes.push(node);
      previous = opacity === 1 ? blended : `${result}-mix`;
    }
  }
  return nodes.join('');
}
