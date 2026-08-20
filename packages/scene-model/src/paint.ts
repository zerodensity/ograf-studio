import type { GradientPaint, GradientStop, Paint } from './types';

function stopColor(stop: GradientStop): string {
  const opacity = Math.max(0, Math.min(1, stop.opacity));
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(stop.color);
  if (match) {
    return `rgba(${Number.parseInt(match[1]!, 16)}, ${Number.parseInt(match[2]!, 16)}, ${Number.parseInt(match[3]!, 16)}, ${opacity})`;
  }
  return opacity >= 1
    ? stop.color
    : `color-mix(in srgb, ${stop.color} ${opacity * 100}%, transparent)`;
}

export function paintToCss(paint: Paint): string {
  if (typeof paint === 'string') return paint;
  const stops = [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => `${stopColor(stop)} ${Math.max(0, Math.min(1, stop.offset)) * 100}%`)
    .join(', ');
  if (paint.type === 'radial') return `radial-gradient(circle, ${stops})`;
  if (paint.type === 'conic') return `conic-gradient(from ${paint.angle}deg, ${stops})`;
  return `linear-gradient(${paint.angle}deg, ${stops})`;
}

export function createDefaultGradient(type: GradientPaint['type'] = 'linear'): GradientPaint {
  return {
    type,
    angle: type === 'linear' ? 180 : 0,
    stops: [
      { offset: 0, color: '#ffffff', opacity: 0.34 },
      { offset: 1, color: '#00133f', opacity: 0.42 },
    ],
  };
}

export function validatePaint(paint: Paint): string[] {
  if (typeof paint === 'string') return paint.trim() ? [] : ['solid paint cannot be empty'];
  const errors: string[] = [];
  if (!['linear', 'radial', 'conic'].includes(paint.type)) errors.push('gradient type is invalid');
  if (!Number.isFinite(paint.angle)) errors.push('gradient angle must be finite');
  if (!Array.isArray(paint.stops) || paint.stops.length < 2) {
    errors.push('gradient requires at least two stops');
  } else {
    for (const [index, stop] of paint.stops.entries()) {
      if (!Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1) {
        errors.push(`gradient stop ${index} offset must be from 0 to 1`);
      }
      if (!stop.color?.trim()) errors.push(`gradient stop ${index} color cannot be empty`);
      if (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1) {
        errors.push(`gradient stop ${index} opacity must be from 0 to 1`);
      }
    }
  }
  return errors;
}
