import type { Element, TickerContentElement, TickerElement, TickerItem } from './types';

export const MAX_TICKER_ITEMS = 128;
export const MAX_TICKER_SPEED = 2000;
export const MAX_TICKER_ITEM_SIZE = 16384;
const CONTENT_TYPES = new Set([
  'rectangle',
  'ellipse',
  'text',
  'image',
  'path',
  'pattern',
  'image-sequence',
  'lottie',
  'shader',
]);

export function tickerErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Ticker must be an object.'];
  const ticker = value as Record<string, unknown>;
  const errors: string[] = [];
  if (ticker.type !== 'ticker') errors.push('Ticker type must be ticker.');
  const bounded = (value: unknown, maximum: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
  if (!bounded(ticker.speedPixelsPerSecond, MAX_TICKER_SPEED))
    errors.push(`Ticker speed must be from 0 to ${MAX_TICKER_SPEED} pixels per second.`);
  if (!bounded(ticker.gap, MAX_TICKER_ITEM_SIZE))
    errors.push(`Ticker gap must be from 0 to ${MAX_TICKER_ITEM_SIZE} pixels.`);
  if (!['left', 'right'].includes(String(ticker.direction)))
    errors.push('Ticker direction must be left or right.');
  if (!['auto', 'ltr', 'rtl'].includes(String(ticker.textDirection)))
    errors.push('Ticker text direction must be auto, ltr or rtl.');
  if (
    ticker.updatePolicy !== undefined &&
    !['next-appearance', 'immediate'].includes(String(ticker.updatePolicy))
  )
    errors.push('Ticker update policy must be next-appearance or immediate.');
  for (const field of ['entryFade', 'exitFade'])
    if (!bounded(ticker[field], MAX_TICKER_ITEM_SIZE))
      errors.push(`Ticker ${field} must be from 0 to ${MAX_TICKER_ITEM_SIZE} pixels.`);
  if (!bounded(ticker.fadeSoftness, 1)) errors.push('Ticker fade softness must be from 0 to 1.');
  if (!Array.isArray(ticker.items) || ticker.items.length > MAX_TICKER_ITEMS)
    errors.push(`Ticker items must be an array with at most ${MAX_TICKER_ITEMS} entries.`);
  else {
    const ids = new Set<string>();
    ticker.items.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') {
        errors.push(`Ticker item ${index} must be an object.`);
        return;
      }
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        !/^[-A-Za-z0-9_]{1,100}$/.test(item.id) ||
        ids.has(item.id)
      )
        errors.push(
          `Ticker item ${index} needs a unique simple ID (letters, numbers, hyphens or underscores).`,
        );
      else ids.add(item.id);
      if (!bounded(item.width, MAX_TICKER_ITEM_SIZE) || item.width === 0)
        errors.push(
          `Ticker item ${index} width must be greater than zero and at most ${MAX_TICKER_ITEM_SIZE}.`,
        );
      if (
        item.height !== undefined &&
        (!bounded(item.height, MAX_TICKER_ITEM_SIZE) || item.height === 0)
      )
        errors.push(`Ticker item ${index} height is invalid.`);
      const element = item.element as Record<string, unknown> | undefined;
      if (!element || !CONTENT_TYPES.has(String(element.type)))
        errors.push(`Ticker item ${index} has an unsupported visual element.`);
      else {
        if (
          element.type === 'text' &&
          (typeof element.content !== 'string' ||
            !Array.isArray(element.runs) ||
            typeof element.fontFamily !== 'string' ||
            !bounded(element.fontSize, 32768) ||
            element.fontSize === 0)
        )
          errors.push(`Ticker item ${index} has invalid text content, font or styled runs.`);
        if (element.type === 'image' && element.src !== null && typeof element.src !== 'string')
          errors.push(`Ticker item ${index} has an invalid image source.`);
        if (
          element.type === 'image-sequence' &&
          (!Array.isArray(element.frames) ||
            !element.frames.every((frame) => typeof frame === 'string') ||
            !bounded(element.fps, 240) ||
            element.fps === 0 ||
            typeof element.loop !== 'boolean')
        )
          errors.push(`Ticker item ${index} has an invalid image sequence.`);
        if (
          element.type === 'path' &&
          (typeof element.d !== 'string' ||
            !bounded(element.viewBoxWidth, 32768) ||
            element.viewBoxWidth === 0 ||
            !bounded(element.viewBoxHeight, 32768) ||
            element.viewBoxHeight === 0)
        )
          errors.push(`Ticker item ${index} has invalid path geometry.`);
        if (element.type === 'pattern' && typeof element.patternId !== 'string')
          errors.push(`Ticker item ${index} has an invalid pattern reference.`);
      }
      if (
        item.effects !== undefined &&
        (!item.effects || typeof item.effects !== 'object' || Array.isArray(item.effects))
      )
        errors.push(`Ticker item ${index} effects must be an object.`);
      const animation = item.animation as Record<string, unknown> | undefined;
      if (
        animation &&
        (!['none', 'fade', 'rise', 'scale'].includes(String(animation.type)) ||
          !bounded(animation.durationMs, 60000) ||
          !bounded(animation.delayMs, 60000))
      )
        errors.push(`Ticker item ${index} animation is invalid.`);
    });
  }
  return errors;
}

