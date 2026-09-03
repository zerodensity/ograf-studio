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
    if (!effectEnabled(effect, effects)) continue;
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

export function effectStackPadding(effects: LayerEffects): number {
  return Math.ceil(
    getEffectStack(effects).reduce((padding, e) => {
      if (!effectEnabled(e, effects)) return padding;
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
    if (!effectEnabled(effect, effects)) continue;
    const p = effectParams(effect, effects),
      result = `fx-${nodes.length}`,
      input = `in="${previous}" result="${result}"`;
    let node = '';
    switch (effect.type) {
      case 'blur':
        if (Number(p.radius) > 0) node = `<feGaussianBlur ${input} stdDeviation="${p.radius}"/>`;
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
      nodes.push(node);
      previous = result;
    }
  }
  return nodes.join('');
}
