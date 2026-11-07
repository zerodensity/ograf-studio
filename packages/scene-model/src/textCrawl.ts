import type { TextCrawl } from './types';

export const MAX_TEXT_CRAWL_SPEED = 2000;
export const MAX_TEXT_CRAWL_GAP = 8192;

export function textCrawlErrors(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return ['Text crawl must be an object.'];
  const crawl = value as Record<string, unknown>;
  const errors: string[] = [];
  if (
    typeof crawl.speedPixelsPerSecond !== 'number' ||
    !Number.isFinite(crawl.speedPixelsPerSecond) ||
    crawl.speedPixelsPerSecond < 0 ||
    crawl.speedPixelsPerSecond > MAX_TEXT_CRAWL_SPEED
  )
    errors.push(
      `Text crawl speed must be between 0 and ${MAX_TEXT_CRAWL_SPEED} pixels per second.`,
    );
  if (
    typeof crawl.gap !== 'number' ||
    !Number.isFinite(crawl.gap) ||
    crawl.gap < 0 ||
    crawl.gap > MAX_TEXT_CRAWL_GAP
  )
    errors.push(`Text crawl gap must be between 0 and ${MAX_TEXT_CRAWL_GAP} pixels.`);
  if (crawl.direction !== 'left' && crawl.direction !== 'right')
    errors.push('Text crawl direction must be left or right.');
  return errors;
}

export function normalizeTextCrawl(value: Partial<TextCrawl>): TextCrawl {
  const result = { speedPixelsPerSecond: 140, gap: 72, direction: 'left' as const, ...value };
  const errors = textCrawlErrors(result);
  if (errors.length) throw new Error(errors.join(' '));
  return result;
}

/** Position is independent of playback history, including backwards and repeated offline seeks. */
export function sampleTextCrawl(
  crawl: TextCrawl,
  textWidth: number,
  viewportWidth: number,
  elapsedMs: number,
): { period: number; offset: number; copies: number } {
  if (!(textWidth > 0) || !Number.isFinite(textWidth)) return { period: 0, offset: 0, copies: 1 };
  const period = textWidth + crawl.gap;
  const travel =
    (Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) * crawl.speedPixelsPerSecond) / 1000;
  const phase = ((travel % period) + period) % period;
  return {
    period,
    offset: crawl.direction === 'right' && phase > 0 ? phase - period : -phase,
    copies: Math.max(2, Math.ceil(Math.max(0, viewportWidth) / period) + 2),
  };
}