export function normalizeTicker(value: Partial<TickerElement> = {}): TickerElement {
  const ticker: TickerElement = {
    type: 'ticker',
    items: [],
    speedPixelsPerSecond: 100,
    gap: 64,
    direction: 'left',
    textDirection: 'auto',
    updatePolicy: 'next-appearance',
    entryFade: 40,
    exitFade: 40,
    fadeSoftness: 1,
    ...value,
  };
  const errors = tickerErrors(ticker);
  if (errors.length) throw new Error(errors.join(' '));
  return ticker;
}

export function getTickerLayout(ticker: TickerElement, height: number) {
  let x = 0;
  return ticker.items.map((item) => {
    const entry = { id: item.id, x, width: item.width, height: item.height ?? height };
    x += item.width + ticker.gap;
    return entry;
  });
}

/** Absolute-time sampling is identical for realtime playback and arbitrary offline seeks. */
export function sampleTicker(ticker: TickerElement, viewportWidth: number, elapsedMs: number) {
  const period = ticker.items.reduce((total, item) => total + item.width + ticker.gap, 0);
  if (!(period > 0)) return { period: 0, offset: 0, copies: 0 };
  const travel =
    (Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) * ticker.speedPixelsPerSecond) / 1000;
  const phase = ((travel % period) + period) % period;
  return {
    period,
    offset: ticker.direction === 'right' && phase > 0 ? phase - period : -phase,
    copies: Math.max(2, Math.ceil(Math.max(0, viewportWidth) / period) + 2),
  };
}

export function sampleTickerItemAnimation(item: TickerItem, elapsedMs: number) {
  const animation = item.animation;
  if (!animation || animation.type === 'none') return { opacity: 1, translateY: 0, scale: 1 };
  const progress =
    animation.durationMs <= 0
      ? Number(elapsedMs >= animation.delayMs)
      : Math.max(0, Math.min(1, (elapsedMs - animation.delayMs) / animation.durationMs));
  const eased = 1 - (1 - progress) ** 3;
  return {
    opacity: animation.type === 'fade' || animation.type === 'rise' ? eased : 1,
    translateY: animation.type === 'rise' ? (1 - eased) * (item.height ?? 48) * 0.35 : 0,
    scale: animation.type === 'scale' ? 0.8 + eased * 0.2 : 1,
  };
}

/** Read-only traversal used by packaging, inspection and asset dependency discovery. */
export function walkElementContents(element: Element): Element[] {
  return element.type === 'ticker'
    ? [element, ...element.items.flatMap((item) => walkElementContents(item.element))]
    : [element];
}

/** Preserve the prepared-item contract while applying an existing single-element operation. */
export function mapElementContents(element: Element, map: (element: Element) => Element): Element {
  const nested =
    element.type === 'ticker'
      ? {
          ...element,
          items: element.items.map((item) => ({
            ...item,
            element: mapElementContents(item.element, map) as TickerContentElement,
          })),
        }
      : element;
  return map(nested);
}

/** Image data retains URL packaging even when the image is a prepared ticker item. */
export function isElementImageSourceBinding(element: Element, property: string): boolean {
  if (element.type === 'image') return property === 'src';
  if (element.type !== 'ticker') return false;
  const target = /^items\.([^.]+)\.(.+)$/.exec(property);
  const item = target ? element.items.find((item) => item.id === target[1]) : undefined;
  return item ? isElementImageSourceBinding(item.element, target![2]!) : false;
}
