import type { Element } from './types';

/** Immutable data overrides, shared by Studio, diagnostic capture and exported runtime. */
export function applyElementDataValue(element: Element, property: string, value: unknown): Element {
  if (property === 'dropShadowColor' || property.startsWith('effects.')) return element;
  const stop = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  if (stop) {
    if (!('fill' in element) || typeof element.fill === 'string') return element;
    const index = Number(stop[1]);
    if (!element.fill.stops[index]) return element;
    return {
      ...element,
      fill: {
        ...element.fill,
        stops: element.fill.stops.map((s, i) => (i === index ? { ...s, color: String(value) } : s)),
      },
    } as Element;
  }
  return {
    ...element,
    [property]: property === 'fill' && value && typeof value === 'object' ? value : String(value),
  } as Element;
}
